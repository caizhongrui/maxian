/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import {
	InlineCompletion,
	InlineCompletionContext,
	InlineCompletions,
	InlineCompletionsProvider,
	InlineCompletionTriggerKind,
} from '../../../../../editor/common/languages.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { FimApiClient, type FimResponse } from './fimApiClient.js';
import { readFimSettings, isFimSupportedLanguage } from './fimSettings.js';

/**
 * 码弦 FIM 内联代码补全 Provider
 *
 * 实现类似 GitHub Copilot 的 Tab 键内联代码建议。
 * 基于光标前后代码上下文，调用后端代理的 FIM 接口生成补全内容。
 *
 * 特性：
 * - 防抖：默认 300ms，避免频繁调用
 * - 取消支持：CancellationToken 中止中
 * - 仅在已配置 API 地址和认证凭据时启用
 * - 支持手动触发（快捷键）和自动触发两种模式
 * - 自动过滤无效补全（重复前缀、空内容、FIM 特殊 token 等）
 */
export class FimCompletionProvider implements InlineCompletionsProvider {

	/** Provider 标识，用于日志和 groupId */
	groupId = 'maxian-fim';

	/**
	 * 防抖计时器
	 * 每次 provideInlineCompletions 调用时重置，仅在 debounceDelay 毫秒无新调用后才发起 API 请求
	 */
	private debounceTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * 上一次防抖期间的取消源
	 * 当新的 provideInlineCompletions 进来时，取消正在等待的旧请求
	 */
	private pendingCancellation: CancellationTokenSource | undefined;

	/** 最后一次请求时间戳（用于最小间隔限制） */
	private lastRequestTime = 0;

	/** 最小请求间隔（毫秒），防止连续快速触发 */
	private static readonly MIN_REQUEST_INTERVAL = 200;
	private static readonly TOKEN_TO_CHAR_RATIO = 4;
	private static readonly MAX_CACHE_ENTRIES = 200;

	private readonly apiClient: FimApiClient;
	private readonly completionCache = new Map<string, { completion: string; expiresAt: number }>();
	private readonly inFlightRequests = new Map<string, Promise<FimResponse>>();

	constructor(
		private readonly configurationService: IConfigurationService,
		storageService: IStorageService,
		private readonly workspaceContextService?: IWorkspaceContextService,
	) {
		this.apiClient = new FimApiClient(configurationService, storageService);
	}

	/**
	 * 提供内联补全候选项
	 *
	 * VS Code 内部引擎在编辑器中触发内联补全时调用此方法。
	 * 返回 InlineCompletions 对象（含 items 数组），或 undefined/null 表示无补全。
	 */
	async provideInlineCompletions(
		model: ITextModel,
		position: Position,
		context: InlineCompletionContext,
		token: CancellationToken,
	): Promise<InlineCompletions | undefined> {

		const settings = readFimSettings(this.configurationService);

		// 1. 检查功能开关
		if (!settings.enabled) {
			return undefined;
		}

		// 2. 检查语言是否支持
		const languageId = model.getLanguageId();
		if (!isFimSupportedLanguage(languageId)) {
			return undefined;
		}

		// 3. 触发模式过滤
		// triggerKind 0 = Automatic（输入时自动触发），1 = Explicit（快捷键显式触发）
		if (settings.triggerMode === 'manual') {
			if (context.triggerKind !== InlineCompletionTriggerKind.Explicit) {
				return undefined;
			}
		}
		// automatic 模式接受所有触发

		// 4. 取消并替换上一次待处理请求
		if (this.pendingCancellation) {
			this.pendingCancellation.cancel();
			this.pendingCancellation = undefined;
		}
		if (this.debounceTimer !== undefined) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = undefined;
		}

		// 5. 外部取消检查
		if (token.isCancellationRequested) {
			return undefined;
		}

		// 6. 最小请求间隔（自动触发模式下适用）
		if (settings.triggerMode === 'automatic') {
			const now = Date.now();
			if (now - this.lastRequestTime < FimCompletionProvider.MIN_REQUEST_INTERVAL) {
				return undefined;
			}
		}

		// 7. 防抖等待（自动触发模式下生效，显式触发跳过防抖直接请求）
		if (settings.triggerMode === 'automatic' && context.triggerKind === InlineCompletionTriggerKind.Automatic) {
			const debounceSource = new CancellationTokenSource();
			this.pendingCancellation = debounceSource;

			const shouldProceed = await new Promise<boolean>((resolve) => {
				this.debounceTimer = setTimeout(() => {
					this.debounceTimer = undefined;
					resolve(!debounceSource.token.isCancellationRequested && !token.isCancellationRequested);
				}, settings.debounceDelay);
			});

			this.pendingCancellation = undefined;

			if (!shouldProceed) {
				return undefined;
			}
		}

		// 8. 再次检查外部取消
		if (token.isCancellationRequested) {
			return undefined;
		}

		// 9. 提取 prefix 和 suffix 上下文
		const { prefix, suffix } = this.extractContext(
			model,
			position,
			settings.maxPrefixLines,
			settings.maxSuffixLines,
			settings.maxPrefixTokens,
			settings.maxSuffixTokens,
		);

