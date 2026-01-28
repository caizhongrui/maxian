/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { FileWatcher, IFileSaveEvent, IFileWatcherOptions } from './FileWatcher.js';
import { DiagnosticFormatter, IDiagnosticFormatterOptions } from './DiagnosticFormatter.js';
import { ILspDiagnosticsService, FileDiagnostics, DiagnosticSeverity } from '../../common/lsp/lspDiagnostics.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';

// 类型别名，保持代码的可读性
type DiagnosticResult = FileDiagnostics;

/**
 * 自动诊断注入配置
 */
export interface IAutoDiagnosticConfig {
	/**
	 * 是否启用自动诊断注入
	 * 默认: true
	 */
	enabled: boolean;

	/**
	 * 文件监听器配置
	 */
	watcherOptions: Partial<IFileWatcherOptions>;

	/**
	 * 诊断格式化配置
	 */
	formatterOptions: Partial<IDiagnosticFormatterOptions>;

	/**
	 * 是否在保存时自动获取诊断
	 * 默认: true
	 */
	autoFetchOnSave: boolean;

	/**
	 * 获取诊断的延迟时间（毫秒）
	 * 在文件保存后等待此时间再获取诊断，确保LSP服务器已更新
	 * 默认: 200ms
	 */
	fetchDelay: number;

	/**
	 * 是否仅在有错误时注入
	 * 如果为true，则只在检测到Error级别的诊断时才注入
	 * 默认: false
	 */
	criticalErrorsOnly: boolean;

	/**
	 * 诊断缓存时间（毫秒）
	 * 在此时间内，如果再次请求同一文件的诊断，将返回缓存结果
	 * 默认: 5000ms (5秒)
	 */
	cacheDuration: number;
}

/**
 * 默认配置
 */
export const DEFAULT_AUTO_DIAGNOSTIC_CONFIG: IAutoDiagnosticConfig = {
	enabled: true,
	watcherOptions: {
		debounceDelay: 300,
		workspaceOnly: true,
		extensionFilter: [], // 不限制文件类型，让LSP决定
	},
	formatterOptions: {
		includeSeverities: [DiagnosticSeverity.Error, DiagnosticSeverity.Warning], // Error and Warning
		maxCount: 10,
		includeSuggestions: true,
	},
	autoFetchOnSave: true,
	fetchDelay: 200,
	criticalErrorsOnly: false,
	cacheDuration: 5000,
};

/**
 * 诊断缓存项
 */
interface IDiagnosticCacheEntry {
	result: DiagnosticResult;
	timestamp: number;
}

/**
 * 诊断注入事件
 */
export interface IDiagnosticInjectionEvent {
	/**
	 * 触发文件路径
	 */
	filePath: string;

	/**
	 * 格式化的诊断文本
	 */
	formattedText: string;

	/**
	 * 诊断摘要
	 */
	summary: string;

	/**
	 * 是否有严重错误
	 */
	hasCriticalErrors: boolean;

	/**
	 * 诊断总数
	 */
	count: number;

	/**
	 * 时间戳
	 */
	timestamp: number;
}

/**
 * 自动诊断注入器
 * 核心功能：监听文件保存 → 获取诊断 → 格式化 → 准备注入到System Prompt
 */
export class AutoDiagnosticInjector extends Disposable {

	private readonly _onDiagnosticReady = this._register(new Emitter<IDiagnosticInjectionEvent>());
	readonly onDiagnosticReady: Event<IDiagnosticInjectionEvent> = this._onDiagnosticReady.event;

	private readonly _onDiagnosticCleared = this._register(new Emitter<void>());
	readonly onDiagnosticCleared: Event<void> = this._onDiagnosticCleared.event;

	private config: IAutoDiagnosticConfig;
	private fileWatcher: FileWatcher | null = null;
	private diagnosticCache = new Map<string, IDiagnosticCacheEntry>();
	private currentDiagnosticText: string | null = null;
	private cleanupScheduler: RunOnceScheduler;

	constructor(
		private readonly textFileService: ITextFileService,
		private readonly workspaceContextService: IWorkspaceContextService,
		private readonly lspDiagnosticsService: ILspDiagnosticsService,
		config: Partial<IAutoDiagnosticConfig> = {}
	) {
		super();
		this.config = { ...DEFAULT_AUTO_DIAGNOSTIC_CONFIG, ...config };

		// 创建定时清理器（每分钟清理一次过期缓存）
		this.cleanupScheduler = this._register(new RunOnceScheduler(() => {
			this.cleanupExpiredCache();
			this.cleanupScheduler.schedule(60000); // 继续调度
		}, 60000));

		// 如果启用，则立即初始化
		if (this.config.enabled) {
			this.initialize();
		}

		console.log('[AutoDiagnosticInjector] 自动诊断注入器已创建', this.config);
	}

