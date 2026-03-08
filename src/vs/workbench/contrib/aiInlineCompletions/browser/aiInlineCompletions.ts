/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { InlineCompletion, InlineCompletionContext, InlineCompletions, InlineCompletionsProvider } from '../../../../editor/common/languages.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IMultiLanguageService } from '../../multilang/browser/multilang.contribution.js';
import { CompletionContextExtractor, CompletionContext } from './completionContextExtractor.js';
import { CompletionValidator } from './completionValidator.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { IModelService } from '../../../../editor/common/services/model.js';
// 新增的服务导入
import { completionCacheService, CompletionCacheData } from './completionCacheService.js';
import { completionRanker } from './completionRanker.js';
import { completionFeedbackService } from './completionFeedbackService.js';

export class AIInlineCompletionsProvider implements InlineCompletionsProvider {

	private readonly contextExtractor: CompletionContextExtractor;
	private readonly completionValidator: CompletionValidator;

	// 防抖相关 - 智能策略（参考 Copilot）
	private debounceTimer: ReturnType<typeof setTimeout> | undefined;
	private pendingCancellation: CancellationTokenSource | undefined;
	private lastRequestTime: number = 0;

	// 🆕 智能触发策略 - 基于内容而非固定时间
	private readonly triggerCharacters = new Set(['.', '(', '::', '->', '=>', ',', '{', '[', '=', ' ']);
	private readonly triggerKeywords = new Set(['return', 'if', 'for', 'while', 'function', 'const', 'let', 'var', 'class', 'import', 'export', 'async', 'await', 'new', 'throw', 'try', 'catch']);
	private lastPrefix: string = ''; // 用于检测实际内容变化
	private lastPosition: { line: number; column: number } = { line: 0, column: 0 };

	// 🆕 采纳率跟踪（参考 Copilot 的 contextualFilterScore）
	private acceptedCount = 0;
	private rejectedCount = 0;
	private readonly acceptanceThreshold = 0.35; // 采纳率低于35%时增加过滤

	// 动态防抖参数 - 针对 Qwen3-Coder FIM 模型优化
	private baseDebounceDelay = 100; // 100ms debounce
	private baseMinRequestInterval = 200; // 200ms 最小间隔
	private adaptiveDebounceDelay = 100;
	private adaptiveMinInterval = 200;

	// 🆕 场景采纳率学习（记录不同触发场景的采纳率）
	private scenarioStats: Map<string, { accepted: number; rejected: number }> = new Map();
	private lastTriggerScenario: string = '';

	// 响应时间跟踪（用于自适应调整）
	private responseTimeHistory: number[] = [];
	private readonly maxHistorySize = 10;
	private readonly slowThreshold = 2000;
	private readonly fastThreshold = 500;

	// 用户输入速度跟踪（保留用于自适应调整）
	private inputIntervalHistory: number[] = [];
	private lastInputTime: number = 0;
	private lastCompletionTime = 0;

	// 补全结果缓存（已迁移到 completionCacheService，保留兼容性）
	private completionCache: Map<string, { result: string[]; timestamp: number }> = new Map();
	private readonly completionCacheTTL = 10 * 60 * 1000; // 10分钟
	private readonly maxCompletionCacheSize = 100;

	// 最后一次补全信息（用于反馈收集）
	private lastCompletionContext?: {
		completions: string[];
		context: CompletionContext;
		score: number;
		responseTime: number;
	};

	// 🆕 编辑历史追踪（参考 Copilot NES edit_diff_history）
	// 记录每个模型最近的代码修改，帮助 AI 理解用户的修改意图
	private recentEditsMap: Map<string, Array<{ timestamp: number; range: Range; text: string }>> = new Map();
	private trackedModels: Map<string, IDisposable> = new Map();
	private readonly maxEditHistoryPerModel = 10;

	constructor(
		private readonly aiService: IAIService,
		private readonly configurationService: IConfigurationService,
		multiLanguageService: IMultiLanguageService,
		languageFeaturesService?: ILanguageFeaturesService,
		modelService?: IModelService
	) {
		this.contextExtractor = new CompletionContextExtractor(
			multiLanguageService,
			languageFeaturesService,
			modelService
		);
		this.completionValidator = new CompletionValidator();
	}

