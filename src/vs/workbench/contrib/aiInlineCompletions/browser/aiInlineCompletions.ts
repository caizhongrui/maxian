/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Position } from '../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { InlineCompletion, InlineCompletionContext, InlineCompletions, InlineCompletionsProvider } from '../../../../editor/common/languages.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IMultiLanguageService } from '../../multilang/browser/multilang.contribution.js';
import { CompletionContextExtractor } from './completionContextExtractor.js';
import { IRequestService, asJson } from '../../../../platform/request/common/request.js';

export class AIInlineCompletionsProvider implements InlineCompletionsProvider {

	private readonly contextExtractor: CompletionContextExtractor;

	constructor(
		private readonly aiService: IAIService,
		private readonly configurationService: IConfigurationService,
		private readonly requestService: IRequestService,
		multiLanguageService: IMultiLanguageService
	) {
		this.contextExtractor = new CompletionContextExtractor(multiLanguageService);
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
			importsCount: enhancedContext.imports?.length || 0
		});

		// Build enhanced prompt with structural information
		const prompt = await this.buildEnhancedPrompt(enhancedContext);

		try {
			console.log('[AI Inline Completions] Calling AI service...');

			// 使用优化的参数调用 AI
			const aiResponse = await this.aiService.complete(prompt, {
				temperature: 0.1,  // 极低温度，确保输出确定性
				maxTokens: 1200,   // 支持较长的代码补全
				systemMessage: 'You are a code completion engine. Output ONLY code, NO explanations, NO markdown, NO conversational text.',
				businessCode: 'IDE_CODE_COMPLETION'  // 代码补全业务场景
			});

			console.log('[AI Inline Completions] AI response length:', aiResponse.length);

			// Extract and clean the completion
			const completions = this.extractCompletions(aiResponse, prefix);
			console.log('[AI Inline Completions] Extracted completions:', completions);

			if (completions.length === 0) {
				console.warn('[AI Inline Completions] No valid completions extracted');
				return undefined;
			}

			// Convert to InlineCompletion items
			// Provide explicit range for better compatibility
			const items: InlineCompletion[] = completions.map(completion => {
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

			return {
				items
			};
		} catch (error) {
			console.error('[AI Inline Completions] Error:', error);
			return undefined;
		}
	}

	/**
	 * 提取 AI 返回的代码补全（强化过滤）
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

		// 步骤 4: 分割为行并处理
		const allLines = cleanedResponse.split('\n');

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
	 * Build enhanced prompt with structural code information
	 * 强制 AI 返回纯代码，不返回任何解释
	 */
	private async buildEnhancedPrompt(context: any): Promise<string> {
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
		if (context.currentClass || context.currentMethod || context.frameworks) {
			parts.push('【当前上下文】');

			if (context.currentClass) {
				parts.push(`当前类: ${context.currentClass}`);
				if (context.currentMethod) {
					parts.push(`当前方法: ${context.currentMethod}`);
				}
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
		if (isNewLine) {
			parts.push('用户刚按下回车，请预测下一行代码。');
			parts.push('根据上下文逻辑，生成最可能的下一行或下几行代码。');
		} else {
			parts.push('用户正在输入代码，请补全当前行。');
		}
		parts.push('');
		parts.push('输出规则：');
		parts.push('1. 只输出代码，不要任何解释、注释或markdown标记');
		parts.push('2. 保持与上下文一致的缩进风格');
		parts.push('3. 代码要符合' + context.languageId + '语法');
		parts.push('4. 生成1-5行高质量代码');
		parts.push('');
		parts.push('直接输出代码：');

		const finalPrompt = parts.join('\n');
		console.log('[AI Inline Completions] 本地提示词内容（前500字符）:', finalPrompt.substring(0, 500));
		return finalPrompt;
	}

	/**
	 * 从后端API获取代码补全提示词
	 */
	private async fetchCompletionPromptFromBackend(context: any): Promise<string | null> {
		const apiUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
		console.log('[AI Inline Completions] fetchCompletionPromptFromBackend - apiUrl:', apiUrl);

		if (!apiUrl) {
			console.log('[AI Inline Completions] 未配置apiUrl，跳过后端请求');
			return null;
		}

		try {
			const url = `${apiUrl.replace(/\/$/, '')}/system/ai/prompt/completion`;
			console.log('[AI Inline Completions] 准备请求后端提示词API:', url);

			// 准备请求数据
			const requestData = {
				languageId: context.languageId,
				prefix: context.prefix,
				suffix: context.suffix,
				beforeCode: context.beforeLines.join('\n'),
				afterCode: context.afterLines.join('\n'),
				currentClass: context.currentClass,
				currentMethod: context.currentMethod,
				frameworks: context.frameworks,
				recentEdits: context.recentEdits
			};

			console.log('[AI Inline Completions] 请求数据:', {
				languageId: requestData.languageId,
				currentClass: requestData.currentClass,
				currentMethod: requestData.currentMethod
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
}