	/**
	 * 初始化注入器
	 */
	private initialize(): void {
		if (this.fileWatcher) {
			console.warn('[AutoDiagnosticInjector] 已经初始化，跳过');
			return;
		}

		// 创建文件监听器
		this.fileWatcher = this._register(
			new FileWatcher(
				this.textFileService,
				this.workspaceContextService,
				this.config.watcherOptions
			)
		);

		// 订阅文件保存事件
		this._register(
			this.fileWatcher.onFileSaved(e => this.handleFileSaved(e))
		);

		// 启动缓存清理
		this.cleanupScheduler.schedule();

		console.log('[AutoDiagnosticInjector] 初始化完成');
	}

	/**
	 * 处理文件保存事件
	 */
	private async handleFileSaved(event: IFileSaveEvent): Promise<void> {
		if (!this.config.autoFetchOnSave) {
			console.log('[AutoDiagnosticInjector] 自动获取已禁用，跳过:', event.filePath);
			return;
		}

		console.log('[AutoDiagnosticInjector] 处理文件保存:', event.filePath);

		// 等待LSP服务器更新（fetchDelay）
		await this.delay(this.config.fetchDelay);

		// 获取诊断
		await this.fetchAndInjectDiagnostics(event.filePath);
	}

	/**
	 * 获取并准备注入诊断信息
	 * @param filePath 文件路径
	 * @returns 是否成功准备注入
	 */
	public async fetchAndInjectDiagnostics(filePath: string): Promise<boolean> {
		try {
			console.log('[AutoDiagnosticInjector] 获取诊断:', filePath);

			// 检查缓存
			const cached = this.getCachedDiagnostic(filePath);
			let result: DiagnosticResult;

			if (cached) {
				console.log('[AutoDiagnosticInjector] 使用缓存的诊断:', filePath);
				result = cached;
			} else {
				// 调用LSP诊断服务
				const diagnostics = await this.lspDiagnosticsService.getDiagnostics(filePath);

				if (!diagnostics) {
					console.warn('[AutoDiagnosticInjector] 获取诊断失败:', filePath);
					return false;
				}

				// 转换为FileDiagnostics格式
				const errorCount = diagnostics.filter(d => d.severity === DiagnosticSeverity.Error).length;
				const warningCount = diagnostics.filter(d => d.severity === DiagnosticSeverity.Warning).length;

				result = {
					filePath,
					diagnostics,
					errorCount,
					warningCount,
				};

				// 缓存结果
				this.cacheDiagnostic(filePath, result);
			}

			// 如果没有诊断信息，清除当前诊断文本
			if (result.diagnostics.length === 0) {
				console.log('[AutoDiagnosticInjector] 无诊断信息:', filePath);
				this.clearDiagnosticText();
				return false;
			}

			// 检查是否仅注入严重错误
			if (this.config.criticalErrorsOnly) {
				if (!DiagnosticFormatter.hasCriticalErrors([result])) {
					console.log('[AutoDiagnosticInjector] 无严重错误，跳过注入:', filePath);
					this.clearDiagnosticText();
					return false;
				}
			}

			// 格式化诊断信息
			const formattedText = DiagnosticFormatter.formatForSystemPrompt(
				[result],
				this.config.formatterOptions
			);

			if (!formattedText) {
				console.log('[AutoDiagnosticInjector] 格式化后无诊断信息:', filePath);
				this.clearDiagnosticText();
				return false;
			}

			// 生成摘要
			const summary = DiagnosticFormatter.getSummary([result], this.config.formatterOptions);
			const hasCriticalErrors = DiagnosticFormatter.hasCriticalErrors([result]);
			const count = DiagnosticFormatter.getCount([result], this.config.formatterOptions.includeSeverities);

			// 更新当前诊断文本
			this.currentDiagnosticText = formattedText;

			// 触发诊断就绪事件
			const injectionEvent: IDiagnosticInjectionEvent = {
				filePath,
				formattedText,
				summary,
				hasCriticalErrors,
				count,
				timestamp: Date.now(),
			};

			this._onDiagnosticReady.fire(injectionEvent);

			console.log('[AutoDiagnosticInjector] 诊断就绪:', {
				filePath,
				summary,
				count,
				hasCriticalErrors,
			});

			return true;
		} catch (error) {
			console.error('[AutoDiagnosticInjector] 获取诊断失败:', filePath, error);
			return false;
		}
	}

