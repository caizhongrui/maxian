/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Position } from '../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { InlineCompletion, InlineCompletionContext, InlineCompletions, InlineCompletionsProvider } from '../../../../editor/common/languages.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IMultiLanguageService } from '../../multilang/browser/multilang.contribution.js';
import { CompletionContextExtractor, CompletionContext } from './completionContextExtractor.js';
import { CompletionValidator } from './completionValidator.js';
import { IRequestService, asJson } from '../../../../platform/request/common/request.js';
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

	// 动态防抖参数 - 短防抖 + 智能过滤（参考 Copilot 75ms，折中取 150ms）
	private baseDebounceDelay = 150; // 150ms（Copilot 是 75ms）
	private baseMinRequestInterval = 500; // 500ms 最小间隔
	private adaptiveDebounceDelay = 150;
	private adaptiveMinInterval = 500;

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

	constructor(
		private readonly aiService: IAIService,
		private readonly configurationService: IConfigurationService,
		private readonly requestService: IRequestService,
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

		// Get complete context: before and after cursor
		// (lineContent and prefix already declared above for debugging)
		// suffix is included in enhancedContext later

		// Get previous lines (up to 30 lines)
		const startLine = Math.max(1, position.lineNumber - 30);
		const beforeLines: string[] = [];
		for (let i = startLine; i < position.lineNumber; i++) {
			beforeLines.push(model.getLineContent(i));
		}

		// Get following lines (up to 30 lines)
		const totalLines = model.getLineCount();
		const endLine = Math.min(totalLines, position.lineNumber + 30);
		const afterLines: string[] = [];
		for (let i = position.lineNumber + 1; i <= endLine; i++) {
			afterLines.push(model.getLineContent(i));
		}

		// Need minimal context to proceed
		const hasGoodContext = beforeLines.some(line => line.trim().length > 0) ||
		                       afterLines.some(line => line.trim().length > 0);

		if (prefix.trim().length === 0 && !hasGoodContext) {
			return undefined;
		}

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

		// Build enhanced prompt with structural information
		const prompt = await this.buildEnhancedPrompt(enhancedContext);

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

		try {
			console.log('[AI Inline Completions] Calling AI service...');
			const requestStartTime = Date.now();

			// 使用优化的参数调用 AI
			const aiResponse = await this.aiService.complete(prompt, {
				temperature: 0.05,  // 极低温度，确保输出确定性（从0.1降低到0.05）
				maxTokens: 1200,   // 支持较长的代码补全
				systemMessage: 'You are a code completion engine. Output ONLY code, NO explanations, NO markdown, NO conversational text. NEVER generate methods or fields that do not exist in the provided type definitions.',
				businessCode: 'IDE_CODE_COMPLETION'  // 代码补全业务场景
			});

			// 记录响应时间
			const responseTime = Date.now() - requestStartTime;
			this.recordResponseTime(responseTime);
			console.log('[AI Inline Completions] AI response time:', responseTime + 'ms, length:', aiResponse.length);

			// Extract and clean the completion
			let completions = this.extractCompletions(aiResponse, prefix);
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
	 * 提取 AI 返回的代码补全（强化过滤 + 前缀去重）
	 */
	private extractCompletions(aiResponse: string, prefix: string): string[] {
		const results: string[] = [];

		// 步骤 1: 清理 markdown 代码块
		let cleanedResponse = aiResponse.trim();
		const codeBlockMatch = cleanedResponse.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
		if (codeBlockMatch) {
			cleanedResponse = codeBlockMatch[1].trim();
		} else {
			// 移除所有 ``` 标记
			cleanedResponse = cleanedResponse.replace(/```/g, '').trim();
		}

		// 步骤 2: 检测并过滤对话式文本（扩展模式）
		const conversationalPatterns = [
			/^(it seems|i think|i would|i can|let me|here|sorry|i'm|could you|please|would you|you can|you should|you may)/i,
			/^(this|that|the code|here's|this is|that is|this will|here are)/i,
			/^(to |in order to |we |you |I )\s/i, // 以介词或人称开头 (移除 for,避免误过滤 for 循环)
			/\?$/, // 以问号结尾
			/^(注意|请注意|说明|解释|这里|这个|这段)/  // 中文对话
		];

		const firstLine = cleanedResponse.split('\n')[0];
		for (const pattern of conversationalPatterns) {
			if (pattern.test(firstLine)) {
				console.warn('[AI Inline Completions] Filtered conversational response:', firstLine.substring(0, 50));
				return [];
			}
		}

		// 步骤 3: 检测是否包含代码特征（必须包含至少一个）
		const codePatterns = [
			/[{}\[\]();]/,  // 代码符号
			/\b(function|const|let|var|if|for|while|class|def|return|import|public|private|protected)\b/,  // 关键字
			/[a-zA-Z_$][a-zA-Z0-9_$]*\s*[:=]/,  // 赋值语句
			/\.[a-zA-Z_$]/,  // 方法调用
			/=>/  // 箭头函数
		];

		const hasCodeFeatures = codePatterns.some(pattern => pattern.test(cleanedResponse));
		if (!hasCodeFeatures && cleanedResponse.length > 50) {
			console.warn('[AI Inline Completions] Response lacks code features, likely explanation text');
			return [];
		}

		// 🆕 步骤 3.5: 移除前缀重复 - 关键修复！
		// 如果 AI 返回的内容以用户已输入的前缀开头，需要移除
		cleanedResponse = this.removePrefixDuplication(cleanedResponse, prefix);

		// 步骤 4: 分割为行并处理
		const allLines = cleanedResponse.split('\n');

		// 过滤空结果
		if (allLines.length === 0 || (allLines.length === 1 && allLines[0].trim().length === 0)) {
			console.log('[AI Inline Completions] Empty result after prefix removal');
			return [];
		}

		// 步骤 5: 提供补全选项（优先完整，然后部分）
		// 选项 1: 完整补全（最多 15 行）
		const fullCompletion = allLines.slice(0, 15).join('\n').trim();
		if (fullCompletion && fullCompletion.length > 0 && fullCompletion.length < 1500) {
			results.push(fullCompletion);
		}

		// 选项 2: 如果超过 4 行，提供部分补全
		if (allLines.length > 4) {
			// 前一半
			const halfCompletion = allLines.slice(0, Math.ceil(allLines.length / 2)).join('\n').trim();
			if (halfCompletion !== fullCompletion && halfCompletion.length > 0 && halfCompletion.length < 800) {
				results.push(halfCompletion);
			}

			// 只第一行
			const firstLineOnly = allLines[0].trim();
			if (firstLineOnly && firstLineOnly !== fullCompletion && firstLineOnly !== halfCompletion) {
				results.push(firstLineOnly);
			}
		}

		console.log('[AI Inline Completions] Extracted completions:', {
			count: results.length,
			lengths: results.map(r => r.length),
			previews: results.map(r => r.substring(0, 60) + (r.length > 60 ? '...' : ''))
		});

		return results;
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
	 * Build enhanced prompt with structural code information
	 * 强制 AI 返回纯代码，不返回任何解释
	 */
	private async buildEnhancedPrompt(context: CompletionContext): Promise<string> {
		console.log('[AI Inline Completions] buildEnhancedPrompt called');

		// 尝试从后端获取提示词
		const backendPrompt = await this.fetchCompletionPromptFromBackend(context);
		console.log('[AI Inline Completions] fetchCompletionPromptFromBackend result:', backendPrompt ? 'success' : 'failed');

		if (backendPrompt) {
			console.log('[AI Inline Completions] 使用后端提示词，长度:', backendPrompt.length);
			console.log('[AI Inline Completions] 后端提示词内容（前500字符）:', backendPrompt.substring(0, 500));
			return backendPrompt;
		}

		// 降级：使用本地提示词
		console.log('[AI Inline Completions] 使用本地提示词');
		const parts: string[] = [];

		// 检测是否是换行场景
		const isNewLine = context.prefix.trim().length === 0 && context.suffix.trim().length === 0;

		// 系统角色定义
		parts.push(`你是一个专业的${context.languageId}代码补全引擎。`);
		parts.push('你的任务是预测并生成用户接下来要写的代码。');
		parts.push('');

		// 添加结构化上下文
		const hasStructuredContext = context.currentClass || context.currentMethod ||
			context.frameworks || context.methodParams || context.currentClassFields;

		if (hasStructuredContext) {
			parts.push('【当前上下文】');

			if (context.currentClass) {
				parts.push(`当前类: ${context.currentClass}`);
				if (context.currentMethod) {
					parts.push(`当前方法: ${context.currentMethod}`);
				}
			}

			// 添加方法参数信息（关键！让AI知道可用的变量）
			if (context.methodParams && context.methodParams.length > 0) {
				parts.push(`方法参数: ${context.methodParams.join(', ')}`);
			}

			// 添加类字段信息
			if (context.currentClassFields && context.currentClassFields.length > 0) {
				parts.push(`类字段: ${context.currentClassFields.slice(0, 10).join(', ')}${context.currentClassFields.length > 10 ? '...' : ''}`);
			}

			if (context.frameworks && context.frameworks.length > 0) {
				parts.push(`使用框架: ${context.frameworks.join(', ')}`);
			}

			if (context.imports && context.imports.length > 0) {
				const importSummary = context.imports.slice(0, 8).map((imp: any) => imp.modulePath);
				parts.push(`已导入: ${importSummary.join(', ')}${context.imports.length > 8 ? '...' : ''}`);
			}

			parts.push('');
		}

		// 🆕 添加 Java 方法引用上下文（关键优化！）
		if (context.methodReference) {
			parts.push('【⚠️ 方法引用约束 - 必须严格遵守】');
			parts.push(`当前正在编写 ${context.methodReference.className}::${context.methodReference.methodPrefix || ''} 方法引用`);
			if (context.methodReference.candidates.length > 0) {
				parts.push('');
				parts.push(`🔒 ${context.methodReference.className} 类【仅有】以下方法，禁止生成其他方法名：`);
				parts.push(context.methodReference.candidates.slice(0, 20).join(', '));
				parts.push('');
				parts.push('❌ 严禁生成上述列表中不存在的方法名！');
				parts.push('❌ 如果不确定方法是否存在，宁可不生成！');
			}
			parts.push('');
		}

		// 🆕 添加类型定义信息（从 LSP 获取）- 增强版
		if (context.typeDefinitions && context.typeDefinitions.length > 0) {
			parts.push('【⚠️ 类型约束 - 必须严格遵守】');
			parts.push('以下是上下文中涉及的类型及其【完整】的可用成员：');
			parts.push('');

			for (const typeDef of context.typeDefinitions.slice(0, 5)) {
				parts.push(`🔒 类型 ${typeDef.typeName}：`);

				// 显示字段（增强版）
				if (typeDef.enhancedFields && typeDef.enhancedFields.length > 0) {
					const fieldsList = typeDef.enhancedFields
						.slice(0, 10)
						.map(f => `${f.type} ${f.name}`)
						.join(', ');
					parts.push(`  【字段】${fieldsList}`);
				} else if (typeDef.fields.length > 0) {
					parts.push(`  【字段】${typeDef.fields.slice(0, 10).join(', ')}`);
				}

				// 显示方法（增强版，包含签名）
				if (typeDef.enhancedMethods && typeDef.enhancedMethods.length > 0) {
					const publicMethods = typeDef.enhancedMethods
						.filter(m => m.accessModifier !== 'private')
						.slice(0, 15);
					if (publicMethods.length > 0) {
						const methodsList = publicMethods
							.map(m => m.signature || m.name)
							.join('; ');
						parts.push(`  【方法】${methodsList}`);
					}
				} else if (typeDef.methods.length > 0) {
					parts.push(`  【方法】${typeDef.methods.slice(0, 15).join(', ')}`);
				}

				// 显示继承信息
				if (typeDef.parentClass) {
					parts.push(`  【继承】extends ${typeDef.parentClass}`);
				}
				if (typeDef.interfaces && typeDef.interfaces.length > 0) {
					parts.push(`  【实现】implements ${typeDef.interfaces.join(', ')}`);
				}

				parts.push('');
			}

			parts.push('❌ 严禁调用上述类型中不存在的方法或访问不存在的字段！');
			parts.push('❌ 严禁生成类型中未列出的 getter/setter 方法！');
			parts.push('');
		}

		// 🆕 添加变量类型映射
		if (context.variableTypes && context.variableTypes.size > 0) {
			parts.push('【局部变量类型】');
			const entries = Array.from(context.variableTypes.entries()).slice(0, 10);
			for (const [varName, typeName] of entries) {
				parts.push(`  ${varName}: ${typeName}`);
			}
			parts.push('');
		}

		// 🆕 添加框架特化上下文
		if (context.frameworkContext) {
			const fc = context.frameworkContext;
			parts.push('【框架上下文】');
			parts.push(`框架: ${fc.name}${fc.version ? ` v${fc.version}` : ''}`);

			if (fc.contextType) {
				parts.push(`上下文类型: ${fc.contextType}`);
			}

			if (fc.annotations && fc.annotations.length > 0) {
				parts.push(`已使用注解: ${fc.annotations.join(', ')}`);
			}

			if (fc.hints && fc.hints.length > 0) {
				parts.push('');
				parts.push('💡 框架提示:');
				for (const hint of fc.hints.slice(0, 5)) {
					parts.push(`  - ${hint}`);
				}
			}

			if (fc.patterns && fc.patterns.length > 0) {
				parts.push('');
				parts.push('📝 常用模式:');
				for (const pattern of fc.patterns.slice(0, 3)) {
					parts.push(`  ${pattern}`);
				}
			}

			parts.push('');
		}

		// 🆕 添加跨文件上下文
		if (context.relatedFiles && context.relatedFiles.length > 0) {
			parts.push('【相关文件上下文】');
			parts.push('以下是当前文件导入的相关模块信息，可参考其定义：');
			parts.push('');

			for (const relFile of context.relatedFiles.slice(0, 3)) {
				const fileName = relFile.filepath.split('/').pop() || relFile.filepath;
				parts.push(`📁 ${fileName} (${relFile.fileType}):`);

				if (relFile.definitions.length > 0) {
					parts.push(`  定义: ${relFile.definitions.slice(0, 5).join(', ')}`);
				}

				// 只在摘要较短时添加
				if (relFile.summary && relFile.summary.length < 300) {
					parts.push(`  摘要: ${relFile.summary.substring(0, 200)}...`);
				}

				parts.push('');
			}
		}

		// 代码上下文
		const beforeCode = context.beforeLines.join('\n');
		const afterCode = context.afterLines.join('\n');

		parts.push('【光标前的代码】');
		parts.push('```' + context.languageId);
		parts.push(beforeCode);
		if (context.prefix) {
			parts.push(context.prefix);
		}
		parts.push('```');
		parts.push('');

		if (afterCode.trim()) {
			parts.push('【光标后的代码】');
			parts.push('```' + context.languageId);
			if (context.suffix) {
				parts.push(context.suffix);
			}
			parts.push(afterCode);
			parts.push('```');
			parts.push('');
		}

		// 输出要求
		parts.push('【要求】');
		if (context.methodReference) {
			// Java 方法引用场景的特殊要求
			parts.push(`用户正在输入 ${context.methodReference.className}:: 方法引用。`);
			parts.push('请补全方法名，必须使用上面列出的可用方法之一。');
		} else if (isNewLine) {
			parts.push('用户刚按下回车，请预测下一行代码。');
		} else {
			parts.push('用户正在输入代码，请补全当前行。');
		}
		parts.push('');
		parts.push('【🔒 关键规则 - 必须严格遵守】');
		parts.push('');
		parts.push('1. 【代码风格】仔细分析上下文代码的模式和风格，生成一致的代码');
		parts.push('2. 【变量使用】只使用上下文中已出现或明确定义的变量名、方法名和类名');
		parts.push('3. 【类型约束】如果提供了类型定义信息，必须只使用该类型实际存在的字段和方法');
		parts.push('4. 【禁止猜测】禁止生成任何未在上下文中出现的方法名或字段名');
		parts.push('5. 【输出格式】只输出代码，不要任何解释、注释或markdown标记');
		parts.push('6. 【缩进格式】保持与上下文一致的缩进');
		parts.push('');
		parts.push('⚠️ 违规示例（禁止）：');
		parts.push('  - 生成类型中不存在的 getXxx() 方法');
		parts.push('  - 访问类型中不存在的字段');
		parts.push('  - 调用未导入或未定义的方法');
		parts.push('');
		parts.push('直接输出代码（无解释）：');

		const finalPrompt = parts.join('\n');
		console.log('[AI Inline Completions] 本地提示词内容（前500字符）:', finalPrompt.substring(0, 500));
		return finalPrompt;
	}

	/**
	 * 从后端API获取代码补全提示词
	 */
	private async fetchCompletionPromptFromBackend(context: CompletionContext): Promise<string | null> {
		const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
		console.log('[AI Inline Completions] fetchCompletionPromptFromBackend - apiUrl:', apiUrl);

		if (!apiUrl) {
			console.log('[AI Inline Completions] 未配置apiUrl，跳过后端请求');
			return null;
		}

		try {
			const url = `${apiUrl.replace(/\/$/, '')}/system/ai/prompt/completion`;
			console.log('[AI Inline Completions] 准备请求后端提示词API:', url);

			// 准备请求数据（包含增强的上下文信息）
			const requestData = {
				languageId: context.languageId,
				prefix: context.prefix,
				suffix: context.suffix,
				beforeCode: context.beforeLines.join('\n'),
				afterCode: context.afterLines.join('\n'),
				currentClass: context.currentClass,
				currentMethod: context.currentMethod,
				frameworks: context.frameworks,
				recentEdits: context.recentEdits,
				// 🆕 添加增强的上下文信息
				methodReference: context.methodReference ? {
					className: context.methodReference.className,
					methodPrefix: context.methodReference.methodPrefix,
					candidates: context.methodReference.candidates
				} : undefined,
				typeDefinitions: context.typeDefinitions?.map(td => ({
					typeName: td.typeName,
					methods: td.methods,
					fields: td.fields,
					// 🆕 增强的方法信息
					enhancedMethods: td.enhancedMethods?.map(m => ({
						name: m.name,
						returnType: m.returnType,
						parameters: m.parameters,
						signature: m.signature
					})),
					parentClass: td.parentClass,
					interfaces: td.interfaces
				})),
				variableTypes: context.variableTypes ? Object.fromEntries(context.variableTypes) : undefined,
				cursorContext: context.cursorContext,
				// 🆕 框架特化上下文
				frameworkContext: context.frameworkContext ? {
					name: context.frameworkContext.name,
					version: context.frameworkContext.version,
					contextType: context.frameworkContext.contextType,
					annotations: context.frameworkContext.annotations,
					hints: context.frameworkContext.hints,
					patterns: context.frameworkContext.patterns
				} : undefined,
				// 🆕 跨文件上下文
				relatedFiles: context.relatedFiles?.map(rf => ({
					filepath: rf.filepath,
					fileType: rf.fileType,
					definitions: rf.definitions
				}))
			};

			console.log('[AI Inline Completions] 请求数据:', {
				languageId: requestData.languageId,
				currentClass: requestData.currentClass,
				currentMethod: requestData.currentMethod,
				hasMethodReference: !!requestData.methodReference,
				typeDefinitionsCount: requestData.typeDefinitions?.length || 0,
				hasFrameworkContext: !!requestData.frameworkContext,
				frameworkName: requestData.frameworkContext?.name,
				relatedFilesCount: requestData.relatedFiles?.length || 0
			});

			const response = await this.requestService.request({
				type: 'POST',
				url: url,
				headers: {
					'Content-Type': 'application/json'
				},
				data: JSON.stringify(requestData)
			}, CancellationToken.None);

			const data = await asJson<any>(response);
			console.log('[AI Inline Completions] 后端响应:', { code: data?.code, hasData: !!data?.data });

			if (data && data.code === 200 && data.data) {
				console.log('[AI Inline Completions] 成功从后端获取提示词，长度:', data.data.length);
				return data.data;
			}

			console.warn('[AI Inline Completions] 后端返回数据格式错误或无数据');
			return null;
		} catch (error) {
			console.error('[AI Inline Completions] 从后端获取提示词失败:', error);
			return null;
		}
	}

	freeInlineCompletions(): void {
		// Cleanup if needed
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
		// 使用前缀、后缀和关键上下文信息生成缓存 key
		const keyParts = [
			context.languageId,
			context.prefix.slice(-100), // 最后100个字符
			context.suffix.slice(0, 50), // 前50个字符
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