		// prefix 过短时不触发（至少需要有意义的上下文）
		if (prefix.trim().length < 2) {
			return undefined;
		}

		// 10. 计算缓存键并优先尝试缓存命中
		const projectName = this.workspaceContextService?.getWorkspace().folders[0]?.name ?? '';
		const requestKey = this.buildRequestKey(languageId, prefix, suffix, projectName);

		if (settings.cacheEnabled) {
			const cachedCompletion = this.getCachedCompletion(requestKey);
			if (cachedCompletion) {
				if (token.isCancellationRequested) {
					return undefined;
				}
				return {
					items: [this.toInlineCompletion(cachedCompletion, position)],
				};
			}
		}

		// 11. 发起 FIM API 请求（同 key 请求合并）
		this.lastRequestTime = Date.now();
		const fimResponse = await this.requestWithDedup(
			requestKey,
			() => this.apiClient.complete(
				{ prefix, suffix, projectName: projectName || undefined },
				settings.requestTimeout,
			),
		);

		// 12. 超时或被取消后不返回结果
		if (fimResponse.timedOut || token.isCancellationRequested) {
			return undefined;
		}

		// 13. 清理和验证补全内容
		const cleanedCompletion = this.cleanCompletion(fimResponse.completion, prefix, suffix);
		if (!cleanedCompletion) {
			return undefined;
		}
		if (settings.cacheEnabled) {
			this.setCachedCompletion(requestKey, cleanedCompletion, settings.cacheTtlMs);
		}