	/**
	 * 获取当前准备注入的诊断文本
	 * @returns 诊断文本，如果没有则返回null
	 */
	public getCurrentDiagnosticText(): string | null {
		return this.currentDiagnosticText;
	}

	/**
	 * 清除当前诊断文本
	 */
	public clearDiagnosticText(): void {
		if (this.currentDiagnosticText !== null) {
			this.currentDiagnosticText = null;
			this._onDiagnosticCleared.fire();
			console.log('[AutoDiagnosticInjector] 诊断文本已清除');
		}
	}

	/**
	 * 缓存诊断结果
	 */
	private cacheDiagnostic(filePath: string, result: DiagnosticResult): void {
		this.diagnosticCache.set(filePath, {
			result,
			timestamp: Date.now(),
		});
	}

	/**
	 * 获取缓存的诊断结果
	 */
	private getCachedDiagnostic(filePath: string): DiagnosticResult | null {
		const cached = this.diagnosticCache.get(filePath);
		if (!cached) {
			return null;
		}

		// 检查是否过期
		const age = Date.now() - cached.timestamp;
		if (age > this.config.cacheDuration) {
			this.diagnosticCache.delete(filePath);
			return null;
		}

		return cached.result;
	}

	/**
	 * 清理过期缓存
	 */
	private cleanupExpiredCache(): void {
		const now = Date.now();
		let cleaned = 0;

		for (const [filePath, entry] of this.diagnosticCache.entries()) {
			if (now - entry.timestamp > this.config.cacheDuration) {
				this.diagnosticCache.delete(filePath);
				cleaned++;
			}
		}

		if (cleaned > 0) {
			console.log(`[AutoDiagnosticInjector] 清理了 ${cleaned} 个过期缓存项`);
		}
	}

	/**
	 * 启用自动诊断注入
	 */
	public enable(): void {
		if (this.config.enabled) {
			console.log('[AutoDiagnosticInjector] 已经启用');
			return;
		}

		this.config.enabled = true;
		this.initialize();
		console.log('[AutoDiagnosticInjector] 已启用');
	}

	/**
	 * 禁用自动诊断注入
	 */
	public disable(): void {
		if (!this.config.enabled) {
			console.log('[AutoDiagnosticInjector] 已经禁用');
			return;
		}

		this.config.enabled = false;

		// 清理文件监听器
		if (this.fileWatcher) {
			this.fileWatcher.dispose();
			this.fileWatcher = null;
		}

		// 清除当前诊断文本
		this.clearDiagnosticText();

		// 清空缓存
		this.diagnosticCache.clear();

		console.log('[AutoDiagnosticInjector] 已禁用');
	}

	/**
	 * 更新配置
	 */
	public updateConfig(config: Partial<IAutoDiagnosticConfig>): void {
		const wasEnabled = this.config.enabled;
		Object.assign(this.config, config);

		// 如果启用状态改变
		if (wasEnabled !== this.config.enabled) {
			if (this.config.enabled) {
				this.enable();
			} else {
				this.disable();
			}
		} else if (this.config.enabled && this.fileWatcher) {
			// 更新文件监听器配置
			this.fileWatcher.updateOptions(this.config.watcherOptions);
		}

		console.log('[AutoDiagnosticInjector] 配置已更新:', this.config);
	}

	/**
	 * 获取当前配置
	 */
	public getConfig(): IAutoDiagnosticConfig {
		return { ...this.config };
	}

	/**
	 * 获取统计信息
	 */
	public getStats(): {
		enabled: boolean;
		cacheSize: number;
		hasPendingDiagnostics: boolean;
	} {
		return {
			enabled: this.config.enabled,
			cacheSize: this.diagnosticCache.size,
			hasPendingDiagnostics: this.currentDiagnosticText !== null,
		};
	}

	/**
	 * 辅助方法：延迟
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * 清理资源
	 */
	override dispose(): void {
		this.disable();
		this.cleanupScheduler.cancel();
		super.dispose();
		console.log('[AutoDiagnosticInjector] 已清理');
	}
}
