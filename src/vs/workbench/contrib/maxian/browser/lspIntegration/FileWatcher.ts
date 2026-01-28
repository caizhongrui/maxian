/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextFileService, ITextFileSaveEvent } from '../../../../services/textfile/common/textfiles.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';

/**
 * 文件保存事件
 */
export interface IFileSaveEvent {
	/**
	 * 文件URI
	 */
	resource: URI;

	/**
	 * 文件路径（绝对路径）
	 */
	filePath: string;

	/**
	 * 保存时间戳
	 */
	timestamp: number;
}

/**
 * 文件监听器配置
 */
export interface IFileWatcherOptions {
	/**
	 * 防抖延迟（毫秒）
	 * 默认: 300ms
	 * 保存后等待此时间再触发事件，避免频繁触发
	 */
	debounceDelay: number;

	/**
	 * 是否仅监听工作区内的文件
	 * 默认: true
	 */
	workspaceOnly: boolean;

	/**
	 * 文件扩展名过滤（例如：['.ts', '.js', '.py']）
	 * 如果为空数组则不过滤
	 * 默认: [] (不过滤)
	 */
	extensionFilter: string[];
}

/**
 * 默认监听器选项
 */
export const DEFAULT_WATCHER_OPTIONS: IFileWatcherOptions = {
	debounceDelay: 300,
	workspaceOnly: true,
	extensionFilter: [],
};

/**
 * 文件监听器
 * 监听文件保存事件并提供防抖处理
 */
export class FileWatcher extends Disposable {

	private readonly _onFileSaved = this._register(new Emitter<IFileSaveEvent>());
	readonly onFileSaved: Event<IFileSaveEvent> = this._onFileSaved.event;

	private readonly options: IFileWatcherOptions;
	private readonly workspaceRoot: string | null = null;
	private readonly schedulers = new Map<string, RunOnceScheduler>();

	constructor(
		private readonly textFileService: ITextFileService,
		workspaceContextService: IWorkspaceContextService,
		options: Partial<IFileWatcherOptions> = {}
	) {
		super();
		this.options = { ...DEFAULT_WATCHER_OPTIONS, ...options };

		// 获取工作区根目录
		const workspaceFolders = workspaceContextService.getWorkspace().folders;
		if (workspaceFolders.length > 0) {
			this.workspaceRoot = workspaceFolders[0].uri.fsPath;
		}

		// 订阅文件保存事件
		this._register(
			this.textFileService.files.onDidSave((e: ITextFileSaveEvent) => {
				this.handleFileSave(e);
			})
		);

		console.log('[FileWatcher] 文件监听器已初始化', {
			debounceDelay: this.options.debounceDelay,
			workspaceOnly: this.options.workspaceOnly,
			extensionFilter: this.options.extensionFilter,
			workspaceRoot: this.workspaceRoot,
		});
	}

	/**
	 * 处理文件保存事件
	 */
	private handleFileSave(event: ITextFileSaveEvent): void {
		const resource = event.model.resource;
		const filePath = resource.fsPath;

		// 检查是否在工作区内
		if (this.options.workspaceOnly) {
			if (!this.workspaceRoot || !filePath.startsWith(this.workspaceRoot)) {
				console.log('[FileWatcher] 忽略工作区外的文件:', filePath);
				return;
			}
		}

		// 检查文件扩展名
		if (this.options.extensionFilter.length > 0) {
			const matchesExtension = this.options.extensionFilter.some(ext =>
				filePath.toLowerCase().endsWith(ext.toLowerCase())
			);
			if (!matchesExtension) {
				console.log('[FileWatcher] 文件扩展名不匹配，忽略:', filePath);
				return;
			}
		}

		console.log('[FileWatcher] 检测到文件保存:', filePath);

		// 防抖处理
		this.scheduleFileSaveEvent(resource, filePath);
	}

	/**
	 * 调度文件保存事件（带防抖）
	 */
	private scheduleFileSaveEvent(resource: URI, filePath: string): void {
		const key = filePath;

		// 取消之前的调度
		const existingScheduler = this.schedulers.get(key);
		if (existingScheduler) {
			existingScheduler.cancel();
		}

		// 创建新的调度器
		const scheduler = new RunOnceScheduler(() => {
			this.fireFileSaveEvent(resource, filePath);
			this.schedulers.delete(key);
		}, this.options.debounceDelay);

		this.schedulers.set(key, scheduler);
		scheduler.schedule();

		console.log(`[FileWatcher] 调度诊断检查: ${filePath} (${this.options.debounceDelay}ms后)`);
	}

	/**
	 * 触发文件保存事件
	 */
	private fireFileSaveEvent(resource: URI, filePath: string): void {
		const event: IFileSaveEvent = {
			resource,
			filePath,
			timestamp: Date.now(),
		};

		console.log('[FileWatcher] 触发文件保存事件:', filePath);
		this._onFileSaved.fire(event);
	}

	/**
	 * 手动触发文件保存事件（用于测试或手动触发）
	 */
	public triggerManual(filePath: string): void {
		const resource = URI.file(filePath);
		this.fireFileSaveEvent(resource, filePath);
	}

	/**
	 * 更新配置选项
	 */
	public updateOptions(options: Partial<IFileWatcherOptions>): void {
		Object.assign(this.options, options);
		console.log('[FileWatcher] 配置已更新:', this.options);
	}

	/**
	 * 清理资源
	 */
	override dispose(): void {
		// 取消所有待处理的调度
		for (const scheduler of this.schedulers.values()) {
			scheduler.cancel();
			scheduler.dispose();
		}
		this.schedulers.clear();

		console.log('[FileWatcher] 文件监听器已清理');
		super.dispose();
	}

	/**
	 * 获取当前配置
	 */
	public getOptions(): IFileWatcherOptions {
		return { ...this.options };
	}

	/**
	 * 获取待处理的文件数量
	 */
	public getPendingCount(): number {
		return this.schedulers.size;
	}
}