		// 14. 构建内联补全候选项
		// 插入位置为当前光标位置（不替换现有文本）
		return { items: [this.toInlineCompletion(cleanedCompletion, position)] };
	}

	/**
	 * 提取光标前后的代码上下文
	 *
	 * 前缀：从文件起始到光标，最多 maxPrefixLines 行
	 * 后缀：从光标到文件结束，最多 maxSuffixLines 行
	 *
	 * @param model 文本模型
	 * @param position 光标位置
	 * @param maxPrefixLines 最大前缀行数
	 * @param maxSuffixLines 最大后缀行数
	 * @param maxPrefixTokens 前缀 token 预算（近似）
	 * @param maxSuffixTokens 后缀 token 预算（近似）
	 */
	private extractContext(
		model: ITextModel,
		position: Position,
		maxPrefixLines: number,
		maxSuffixLines: number,
		maxPrefixTokens: number,
		maxSuffixTokens: number,
	): { prefix: string; suffix: string } {
		const totalLines = model.getLineCount();
		const currentLine = position.lineNumber;
		const currentColumn = position.column;

		// 前缀：从 (currentLine - maxPrefixLines) 到当前光标
		const prefixStartLine = Math.max(1, currentLine - maxPrefixLines);
		const prefixLines: string[] = [];

		for (let i = prefixStartLine; i < currentLine; i++) {
			prefixLines.push(model.getLineContent(i));
		}

		// 当前行光标前的部分
		const currentLineContent = model.getLineContent(currentLine);
		const currentLinePrefixPart = currentLineContent.substring(0, currentColumn - 1);
		prefixLines.push(currentLinePrefixPart);

		const prefix = this.trimPrefixByTokenBudget(prefixLines.join('\n'), maxPrefixTokens);

		// 后缀：从当前光标到 (currentLine + maxSuffixLines)
		const suffixEndLine = Math.min(totalLines, currentLine + maxSuffixLines);
		const suffixLines: string[] = [];

		// 当前行光标后的部分
		const currentLineSuffixPart = currentLineContent.substring(currentColumn - 1);
		suffixLines.push(currentLineSuffixPart);

		for (let i = currentLine + 1; i <= suffixEndLine; i++) {
			suffixLines.push(model.getLineContent(i));
		}

		const suffix = this.trimSuffixByTokenBudget(suffixLines.join('\n'), maxSuffixTokens);

		return { prefix, suffix };
	}

	private trimPrefixByTokenBudget(prefix: string, tokenBudget: number): string {
		if (tokenBudget <= 0 || !prefix) {
			return '';
		}
		const maxChars = tokenBudget * FimCompletionProvider.TOKEN_TO_CHAR_RATIO;
		if (prefix.length <= maxChars) {
			return prefix;
		}
		return prefix.slice(prefix.length - maxChars);
	}

	private trimSuffixByTokenBudget(suffix: string, tokenBudget: number): string {
		if (tokenBudget <= 0 || !suffix) {
			return '';
		}
		const maxChars = tokenBudget * FimCompletionProvider.TOKEN_TO_CHAR_RATIO;
		if (suffix.length <= maxChars) {
			return suffix;
		}
		return suffix.slice(0, maxChars);
	}

	private buildRequestKey(languageId: string, prefix: string, suffix: string, projectName: string): string {
		const raw = `${languageId}|${projectName}|${prefix}|<CURSOR>|${suffix}`;
		return this.hashFnv1a(raw);
	}

	private hashFnv1a(input: string): string {
		let hash = 0x811c9dc5;
		for (let i = 0; i < input.length; i++) {
			hash ^= input.charCodeAt(i);
			hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
		}
		return (hash >>> 0).toString(16);
	}

	private getCachedCompletion(key: string): string | undefined {
		this.pruneExpiredCache();
		const item = this.completionCache.get(key);
		if (!item) {
			return undefined;
		}
		if (item.expiresAt <= Date.now()) {
			this.completionCache.delete(key);
			return undefined;
		}
		return item.completion;
	}

	private setCachedCompletion(key: string, completion: string, ttlMs: number): void {
		if (ttlMs <= 0 || !completion) {
			return;
		}
		this.completionCache.set(key, {
			completion,
			expiresAt: Date.now() + ttlMs,
		});
		if (this.completionCache.size > FimCompletionProvider.MAX_CACHE_ENTRIES) {
			const firstKey = this.completionCache.keys().next().value;
			if (typeof firstKey === 'string') {
				this.completionCache.delete(firstKey);
			}
		}
	}

	private pruneExpiredCache(): void {
		const now = Date.now();
		for (const [key, value] of this.completionCache.entries()) {
			if (value.expiresAt <= now) {
				this.completionCache.delete(key);
			}
		}
	}

	private requestWithDedup(key: string, factory: () => Promise<FimResponse>): Promise<FimResponse> {
		const existing = this.inFlightRequests.get(key);
		if (existing) {
			return existing;
		}
		const requestPromise = factory().finally(() => {
			this.inFlightRequests.delete(key);
		});
		this.inFlightRequests.set(key, requestPromise);
		return requestPromise;
	}

	private toInlineCompletion(completion: string, position: Position): InlineCompletion {
		return {
			insertText: completion,
			range: {
				startLineNumber: position.lineNumber,
				startColumn: position.column,
				endLineNumber: position.lineNumber,
				endColumn: position.column,
			},
		};
	}

	/**
	 * 清理 FIM 模型返回的补全内容
	 *
	 * 处理：
	 * - 移除 markdown 代码块（Chat API 模式下模型可能输出 markdown）
	 * - 移除残留的 FIM 特殊 token（<|fim_prefix|>、<|endoftext|> 等）
	 * - 移除与 prefix 重叠的部分（模型有时回显已有内容）
	 * - 移除与 suffix 重叠的部分（模型多生成光标后内容）
	 * - 过滤空白补全
	 *
	 * @param raw 原始 API 返回文本
	 * @param prefix 光标前代码（用于去重）
	 * @param suffix 光标后代码（用于去重）
	 * @returns 清理后的补全文本，若无有效内容返回空字符串
	 */
	private cleanCompletion(raw: string, prefix: string, suffix: string): string {
		if (!raw) {
			return '';
		}

		let cleaned = raw;

		// 移除 markdown 代码块
		const codeBlockMatch = cleaned.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
		if (codeBlockMatch) {
			cleaned = codeBlockMatch[1];
		} else {
			cleaned = cleaned.replace(/```\w*/g, '');
		}

		// 移除 FIM 特殊 token（防御性处理）
		cleaned = cleaned
			.replace(/<\|fim_prefix\|>/g, '')
			.replace(/<\|fim_suffix\|>/g, '')
			.replace(/<\|fim_middle\|>/g, '')
			.replace(/<\|fim_pad\|>/g, '')
			.replace(/<\|endoftext\|>/g, '')
			.replace(/<\|im_start\|>/g, '')
			.replace(/<\|im_end\|>/g, '');

		// 去除首尾空白（保留内部换行）
		cleaned = cleaned.trim();

		if (!cleaned) {
			return '';
		}

		// 移除前缀重复（FIM 模型有时会回显已有内容）
		// 取 prefix 最后一行，若补全以其开头则截去
		const prefixLastLine = prefix.split('\n').pop() ?? '';
		if (prefixLastLine.length > 3 && cleaned.startsWith(prefixLastLine)) {
			cleaned = cleaned.substring(prefixLastLine.length);
		}

		// 移除后缀重叠（截断模型多生成的光标后内容）
		// 取 suffix 第一行，若补全以其结尾则截去
		const suffixFirstLine = suffix.split('\n')[0] ?? '';
		if (suffixFirstLine.length > 3 && cleaned.endsWith(suffixFirstLine)) {
			cleaned = cleaned.substring(0, cleaned.length - suffixFirstLine.length);
		}

		// 最终去除多余空白
		cleaned = cleaned.trimEnd();

		return cleaned;
	}

	/**
	 * 当内联补全列表不再使用时释放资源
	 * FimCompletionProvider 不需要额外资源释放
	 */
	freeInlineCompletions(_completions: InlineCompletions): void {
		// 无需额外释放
	}

	/**
	 * 处理补全被接受时的回调（可选）
	 */
	handleItemDidShow?(_completions: InlineCompletions, _item: InlineCompletion, _updatedInsertText: string): void {
		// 可用于统计接受率等
	}
}