	async provideInlineCompletions(
		model: ITextModel,
		position: Position,
		context: InlineCompletionContext,
		token: CancellationToken
	): Promise<InlineCompletions | undefined> {

		// 【调试日志 1】记录所有触发
		console.log('[AI Inline Completions] 🔔 Provider called - triggerKind:', context.triggerKind,
			'(0=Auto, 1=Explicit), line:', position.lineNumber, 'col:', position.column);

		// 检查是否启用了 InlineCompletions
		const enableInlineCompletions = this.configurationService.getValue<boolean>('zhikai.ai.enableInlineCompletions');
		console.log('[AI Inline Completions] ⚙️ enableInlineCompletions:', enableInlineCompletions);
		if (!enableInlineCompletions) {
			console.log('[AI Inline Completions] ❌ Disabled - returning undefined');
			return undefined;
		}

		// 读取触发模式配置
		const triggerMode = this.configurationService.getValue<string>('zhikai.ai.completionTriggerMode') || 'manual';
		console.log('[AI Inline Completions] ⚙️ Trigger mode:', triggerMode);

		// 获取当前行内容（用于调试）
		const lineContent = model.getLineContent(position.lineNumber);
		const prefix = lineContent.substring(0, position.column - 1);
		console.log('[AI Inline Completions] 📝 Current line:', lineContent);
		console.log('[AI Inline Completions] 📝 Prefix (length=' + prefix.length + '):', prefix);

		// triggerKind: 0 = Automatic（自动触发，如输入时）, 1 = Explicit（明确触发，如快捷键）
		if (triggerMode === 'manual') {
			// 手动模式：只接受明确触发（快捷键）
			if (context.triggerKind !== 1) {
				console.log('[AI Inline Completions] ❌ Manual mode - ignoring non-explicit trigger');
				return undefined;
			}
			console.log('[AI Inline Completions] ✅ Manual mode - Explicit trigger accepted');
		} else if (triggerMode === 'automatic') {
			// 自动模式：接受所有触发
			// 检查触发条件

			const prefixTrimmed = prefix.trim();
			const isNewLine = lineContent.trim().length === 0; // 当前行为空（换行场景）

			// 换行场景：检查上一行是否有代码，有则允许触发
			if (isNewLine && context.triggerKind === 0) {
				// 获取上一行内容
				const prevLineNum = position.lineNumber - 1;
				if (prevLineNum >= 1) {
					const prevLine = model.getLineContent(prevLineNum).trim();
					// 上一行有代码内容，允许换行补全
					if (prevLine.length > 0) {
						console.log('[AI Inline Completions] ✅ Automatic mode - new line after code, triggering');
					} else {
						console.log('[AI Inline Completions] ❌ Automatic mode - empty line context, skipping');
						return undefined;
					}
				} else {
					console.log('[AI Inline Completions] ❌ Automatic mode - first line empty, skipping');
					return undefined;
				}
			} else if (prefixTrimmed.length < 1 && context.triggerKind === 0) {
				// 非换行场景：至少需要1个字符
				console.log('[AI Inline Completions] ❌ Automatic mode - prefix too short (' + prefixTrimmed.length + ' chars), skipping');
				return undefined;
			} else {
				console.log('[AI Inline Completions] ✅ Automatic mode - trigger accepted (triggerKind:',
					context.triggerKind === 0 ? 'Auto' : 'Explicit', ', prefix:', prefixTrimmed.length, 'chars)');
			}
		} else {
			console.log('[AI Inline Completions] ❌ Unknown trigger mode:', triggerMode);
			return undefined;
		}

		// === 🆕 智能触发逻辑（参考 Copilot）：基于内容变化而非固定时间 ===
		if (triggerMode === 'automatic' && context.triggerKind === 0) {
			const now = Date.now();
			const timeSinceLastRequest = now - this.lastRequestTime;

			// 1️⃣ 检测是否是真正的内容变化（而非光标移动）
			const contentChanged = prefix !== this.lastPrefix;
			const positionChanged = position.lineNumber !== this.lastPosition.line ||
			                        position.column !== this.lastPosition.column;

			if (!contentChanged && positionChanged) {
				// 只是光标移动，不触发
				console.log('[AI Inline Completions] ⏳ Skip: cursor move without content change');
				this.lastPosition = { line: position.lineNumber, column: position.column };
				return undefined;
			}

			// 1.5️⃣ 冷却期检查：刚完成补全后短暂休息
			const timeSinceLastCompletion = now - this.lastCompletionTime;
			if (this.lastCompletionTime > 0 && timeSinceLastCompletion < 500) {
				console.log('[AI Inline Completions] ⏳ Skip: cooldown after completion (' + timeSinceLastCompletion + 'ms)');
				return undefined;
			}

			// 更新追踪状态
			this.lastPrefix = prefix;
			this.lastPosition = { line: position.lineNumber, column: position.column };

			// 2️⃣ 智能触发条件检查
			const triggerScore = this.calculateTriggerScore(prefix, lineContent, position, model);
			console.log('[AI Inline Completions] 📊 Trigger score:', triggerScore.score, 'reason:', triggerScore.reason);

			if (triggerScore.score < 0.5) {
				// 触发分数太低，跳过
				console.log('[AI Inline Completions] ⏳ Skip: low trigger score (' + triggerScore.score.toFixed(2) + ')');
				return undefined;
			}

			// 3️⃣ 场景采纳率过滤（学习用户习惯）
			const scenarioKey = this.getScenarioKey(triggerScore.reason);
			const scenarioRate = this.getScenarioAcceptanceRate(scenarioKey);

			// 如果该场景采纳率很低（<20%）且样本足够（>10次），跳过
			const scenarioStats = this.scenarioStats.get(scenarioKey);
			const scenarioTotal = scenarioStats ? scenarioStats.accepted + scenarioStats.rejected : 0;
			if (scenarioTotal >= 10 && scenarioRate < 0.2) {
				console.log('[AI Inline Completions] ⏳ Skip: scenario "' + scenarioKey + '" has low acceptance rate (' + scenarioRate.toFixed(2) + ')');
				return undefined;
			}

			// 4️⃣ 全局采纳率过滤
			const acceptanceRate = this.getAcceptanceRate();
			if (acceptanceRate < this.acceptanceThreshold && triggerScore.score < 0.8) {
				console.log('[AI Inline Completions] ⏳ Skip: low global acceptance rate (' + acceptanceRate.toFixed(2) + ')');
				return undefined;
			}

			// 保存当前场景（用于后续记录采纳/拒绝）
			this.lastTriggerScenario = scenarioKey;

			// 4️⃣ 最小请求间隔（动态调整）
			const effectiveInterval = triggerScore.score > 0.8 ? this.adaptiveMinInterval * 0.5 : this.adaptiveMinInterval;
			if (timeSinceLastRequest < effectiveInterval) {
				console.log('[AI Inline Completions] ⏳ Debounce: too soon (' + timeSinceLastRequest + 'ms < ' + effectiveInterval.toFixed(0) + 'ms)');
				return undefined;
			}

			// 5️⃣ 更新输入历史（用于自适应调整）
			if (this.lastInputTime > 0) {
				const inputInterval = now - this.lastInputTime;
				this.inputIntervalHistory.push(inputInterval);
				if (this.inputIntervalHistory.length > this.maxHistorySize) {
					this.inputIntervalHistory.shift();
				}
			}
			this.lastInputTime = now;

			// 6️⃣ 动态调整防抖参数
			this.updateAdaptiveDebounce();

			// 取消之前的待处理请求
			if (this.pendingCancellation) {
				this.pendingCancellation.cancel();
				this.pendingCancellation = undefined;
			}

			// 清除之前的防抖计时器
			if (this.debounceTimer) {
				clearTimeout(this.debounceTimer);
				this.debounceTimer = undefined;
			}

			// 使用 Promise 实现防抖等待
			const currentDebounceDelay = this.adaptiveDebounceDelay;
			const shouldProceed = await new Promise<boolean>((resolve) => {
				this.debounceTimer = setTimeout(() => {
					this.debounceTimer = undefined;
					// 检查是否已被取消
					if (token.isCancellationRequested) {
						resolve(false);
					} else {
						resolve(true);
					}
				}, currentDebounceDelay);
			});

			if (!shouldProceed || token.isCancellationRequested) {
				console.log('[AI Inline Completions] ⏳ Debounce: request cancelled during wait');
				return undefined;
			}

			// 更新最后请求时间
			this.lastRequestTime = Date.now();
			console.log('[AI Inline Completions] ⏳ Debounce: proceeding after ' + currentDebounceDelay + 'ms wait (adaptive)');
		}

		// 通过 extractContext 获取完整上下文（50行前+50行后+LSP类型信息）
		// 基础检查：prefix 为空时需要有代码上下文才值得请求
		// 具体的 hasGoodContext 检查在 extractContext 之后进行

		console.log('[AI Inline Completions] Extracting enhanced context...');

		// Extract enhanced context using the new context extractor
		const enhancedContext = await this.contextExtractor.extractContext(model, position, token);

		console.log('[AI Inline Completions] Enhanced context:', {
			prefix: enhancedContext.prefix.substring(0, 50),
			currentClass: enhancedContext.currentClass,
			currentMethod: enhancedContext.currentMethod,
			frameworks: enhancedContext.frameworks,
			importsCount: enhancedContext.imports?.length || 0,
			// 🆕 增强的上下文信息
			hasMethodReference: !!enhancedContext.methodReference,
			methodRefClass: enhancedContext.methodReference?.className,
			methodRefCandidates: enhancedContext.methodReference?.candidates?.length || 0,
			typeDefinitionsCount: enhancedContext.typeDefinitions?.length || 0,
			variableTypesCount: enhancedContext.variableTypes?.size || 0
		});

		// 🆕 追踪模型编辑历史，并注入到 context（参考 Copilot NES edit_diff_history）
		this.ensureModelTracked(model);
		const modelKey = model.uri.toString();
		const recentEditsRaw = this.recentEditsMap.get(modelKey);
		if (recentEditsRaw && recentEditsRaw.length > 0) {
			// 取最近5次编辑，过滤掉当前补全触发前1秒内的（避免噪音）
			const now = Date.now();
			enhancedContext.recentEdits = recentEditsRaw
				.filter(edit => (now - edit.timestamp) > 100)
				.slice(-5)
				.map(edit => ({ range: edit.range, text: edit.text }));
		}

		// Build enhanced prompt with structural information（FIM格式，前后缀分离）
		const { fimPrefix, fimSuffix } = await this.buildEnhancedPrompt(enhancedContext);

		// 检查缓存
		const cacheKey = this.generateCacheKey(enhancedContext);
		const cachedCompletions = this.getCachedCompletion(cacheKey);
		if (cachedCompletions && cachedCompletions.length > 0) {
			console.log('[AI Inline Completions] 💾 Using cached completions');
			// 直接返回缓存结果
			const items: InlineCompletion[] = cachedCompletions.map(completion => ({
				insertText: completion,
				range: {
					startLineNumber: position.lineNumber,
					startColumn: position.column,
					endLineNumber: position.lineNumber,
					endColumn: position.column
				}
			}));
			// 更新冷却时间（缓存命中也需要冷却）
			this.lastCompletionTime = Date.now();
			return { items };
		}

		// extractCompletions 时需要光标前内容（当前行的 prefix）
		const currentLinePrefix = enhancedContext.prefix;

		try {
			console.log('[AI Inline Completions] Calling AI service (FIM mode)...');
			const requestStartTime = Date.now();

			// 使用 /completions FIM 端点，qwen-coder-turbo 原生支持 Fill-in-the-Middle
			const aiResponse = await this.aiService.complete(fimPrefix, {
				temperature: 0.05,
				maxTokens: 128,    // FIM 补全通常 <50 tokens，128 足够且避免超时
				apiType: 'completions',
				fimSuffix: fimSuffix,
				businessCode: 'IDE_CODE_COMPLETION'
			});

			// 记录响应时间
			const responseTime = Date.now() - requestStartTime;
			this.recordResponseTime(responseTime);
			console.log('[AI Inline Completions] AI response time:', responseTime + 'ms, length:', aiResponse.length);

			// Extract and clean the completion
			let completions = this.extractCompletions(aiResponse, currentLinePrefix, enhancedContext.suffix, enhancedContext.afterLines);
			console.log('[AI Inline Completions] Extracted completions:', completions.length);

			// 验证补全内容
			const validatedCompletions: string[] = [];
			for (const completion of completions) {
				const validationResult = this.completionValidator.validate(completion, enhancedContext);
				console.log('[AI Inline Completions] 🔍 Validation result:',
					'valid=' + validationResult.isValid,
					'score=' + validationResult.confidenceScore.toFixed(2),
					'issues=' + validationResult.issues.length);

				if (!this.completionValidator.shouldReject(validationResult)) {
					validatedCompletions.push(completion);
				} else {
					console.warn('[AI Inline Completions] ❌ Rejected completion due to validation issues:',
						validationResult.issues.map(i => i.message).join(', '));
				}
			}

			// 使用验证后的补全
			completions = validatedCompletions;

			if (completions.length === 0) {
				console.warn('[AI Inline Completions] No valid completions after validation');
				return undefined;
			}

			// 使用排序器对补全进行多维度排序
			const validationScoreMap = new Map<string, number>();
			for (const completion of completions) {
				const result = this.completionValidator.validate(completion, enhancedContext);
				validationScoreMap.set(completion, result.confidenceScore);
			}

			const rankedCompletions = completionRanker.rank(completions, enhancedContext, validationScoreMap);
			console.log('[AI Inline Completions] 📊 Ranked completions:', rankedCompletions.map(r => ({
				score: r.score,
				reason: r.reason,
				preview: r.text.substring(0, 40)
			})));

			// 使用排序后的补全
			const sortedCompletions = rankedCompletions.map(r => r.text);
			const avgScore = rankedCompletions.length > 0
				? rankedCompletions.reduce((sum, r) => sum + r.score, 0) / rankedCompletions.length
				: 0;

			// 缓存结果（包含验证分数）
			this.cacheCompletion(cacheKey, sortedCompletions, avgScore / 100);

			// 保存最后一次补全上下文（用于反馈收集）
			this.lastCompletionContext = {
				completions: sortedCompletions,
				context: enhancedContext,
				score: avgScore,
				responseTime
			};

			// Convert to InlineCompletion items
			// Provide explicit range for better compatibility
			const items: InlineCompletion[] = sortedCompletions.map(completion => {
				const item: InlineCompletion = {
					insertText: completion,
					range: {
						startLineNumber: position.lineNumber,
						startColumn: position.column,
						endLineNumber: position.lineNumber,
						endColumn: position.column
					}
				};
				return item;
			});

			console.log('[AI Inline Completions] Providing', items.length, 'suggestions:', items.map(i => ({
				text: typeof i.insertText === 'string' ? i.insertText.substring(0, 50) : 'snippet',
				length: typeof i.insertText === 'string' ? i.insertText.length : 0
			})));

			// 更新冷却时间
			this.lastCompletionTime = Date.now();

			return {
				items
			};
		} catch (error) {
			console.error('[AI Inline Completions] Error:', error);
			return undefined;
		}
	}

	/**
	 * 提取 AI 返回的代码补全（强化过滤 + 前缀/后缀去重）
	 */
	private extractCompletions(aiResponse: string, prefix: string, suffix: string = '', afterLines: string[] = []): string[] {
		// Qwen3-Coder FIM 模型直接输出补全代码，不会有 markdown 或解释文字
		let cleaned = aiResponse.trim();

		// 清理 markdown 代码块（Chat API 模式下模型仍会输出 markdown）
		const codeBlockMatch = cleaned.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
		if (codeBlockMatch) {
			cleaned = codeBlockMatch[1].trim();
		} else {
			// 移除单独的 ``` 标记
			cleaned = cleaned.replace(/```\w*/g, '').trim();
		}

		// 移除可能残留的 FIM 特殊 token（防御性处理）
		cleaned = cleaned
			.replace(/<\|fim_prefix\|>/g, '')
			.replace(/<\|fim_suffix\|>/g, '')
			.replace(/<\|fim_middle\|>/g, '')
			.replace(/<\|fim_pad\|>/g, '')
			.replace(/<\|endoftext\|>/g, '')
			.trim();

		if (!cleaned) {
			return [];
		}

		// 移除前缀重复（FIM 模型有时会回显已有内容）
		cleaned = this.removePrefixDuplication(cleaned, prefix);

		// 移除后缀重叠（截断模型多生成的光标后内容）
		cleaned = this.removeSuffixOverlap(cleaned, suffix, afterLines);

		if (!cleaned.trim()) {
			return [];
		}

		const results: string[] = [];
		const allLines = cleaned.split('\n');

		// 主补全：最多 15 行
		const fullCompletion = allLines.slice(0, 15).join('\n');
		if (fullCompletion.trim()) {
			results.push(fullCompletion);
		}

		// 若超过 4 行，额外提供只补第一行的选项
		if (allLines.length > 4) {
			const firstLine = allLines[0];
			if (firstLine.trim() && firstLine !== fullCompletion) {
				results.push(firstLine);
			}
		}

		console.log('[AI Inline Completions] Extracted', results.length, 'completions, lengths:', results.map(r => r.length));
		return results;
	}

	/**
	 * 移除 AI 返回内容末尾与光标后代码重叠的部分
	 * 解决 AI 生成的代码末尾包含光标后已存在代码的问题
	 * 例如：光标后已有 ")" , AI 返回 "value)" -> 应截断为 "value"
	 */
	private removeSuffixOverlap(response: string, suffix: string, afterLines: string[]): string {
		// 构建光标后的完整文本（suffix 是当前行光标后内容，afterLines 是后续行）
		const afterText = suffix + (afterLines.length > 0 ? '\n' + afterLines.join('\n') : '');
		if (!afterText.trim()) {
			return response;
		}

		// 从最长匹配开始尝试（最多比较 200 字符）
		const maxOverlapLen = Math.min(afterText.length, 200);
		for (let i = maxOverlapLen; i >= 3; i--) {
			const afterStart = afterText.substring(0, i);
			// 检查 response 末尾是否包含 afterStart
			if (response.endsWith(afterStart)) {
				const truncated = response.substring(0, response.length - i);
				// 确保截断后不为空
				if (truncated.trim().length > 0) {
					console.log('[AI Inline Completions] 🔧 Removed suffix overlap:', JSON.stringify(afterStart.substring(0, 40)));
					return truncated;
				}
			}
		}

		// 还需检查响应是否包含了 afterLines 的第一行（AI生成了不该生成的后续行代码）
		if (afterLines.length > 0) {
			const firstAfterLine = afterLines[0].trim();
			if (firstAfterLine.length > 5) {
				const responseLines = response.split('\n');
				// 从后向前找到最后一个与 afterLines[0] 匹配的行，并截断
				let lastMatchIdx = -1;
				for (let i = responseLines.length - 1; i >= 1; i--) {
					if (responseLines[i].trim() === firstAfterLine) {
						lastMatchIdx = i;
						break;
					}
				}
				if (lastMatchIdx > 0) {
					const truncated = responseLines.slice(0, lastMatchIdx).join('\n');
					if (truncated.trim().length > 0) {
						console.log('[AI Inline Completions] 🔧 Removed suffix line overlap at line:', lastMatchIdx);
						return truncated;
					}
				}
			}
		}

		return response;
	}

	/**
	 * 移除 AI 返回内容中与用户已输入前缀重复的部分
	 * 解决 "return " -> "return xxx" 应用后变成 "return return xxx" 的问题
	 */
	private removePrefixDuplication(response: string, prefix: string): string {
		if (!prefix || prefix.trim().length === 0) {
			return response;
		}

		const prefixTrimmed = prefix.trim();
		const prefixWords = prefixTrimmed.split(/\s+/);
		const lastWord = prefixWords[prefixWords.length - 1];

		// 检查响应是否以前缀的最后一个词开始（常见重复场景）
		// 例如：用户输入 "return "，AI 返回 "return result;"
		if (lastWord && response.trim().toLowerCase().startsWith(lastWord.toLowerCase())) {
			const responseLines = response.split('\n');
			const firstLine = responseLines[0];

			// 尝试找到重复的部分并移除
			const lowerFirstLine = firstLine.toLowerCase();
			const lowerLastWord = lastWord.toLowerCase();

			if (lowerFirstLine.startsWith(lowerLastWord)) {
				// 移除重复的词
				const remaining = firstLine.substring(lastWord.length);
				responseLines[0] = remaining.trimStart();
				const result = responseLines.join('\n');
				console.log('[AI Inline Completions] 🔧 Removed prefix duplication:', lastWord, '-> trimmed');
				return result;
			}
		}

		// 检查更长的前缀重复（整行重复）
		const responseFirstLine = response.split('\n')[0].trim();
		const prefixLine = prefix.trim();

		// 如果响应的第一行完全包含前缀
		if (responseFirstLine.startsWith(prefixLine)) {
			const remaining = response.substring(prefixLine.length);
			if (remaining.trim().length > 0) {
				console.log('[AI Inline Completions] 🔧 Removed full prefix duplication');
				return remaining.trimStart();
			}
		}

		// 检查前缀末尾与响应开头的重叠
		// 例如：prefix="getData(" response="getData(id)" -> 应返回 "id)"
		for (let i = Math.min(prefixTrimmed.length, 50); i > 0; i--) {
			const prefixEnd = prefixTrimmed.slice(-i);
			if (response.startsWith(prefixEnd)) {
				const result = response.substring(i);
				if (result.trim().length > 0) {
					console.log('[AI Inline Completions] 🔧 Removed overlapping prefix:', prefixEnd);
					return result;
				}
			}
		}

		return response;
	}

	/**
	 * Build enhanced FIM prompt (Fill-in-the-Middle)
	 * 返回 fimPrefix 和 fimSuffix，由后端通过 /completions 端点调用 qwen-coder-turbo 原生 FIM 接口
	 *
	 * FIM 格式: <|fim_prefix|>{fimPrefix}<|fim_suffix|>{fimSuffix}<|fim_middle|>
	 * 由后端 buildFimPrompt() 拼装后发送到 DashScope /completions 端点
	 */
	private async buildEnhancedPrompt(context: CompletionContext): Promise<{ fimPrefix: string; fimSuffix: string }> {
		const prefixParts: string[] = [];

		// 1. 文件路径注释（帮助模型了解文件类型和语言）
		const filename = context.fileUri.path.split('/').pop() || '';
		prefixParts.push(`// File: ${filename}`);

		// 2. 类型约束注入（保留 LSP 类型检测优势，注入为代码注释）
		// 方法引用约束（Java ClassName:: 场景）
		if (context.methodReference && context.methodReference.candidates.length > 0) {
			const candidates = context.methodReference.candidates.slice(0, 20).join(', ');
			prefixParts.push(`// Available methods in ${context.methodReference.className}: ${candidates}`);
		}

		// 类型成员约束（防止幻觉方法/字段）
		if (context.typeDefinitions && context.typeDefinitions.length > 0) {
			for (const typeDef of context.typeDefinitions.slice(0, 3)) {
				const methods = typeDef.enhancedMethods
					? typeDef.enhancedMethods.filter(m => m.accessModifier !== 'private').slice(0, 10).map(m => m.signature || m.name)
					: typeDef.methods.slice(0, 10);
				const fields = typeDef.enhancedFields
					? typeDef.enhancedFields.slice(0, 5).map(f => `${f.type} ${f.name}`)
					: typeDef.fields.slice(0, 5);
				if (methods.length > 0 || fields.length > 0) {
					const memberInfo = [...fields, ...methods].join(', ');
					prefixParts.push(`// ${typeDef.typeName} members: ${memberInfo}`);
				}
			}
		}

		// 3. 光标前的代码（主体）
		const beforeCode = context.beforeLines.join('\n');
		if (beforeCode) {
			prefixParts.push(beforeCode);
		}
		prefixParts.push(context.prefix);  // 当前行光标前内容（可能包含注释、代码片段）

		// 4. 光标后的代码（suffix）- 只取 20 行，减少模型处理量
		const suffixParts: string[] = [];
		if (context.suffix) {
			suffixParts.push(context.suffix);  // 当前行光标后内容
		}
		const afterCode = context.afterLines.slice(0, 20).join('\n');
		if (afterCode) {
			suffixParts.push(afterCode);
		}

		const fimPrefix = prefixParts.join('\n');
		const fimSuffix = suffixParts.join('\n');

		console.log('[AI Inline Completions] FIM prompt built, prefix_len:', fimPrefix.length, 'suffix_len:', fimSuffix.length);
		return { fimPrefix, fimSuffix };
	}

	freeInlineCompletions(): void {
		// Cleanup if needed
	}

	/**
	 * 🆕 编辑历史追踪 - 确保模型已被订阅（参考 Copilot NES edit_diff_history）
	 * 订阅模型的内容变更事件，记录最近的代码修改历史
	 */
	private ensureModelTracked(model: ITextModel): void {
		const modelKey = model.uri.toString();
		if (this.trackedModels.has(modelKey)) {
			return;
		}

		// 订阅模型内容变更事件
		const changeDisposable = model.onDidChangeContent(event => {
			const edits = this.recentEditsMap.get(modelKey) || [];

			for (const change of event.changes) {
				edits.push({
					timestamp: Date.now(),
					range: new Range(
						change.range.startLineNumber,
						change.range.startColumn,
						change.range.endLineNumber,
						change.range.endColumn
					),
					text: change.text
				});
			}

			// 保留最近 N 次编辑，避免内存泄漏
			while (edits.length > this.maxEditHistoryPerModel) {
				edits.shift();
			}

			this.recentEditsMap.set(modelKey, edits);
		});

		this.trackedModels.set(modelKey, changeDisposable);

		// 模型销毁时清理资源
		const disposeListener = model.onWillDispose(() => {
			changeDisposable.dispose();
			disposeListener.dispose();
			this.trackedModels.delete(modelKey);
			this.recentEditsMap.delete(modelKey);
		});
	}

	/**
	 * 🆕 计算触发评分 - 智能判断是否应该触发补全
	 * 参考 Copilot 的 contextualFilterScore 机制
	 */
	private calculateTriggerScore(prefix: string, lineContent: string, position: Position, model: ITextModel): { score: number; reason: string } {
		let score = 0.5; // 基础分数
		const reasons: string[] = [];

		const prefixTrimmed = prefix.trim();
		const lastChar = prefix.slice(-1);
		const lastWord = prefixTrimmed.split(/\s+/).pop() || '';

		// 1️⃣ 触发字符加分（高优先级触发点）
		if (this.triggerCharacters.has(lastChar)) {
			score += 0.3;
			reasons.push('trigger_char:' + lastChar);
		}

		// 2️⃣ 关键字后加分
		if (this.triggerKeywords.has(lastWord.toLowerCase())) {
			score += 0.25;
			reasons.push('keyword:' + lastWord);
		}

		// 3️⃣ 行尾场景（函数定义、条件语句等）
		if (lastChar === '{' || lastChar === '(' || lineContent.trim().endsWith(':')) {
			score += 0.2;
			reasons.push('block_start');
		}

		// 4️⃣ 换行后有上下文
		if (prefixTrimmed.length === 0) {
			const prevLineNum = position.lineNumber - 1;
			if (prevLineNum >= 1) {
				const prevLine = model.getLineContent(prevLineNum).trim();
				if (prevLine.length > 0 && !prevLine.startsWith('//') && !prevLine.startsWith('*')) {
					score += 0.15;
					reasons.push('newline_after_code');
				} else {
					score -= 0.2;
					reasons.push('newline_after_comment');
				}
			}
		}

		// 5️⃣ 输入足够长度
		if (prefixTrimmed.length >= 3) {
			score += 0.1;
			reasons.push('sufficient_prefix');
		} else if (prefixTrimmed.length < 1 && lastChar !== '\n') {
			score -= 0.3;
			reasons.push('too_short');
		}

		// 6️⃣ 方法调用链检测（如 obj.method().）
		if (/\.[a-zA-Z_$][a-zA-Z0-9_$]*\.$/.test(prefix) || /\.[a-zA-Z_$][a-zA-Z0-9_$]*\(/.test(prefix)) {
			score += 0.2;
			reasons.push('method_chain');
		}

		// 7️⃣ 赋值语句右侧
		if (/=\s*$/.test(prefix) || /:\s*$/.test(prefix)) {
			score += 0.2;
			reasons.push('assignment_rhs');
		}

		// 8️⃣ 注释中不触发
		if (/^\s*(\/\/|\/\*|\*)/.test(lineContent)) {
			score -= 0.5;
			reasons.push('in_comment');
		}

		// 9️⃣ 字符串中降低优先级
		const quoteCount = (prefix.match(/["'`]/g) || []).length;
		if (quoteCount % 2 === 1) {
			score -= 0.2;
			reasons.push('in_string');
		}

		return {
			score: Math.max(0, Math.min(1, score)),
			reason: reasons.join(', ')
		};
	}

	/**
	 * 🆕 获取全局采纳率
	 */
	private getAcceptanceRate(): number {
		const total = this.acceptedCount + this.rejectedCount;
		if (total < 5) {
			return 0.5; // 样本太少，返回中性值
		}
		return this.acceptedCount / total;
	}

	/**
	 * 🆕 获取场景键（用于场景统计）
	 */
	private getScenarioKey(reason: string): string {
		// 从触发原因中提取主要场景
		// 例如: "trigger_char:., method_chain" -> "trigger_char:."
		const parts = reason.split(', ');
		if (parts.length > 0) {
			return parts[0]; // 使用第一个原因作为场景键
		}
		return 'unknown';
	}

	/**
	 * 🆕 获取场景采纳率
	 */
	private getScenarioAcceptanceRate(scenarioKey: string): number {
		const stats = this.scenarioStats.get(scenarioKey);
		if (!stats) {
			return 0.5; // 无数据，返回中性值
		}
		const total = stats.accepted + stats.rejected;
		if (total < 3) {
			return 0.5; // 样本太少
		}
		return stats.accepted / total;
	}

	/**
	 * 🆕 记录补全被采纳（包含场景学习）
	 */
	public recordAcceptance(): void {
		this.acceptedCount++;

		// 场景学习
		if (this.lastTriggerScenario) {
			const stats = this.scenarioStats.get(this.lastTriggerScenario) || { accepted: 0, rejected: 0 };
			stats.accepted++;
			this.scenarioStats.set(this.lastTriggerScenario, stats);
			console.log('[AI Inline Completions] ✅ Accepted in scenario "' + this.lastTriggerScenario + '". Scenario rate:', this.getScenarioAcceptanceRate(this.lastTriggerScenario).toFixed(2));
		}

		console.log('[AI Inline Completions] ✅ Global rate:', this.getAcceptanceRate().toFixed(2));
	}

	/**
	 * 🆕 记录补全被拒绝（包含场景学习）
	 */
	public recordRejection(): void {
		this.rejectedCount++;

		// 场景学习
		if (this.lastTriggerScenario) {
			const stats = this.scenarioStats.get(this.lastTriggerScenario) || { accepted: 0, rejected: 0 };
			stats.rejected++;
			this.scenarioStats.set(this.lastTriggerScenario, stats);
			console.log('[AI Inline Completions] ❌ Rejected in scenario "' + this.lastTriggerScenario + '". Scenario rate:', this.getScenarioAcceptanceRate(this.lastTriggerScenario).toFixed(2));
		}

		console.log('[AI Inline Completions] ❌ Global rate:', this.getAcceptanceRate().toFixed(2));
	}

	/**
	 * 🆕 获取场景统计信息（用于调试）
	 */
	public getScenarioStats(): Map<string, { accepted: number; rejected: number; rate: number }> {
		const result = new Map<string, { accepted: number; rejected: number; rate: number }>();
		for (const [key, stats] of this.scenarioStats) {
			const total = stats.accepted + stats.rejected;
			result.set(key, {
				...stats,
				rate: total > 0 ? stats.accepted / total : 0
			});
		}
		return result;
	}

	/**
	 * 更新自适应防抖参数
	 * 根据响应时间和用户输入速度动态调整
	 */
	private updateAdaptiveDebounce(): void {
		// 根据响应时间调整
		if (this.responseTimeHistory.length >= 3) {
			const avgResponseTime = this.responseTimeHistory.reduce((a, b) => a + b, 0) / this.responseTimeHistory.length;

			if (avgResponseTime > this.slowThreshold) {
				// 响应慢，增加防抖时间
				this.adaptiveDebounceDelay = Math.min(this.baseDebounceDelay * 2, 800);
				this.adaptiveMinInterval = Math.min(this.baseMinRequestInterval * 1.5, 1000);
			} else if (avgResponseTime < this.fastThreshold) {
				// 响应快，减少防抖时间
				this.adaptiveDebounceDelay = Math.max(this.baseDebounceDelay * 0.7, 150);
				this.adaptiveMinInterval = Math.max(this.baseMinRequestInterval * 0.7, 300);
			} else {
				// 正常响应，使用基础值
				this.adaptiveDebounceDelay = this.baseDebounceDelay;
				this.adaptiveMinInterval = this.baseMinRequestInterval;
			}
		}

		// 根据用户输入速度调整
		if (this.inputIntervalHistory.length >= 3) {
			const avgInputInterval = this.inputIntervalHistory.reduce((a, b) => a + b, 0) / this.inputIntervalHistory.length;

			// 如果用户输入很快（小于200ms），增加防抖避免过多请求
			if (avgInputInterval < 200) {
				this.adaptiveDebounceDelay = Math.max(this.adaptiveDebounceDelay, avgInputInterval * 2);
			}
		}

		console.log('[AI Inline Completions] 📊 Adaptive debounce updated:',
			'delay=' + this.adaptiveDebounceDelay + 'ms',
			'interval=' + this.adaptiveMinInterval + 'ms');
	}

	/**
	 * 记录响应时间
	 */
	private recordResponseTime(timeMs: number): void {
		this.responseTimeHistory.push(timeMs);
		if (this.responseTimeHistory.length > this.maxHistorySize) {
			this.responseTimeHistory.shift();
		}
	}

	/**
	 * 生成补全缓存的 key
	 */
	private generateCacheKey(context: CompletionContext): string {
		// 必须包含 beforeLines 的最近内容，否则空行场景下 prefix 相同导致缓存命中同一结果
		const recentBeforeLines = context.beforeLines.slice(-5).join('\n').slice(-200);
		const keyParts = [
			context.languageId,
			recentBeforeLines,             // 光标前最近 5 行内容
			context.prefix.slice(-100),    // 当前行光标前内容
			context.suffix.slice(0, 50),   // 当前行光标后内容
			context.currentClass || '',
			context.currentMethod || ''
		];
		return keyParts.join('|');
	}

	/**
	 * 从缓存获取补全结果（使用多层缓存服务）
	 */
	private getCachedCompletion(cacheKey: string): string[] | undefined {
		// 优先使用 L1 内存缓存（同步）
		const cached = this.completionCache.get(cacheKey);
		if (cached && (Date.now() - cached.timestamp) < this.completionCacheTTL) {
			console.log('[AI Inline Completions] 💾 L1 Cache hit for completion');
			return cached.result;
		}

		// 注意：L2/L3 是异步的，这里保持同步接口兼容性
		// 异步缓存命中会在下次请求时生效
		return undefined;
	}

	/**
	 * 从缓存获取补全结果（异步版本，使用多层缓存）
	 * 用于预加载和缓存预热场景
	 */
	public async getCachedCompletionAsync(cacheKey: string): Promise<string[] | undefined> {
		// 使用多层缓存服务
		const cached = await completionCacheService.get(cacheKey);
		if (cached) {
			console.log('[AI Inline Completions] 💾 Multi-layer cache hit');
			// 同步到 L1
			this.completionCache.set(cacheKey, {
				result: cached.completions,
				timestamp: Date.now()
			});
			return cached.completions;
		}
		return undefined;
	}

	/**
	 * 添加补全结果到缓存（写入多层缓存）
	 */
	private cacheCompletion(cacheKey: string, result: string[], validationScore?: number): void {
		// 写入 L1 内存缓存
		if (this.completionCache.size >= this.maxCompletionCacheSize) {
			const firstKey = this.completionCache.keys().next().value;
			if (firstKey) {
				this.completionCache.delete(firstKey);
			}
		}
		this.completionCache.set(cacheKey, {
			result,
			timestamp: Date.now()
		});

		// 异步写入多层缓存
		const cacheData: CompletionCacheData = {
			completions: result,
			validationScore
		};
		completionCacheService.set(cacheKey, cacheData).catch(err => {
			console.warn('[AI Inline Completions] Failed to write to multi-layer cache:', err);
		});
	}

	/**
	 * 清除补全缓存
	 */
	clearCompletionCache(): void {
		this.completionCache.clear();
		completionCacheService.clear().catch(() => { });
	}

	/**
	 * 获取缓存统计信息
	 */
	getCacheStats(): { l1Size: number; multiLayerStats: any } {
		return {
			l1Size: this.completionCache.size,
			multiLayerStats: completionCacheService.getStats()
		};
	}

	/**
	 * 记录用户接受了补全
	 */
	recordCompletionAccepted(completionText: string): void {
		if (this.lastCompletionContext) {
			completionFeedbackService.recordAccepted(
				completionText,
				{
					languageId: this.lastCompletionContext.context.languageId,
					currentClass: this.lastCompletionContext.context.currentClass,
					currentMethod: this.lastCompletionContext.context.currentMethod,
					framework: this.lastCompletionContext.context.frameworkContext?.name,
					prefix: this.lastCompletionContext.context.prefix
				},
				this.lastCompletionContext.score,
				this.lastCompletionContext.responseTime
			);
			// 记录到排序器以学习用户习惯
			completionRanker.recordAcceptedCompletion(completionText);
		}
	}

	/**
	 * 记录用户拒绝了补全
	 */
	recordCompletionRejected(): void {
		if (this.lastCompletionContext && this.lastCompletionContext.completions.length > 0) {
			completionFeedbackService.recordRejected(
				this.lastCompletionContext.completions[0],
				{
					languageId: this.lastCompletionContext.context.languageId,
					currentClass: this.lastCompletionContext.context.currentClass,
					currentMethod: this.lastCompletionContext.context.currentMethod,
					framework: this.lastCompletionContext.context.frameworkContext?.name,
					prefix: this.lastCompletionContext.context.prefix
				},
				this.lastCompletionContext.score,
				this.lastCompletionContext.responseTime
			);
		}
	}

	/**
	 * 获取反馈统计
	 */
	getFeedbackStats(): any {
		return completionFeedbackService.getStats();
	}

	/**
	 * 获取优化建议
	 */
	getOptimizationSuggestions(): any[] {
		return completionFeedbackService.generateOptimizationSuggestions();
	}
}
