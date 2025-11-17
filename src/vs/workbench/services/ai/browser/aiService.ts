/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IAIService, AIGenerationRequest, AIGeneratedCode, AICodeModification, AIStreamCallback } from '../../../../platform/ai/common/ai.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IRequestService, asJson } from '../../../../platform/request/common/request.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

export class AIService implements IAIService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@IRequestService private readonly requestService: IRequestService
	) {
		this.logService.info('[AI Service] Initialized');
	}

	async complete(prompt: string, options?: { temperature?: number; maxTokens?: number; systemMessage?: string }): Promise<string> {
		const apiKey = this.configurationService.getValue<string>('zhikai.ai.apiKey') || 'sk-aa9ecd1fe4c04d90abe9e3a59b92dc62';
		const model = this.configurationService.getValue<string>('zhikai.ai.model') || 'qwen-coder-turbo';
		const endpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

		// 优化的默认参数
		// temperature: 0.1-0.2 适合代码补全（更确定性，减少随机性）
		// temperature: 0.3-0.5 适合注释生成
		// temperature: 0.5-0.7 适合创意代码生成
		const temperature = options?.temperature ?? 0.15;  // 降低到 0.15，更精确的代码补全
		const maxTokens = options?.maxTokens ?? 1000;  // 增加到 1000，支持更长补全
		const systemMessage = options?.systemMessage;

		this.logService.info('[AI Service] Calling Qwen API, prompt length:', prompt.length);

		try {
			const messages: any[] = [];

			// 如果有系统消息，先添加（参考Java的system message）
			if (systemMessage) {
				messages.push({ role: 'system', content: systemMessage });
			}

			messages.push({ role: 'user', content: prompt });

			const response = await this.requestService.request({
				type: 'POST',
				url: endpoint,
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`
				},
				data: JSON.stringify({
					model,
					messages: messages,
					temperature: temperature,
					max_tokens: maxTokens
				})
			}, CancellationToken.None);

			const data = await asJson<any>(response);

			if (data && data.choices && data.choices[0]) {
				const result = data.choices[0].message.content;
				this.logService.info('[AI Service] API call successful, response length:', result.length);
				return result;
			}

			return 'Error: Invalid API response';
		} catch (error) {
			this.logService.error('[AI Service] API call failed:', error);
			return `Error: ${error}`;
		}
	}

	/**
	 * 非流式完成（支持 Function Calling）- 千问在流式模式下不返回 tool_calls
	 */
	async completeWithTools(
		messages: Array<{ role: string; content: string; tool_calls?: any[] }>,
		tools: any[],
		abortSignal?: AbortSignal
	): Promise<{ content: string; tool_calls?: any[] }> {
		const apiKey = this.configurationService.getValue<string>('zhikai.ai.apiKey') || 'sk-aa9ecd1fe4c04d90abe9e3a59b92dc62';
		const model = this.configurationService.getValue<string>('zhikai.ai.model') || 'qwen-coder-turbo';
		const endpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

		this.logService.info('[AI Service] Calling Qwen with Function Calling (non-streaming)');
		this.logService.info(`[AI Service] Tools: ${tools.map(t => t.function?.name).join(', ')}`);

		try {
			const requestBody: any = {
				model: model,
				messages: messages,
				temperature: 0.7,
				stream: false // 非流式模式
			};

			// Add tools
			if (tools && tools.length > 0) {
				requestBody.tools = tools;
				requestBody.tool_choice = 'auto';
			}

			console.log('[AI Service] Non-streaming request:', JSON.stringify({
				model: requestBody.model,
				messages: requestBody.messages.map((m: any) => ({ role: m.role, content: m.content?.substring(0, 50) })),
				tools: requestBody.tools?.length,
				tool_choice: requestBody.tool_choice
			}, null, 2));

			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`
				},
				body: JSON.stringify(requestBody),
				signal: abortSignal
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const data = await response.json();
			console.log('[AI Service] Response:', JSON.stringify(data, null, 2));

			const choice = data.choices?.[0];
			const message = choice?.message;

			if (!message) {
				throw new Error('Invalid API response: no message');
			}

			this.logService.info(`[AI Service] Response content length: ${message.content?.length || 0}`);
			this.logService.info(`[AI Service] Tool calls count: ${message.tool_calls?.length || 0}`);

			if (message.tool_calls && message.tool_calls.length > 0) {
				console.log('[AI Service] Tool calls:', JSON.stringify(message.tool_calls, null, 2));
			}

			return {
				content: message.content || '',
				tool_calls: message.tool_calls
			};

		} catch (error: any) {
			if (error.name === 'AbortError') {
				this.logService.info('[AI Service] Request aborted by user');
				throw error;
			}

			this.logService.error('[AI Service] API call failed:', error);
			throw error;
		}
	}

	/**
	 * 流式完成（支持 Function Calling） - 使用阿里千问SSE流式接口
	 */
	async completeStreamWithTools(
		messages: Array<{ role: string; content: string }>,
		tools: any[],
		onChunk: AIStreamCallback,
		onToolCall?: (toolCalls: any[]) => void,
		abortSignal?: AbortSignal
	): Promise<void> {
		const apiKey = this.configurationService.getValue<string>('zhikai.ai.apiKey') || 'sk-aa9ecd1fe4c04d90abe9e3a59b92dc62';
		const model = this.configurationService.getValue<string>('zhikai.ai.model') || 'qwen-coder-turbo';
		const endpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

		this.logService.info('[AI Service] Starting SSE streaming with Function Calling support');
		this.logService.info(`[AI Service] Tools count: ${tools?.length || 0}`);
		if (tools && tools.length > 0) {
			this.logService.info(`[AI Service] Tool names: ${tools.map(t => t.function?.name).join(', ')}`);
		}

		try {
			const requestBody: any = {
				model: model,
				messages: messages,
				temperature: 0.7,
				stream: true,
				stream_options: { include_usage: false }
			};

			// Add tools if provided
			if (tools && tools.length > 0) {
				requestBody.tools = tools;
				requestBody.tool_choice = 'auto'; // Let AI decide when to use tools
				this.logService.info('[AI Service] Function Calling enabled with tool_choice: auto');
			}

			// Log request body (for debugging)
			console.log('[AI Service] Request body:', JSON.stringify({
				model: requestBody.model,
				messages: requestBody.messages.map((m: any) => ({ role: m.role, content_length: m.content?.length || 0 })),
				tools: requestBody.tools?.length || 0,
				tool_choice: requestBody.tool_choice
			}, null, 2));

			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`
				},
				body: JSON.stringify(requestBody),
				signal: abortSignal
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error('No response body reader available');
			}

			const decoder = new TextDecoder('utf-8');
			let buffer = '';
			let fullContent = '';
			let toolCalls: any[] = [];

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (!line.trim() || line.startsWith(':')) {
						continue;
					}

					if (line.startsWith('data: ')) {
						const data = line.substring(6).trim();

						if (data === '[DONE]') {
							// Send tool calls if any
							if (toolCalls.length > 0 && onToolCall) {
								console.log('[AI Service] Sending tool calls to handler:', toolCalls.length);
								onToolCall(toolCalls);
							} else {
								console.log('[AI Service] No tool calls detected in this response');
							}

							onChunk({
								content: fullContent,
								isComplete: true
							});
							this.logService.info('[AI Service] SSE streaming completed');
							return;
						}

						try {
							const json = JSON.parse(data);
							const delta = json.choices?.[0]?.delta;

							// Debug: Log delta structure
							if (delta && Object.keys(delta).length > 0) {
								console.log('[AI Service] Delta keys:', Object.keys(delta));
								if (delta.content) {
									console.log('[AI Service] Delta has content:', delta.content.substring(0, 50));
								}
								if (delta.tool_calls) {
									console.log('[AI Service] Delta has tool_calls:', JSON.stringify(delta.tool_calls));
								}
							}

							// Handle text content
							if (delta?.content) {
								fullContent += delta.content;
								onChunk({
									content: fullContent,
									isComplete: false
								});
							}

							// Handle tool calls
							if (delta?.tool_calls) {
								console.log('[AI Service] Tool calls detected:', delta.tool_calls);

								for (const toolCallDelta of delta.tool_calls) {
									const index = toolCallDelta.index;

									if (!toolCalls[index]) {
										toolCalls[index] = {
											id: toolCallDelta.id || `call_${index}`,
											type: 'function',
											function: {
												name: toolCallDelta.function?.name || '',
												arguments: toolCallDelta.function?.arguments || ''
											}
										};
										console.log(`[AI Service] New tool call [${index}]:`, toolCalls[index].function.name);
									} else {
										// Append to existing tool call
										if (toolCallDelta.function?.arguments) {
											toolCalls[index].function.arguments += toolCallDelta.function.arguments;
										}
									}
								}
							}

						} catch (e) {
							this.logService.warn('[AI Service] Failed to parse SSE chunk:', e);
						}
					}
				}
			}

			// Send tool calls if any
			if (toolCalls.length > 0 && onToolCall) {
				onToolCall(toolCalls);
			}

			onChunk({
				content: fullContent,
				isComplete: true
			});
			this.logService.info('[AI Service] SSE streaming finished');

		} catch (error: any) {
			if (error.name === 'AbortError') {
				this.logService.info('[AI Service] SSE streaming aborted by user');
				return;
			}

			this.logService.error('[AI Service] SSE streaming failed:', error);
			onChunk({
				content: `抱歉，流式响应失败: ${error}`,
				isComplete: true
			});
		}
	}

	/**
	 * 流式完成 - 使用阿里千问SSE流式接口
	 */
	async completeStream(prompt: string, onChunk: AIStreamCallback, abortSignal?: AbortSignal): Promise<void> {
		const apiKey = this.configurationService.getValue<string>('zhikai.ai.apiKey') || 'sk-aa9ecd1fe4c04d90abe9e3a59b92dc62';
		const model = this.configurationService.getValue<string>('zhikai.ai.model') || 'qwen-coder-turbo';
		const endpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

		this.logService.info('[AI Service] Starting real SSE streaming completion');

		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${apiKey}`
				},
				body: JSON.stringify({
					model: model,
					messages: [{ role: 'user', content: prompt }],
					temperature: 0.7,
					stream: true, // 启用流式响应
					stream_options: { include_usage: false }
				}),
				signal: abortSignal // 支持取消请求
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const reader = response.body?.getReader();
			if (!reader) {
				throw new Error('No response body reader available');
			}

			const decoder = new TextDecoder('utf-8');
			let buffer = '';
			let fullContent = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				// 解码数据块
				buffer += decoder.decode(value, { stream: true });

				// 处理所有完整的SSE消息
				const lines = buffer.split('\n');
				buffer = lines.pop() || ''; // 保留不完整的行

				for (const line of lines) {
					if (!line.trim() || line.startsWith(':')) {
						continue; // 跳过空行和注释
					}

					if (line.startsWith('data: ')) {
						const data = line.substring(6).trim();

						// 检查是否是结束标记
						if (data === '[DONE]') {
							onChunk({
								content: fullContent,
								isComplete: true
							});
							this.logService.info('[AI Service] SSE streaming completed');
							return;
						}

						try {
							const json = JSON.parse(data);
							const delta = json.choices?.[0]?.delta?.content;

							if (delta) {
								fullContent += delta;
								onChunk({
									content: fullContent,
									isComplete: false
								});
							}
						} catch (e) {
							this.logService.warn('[AI Service] Failed to parse SSE chunk:', e);
						}
					}
				}
			}

			// 如果正常结束但没收到[DONE]
			onChunk({
				content: fullContent,
				isComplete: true
			});
			this.logService.info('[AI Service] SSE streaming finished');

		} catch (error: any) {
			// 如果是用户主动取消，不显示错误
			if (error.name === 'AbortError') {
				this.logService.info('[AI Service] SSE streaming aborted by user');
				return;
			}

			this.logService.error('[AI Service] SSE streaming failed:', error);
			onChunk({
				content: `抱歉，流式响应失败: ${error}`,
				isComplete: true
			});
		}
	}

	async generate(request: AIGenerationRequest, token?: any): Promise<AIGeneratedCode> {
		this.logService.info('[AI Service] Generating code, type:', request.type);

		// 构建不同类型的 prompt
		let prompt = '';
		let options: { temperature?: number; maxTokens?: number; systemMessage?: string } = {};

		switch (request.type) {
			case 'test':
				prompt = this.buildTestPrompt(request);
				break;
			case 'comment':
				prompt = this.buildCommentPrompt(request);
				// 注释生成使用特殊参数（参考Java实现）
				options = {
					temperature: 0.3,
					maxTokens: 800,
					systemMessage: 'You are an expert at writing clear, concise code documentation comments.'
				};
				break;
			case 'business':
				prompt = this.buildBusinessCodePrompt(request);
				break;
		}

		const result = await this.complete(prompt, options);

		// 对于注释类型，使用专门的提取方法
		const extractedCode = request.type === 'comment'
			? this.extractComment(result, request.language || 'java')
			: this.extractCode(result);

		return {
			code: extractedCode,
			description: ''
		};
	}

	async modify(code: string, instruction: string, token?: any): Promise<AICodeModification> {
		this.logService.info('[AI Service] Modifying code, instruction:', instruction);

		const prompt = `你是一个专业的代码重构专家。请根据以下指令修改代码。

修改指令：${instruction}

原始代码：
\`\`\`
${code}
\`\`\`

要求：
1. 严格按照指令修改代码
2. 保持代码的原有功能和逻辑（除非指令要求改变）
3. 保持代码风格的一致性
4. 确保修改后的代码语法正确
5. 【重要】只返回修改后的完整代码，不要返回任何解释
6. 【重要】不要包含markdown代码块标记
7. 【重要】保持原有的缩进和格式风格

请直接返回修改后的代码：`;

		const result = await this.complete(prompt);

		return {
			modifiedCode: this.extractCode(result),
			summary: instruction
		};
	}

	private buildTestPrompt(request: AIGenerationRequest): string {
		const framework = request.context?.framework || 'junit5';
		const methodName = request.context?.methodName || '目标方法';

		return `你是一个专业的单元测试编写专家。请为以下${request.language}代码生成${framework}单元测试。

源代码：
\`\`\`${request.language}
${request.sourceCode}
\`\`\`

要求：
1. 为方法"${methodName}"生成完整的测试方法
2. 包含以下测试场景：
   - 正常情况测试
   - 边界条件测试
   - 异常情况测试
3. 使用${framework}的标准断言方法
4. 测试方法命名要清晰，反映测试意图
5. 【重要】只返回测试方法的代码，不要返回类声明、导入语句
6. 【重要】不要包含任何解释性文字或markdown标记
7. 代码要规范、易读

请直接返回测试方法代码：`;
	}

	private buildCommentPrompt(request: AIGenerationRequest): string {
		const elementType = request.context?.elementType || 'method';

		let style = 'JavaDoc';
		if (request.language === 'typescript' || request.language === 'javascript') {
			style = 'JSDoc';
		} else if (request.language === 'python') {
			style = 'DocString';
		}

		// 使用结构化prompt模板
		if (elementType === 'class') {
			return this.buildClassCommentPrompt(request, style);
		} else {
			return this.buildMethodCommentPrompt(request, style);
		}
	}

	/**
	 * 构建方法注释prompt（使用结构化模板）
	 */
	private buildMethodCommentPrompt(request: AIGenerationRequest, style: string): string {
		return `- Role: 代码注释专家
- Profile: 你是一位经验丰富的软件开发工程师，精通${request.language}语言及其注释规范。你擅长通过简洁明了的语言描述代码的功能和逻辑。
- Goals: 为以下${request.language}方法生成高质量的${style}注释，包含方法功能描述、参数说明、返回值说明、异常说明。
- Constrains: 注释应简洁准确，遵循${style}规范。只返回注释内容 (/**  ... */),不要返回方法代码。

代码：
\`\`\`${request.language}
${request.sourceCode}
\`\`\`

要求：
1. 使用标准${style}格式
2. 包含方法功能描述（用中文描述）
3. 为每个参数添加@param标签，说明参数类型和用途（描述用中文）
4. 如有返回值添加@return标签，说明返回值类型和含义（描述用中文）
5. 如有异常添加@throws标签，说明可能抛出的异常（描述用中文）
6. 【重要】除了@param、@return、@throws等关键字外，所有描述使用中文
7. 描述要简洁准确
8. 只返回注释内容 (/**  ... */),不要返回方法代码
`;
	}

	/**
	 * 构建类注释prompt（使用结构化模板）
	 */
	private buildClassCommentPrompt(request: AIGenerationRequest, style: string): string {
		return `- Role: 代码注释专家
- Profile: 你是一位经验丰富的软件开发工程师，精通${request.language}语言及其注释规范。你擅长分析类的结构和职责，通过清晰的注释帮助其他开发者理解代码设计意图。
- Goals: 为以下${request.language}类生成高质量的${style}注释，描述类的功能、职责、设计意图。
- Constrains: 注释应简洁准确，遵循${style}规范。只返回注释块 (/** ... */),不要返回类的代码。

代码：
\`\`\`${request.language}
${request.sourceCode}
\`\`\`

要求：
1. 使用标准${style}格式
2. 描述类的功能和职责（用中文描述）
3. 说明类的主要成员和核心方法（用中文描述）
4. 添加@author标签
5. 添加@since标签
6. 【重要】除了@author、@since等关键字外，所有描述使用中文
7. 描述要简洁准确
8. 【重要】只返回${style}注释 (/** ... */),不要返回任何代码
9. 【重要】不要重复类的代码,只返回注释块
`;
	}

	private buildBusinessCodePrompt(request: AIGenerationRequest): string {
		const contextInfo = request.context || {};
		const generationType = contextInfo.generationType || 'code_snippet';

		// 根据生成类型构建不同的prompt
		if (generationType === 'full_class') {
			return this.buildFullClassPrompt(request, contextInfo);
		} else if (generationType === 'full_method') {
			return this.buildFullMethodPrompt(request, contextInfo);
		} else {
			return this.buildCodeSnippetPrompt(request, contextInfo);
		}
	}

	/**
	 * 构建完整类的prompt
	 */
	private buildFullClassPrompt(request: AIGenerationRequest, contextInfo: any): string {
		let contextSection = `\n当前上下文：`;
		contextSection += `\n- 编程语言：${request.language}`;
		contextSection += `\n- 位置：文件级别（将生成完整的类）`;

		if (contextInfo.imports && contextInfo.imports.length > 0) {
			contextSection += `\n- 已有导入语句：\n${contextInfo.imports.slice(0, 10).join('\n')}`;
		}

		return `你是一个专业的代码生成专家。请根据以下需求生成完整的${request.language}类。

需求描述：${request.requirement}
${contextSection}

要求：
1. 生成完整的类定义，包括：
   - 类声明（类名要清晰反映功能）
   - 必要的字段
   - 构造方法/构造函数
   - 所有需要的方法
2. 包含适当的访问修饰符（public/private/protected）
3. 使用恰当的设计模式和最佳实践
4. 包含必要的错误处理和边界检查
5. 【重要】生成完整的类代码，包括类声明和所有成员
6. 【重要】可以包含必要的导入语句
7. 【重要】不要包含任何解释性文字或markdown标记
8. 代码要规范、易读、易维护

请直接返回完整的类代码：`;
	}

	/**
	 * 构建完整方法的prompt
	 */
	private buildFullMethodPrompt(request: AIGenerationRequest, contextInfo: any): string {
		let contextSection = `\n当前上下文：`;
		contextSection += `\n- 编程语言：${request.language}`;
		contextSection += `\n- 位置：类级别（将生成完整的方法）`;

		if (contextInfo.currentClass) {
			contextSection += `\n- 当前类：\n\`\`\`${request.language}\n${contextInfo.currentClass}\n\`\`\``;
		}

		if (contextInfo.imports && contextInfo.imports.length > 0) {
			contextSection += `\n- 已导入的包/模块：\n${contextInfo.imports.slice(0, 10).join('\n')}`;
		}

		return `你是一个专业的代码生成专家。请根据以下需求生成完整的${request.language}方法。

需求描述：${request.requirement}
${contextSection}

要求：
1. 生成完整的方法，包括：
   - 方法签名（访问修饰符、返回类型、方法名、参数）
   - 完整的方法体实现
2. 代码风格要与当前类中的代码保持一致
3. 使用恰当的算法和数据结构
4. 包含必要的错误处理和边界检查
5. 使用有意义的变量名
6. 【重要】生成完整的方法代码（包括方法签名和实现）
7. 【重要】不要生成类声明，只生成方法
8. 【重要】不要包含导入语句
9. 【重要】不要包含任何解释性文字或markdown标记
10. 代码要规范、易读、易维护

请直接返回完整的方法代码：`;
	}

	/**
	 * 构建代码片段的prompt
	 */
	private buildCodeSnippetPrompt(request: AIGenerationRequest, contextInfo: any): string {
		let contextSection = `\n当前上下文：`;
		contextSection += `\n- 编程语言：${request.language}`;
		contextSection += `\n- 位置：方法内部（将生成代码片段）`;

		if (contextInfo.currentMethod) {
			contextSection += `\n- 当前方法：\n\`\`\`${request.language}\n${contextInfo.currentMethod}\n\`\`\``;
		}

		if (contextInfo.surroundingCode) {
			contextSection += `\n- 周围代码：\n\`\`\`${request.language}\n${contextInfo.surroundingCode}\n\`\`\``;
		}

		return `你是一个专业的代码生成专家。请根据以下需求生成${request.language}代码片段。

需求描述：${request.requirement}
${contextSection}

要求：
1. 生成实现功能的代码片段（几行到十几行代码）
2. 代码风格要与周围代码保持一致
3. 可以使用当前方法中已定义的变量
4. 包含必要的错误处理
5. 使用有意义的变量名
6. 【重要】只生成代码片段，不要生成方法签名或类声明
7. 【重要】不要包含导入语句
8. 【重要】不要包含任何解释性文字或markdown标记
9. 【重要】保持与周围代码相同的缩进风格
10. 代码要简洁、高效

请直接返回代码片段：`;
	}

	private extractCode(response: string): string {
		// 去除 markdown 代码块标记
		let code = response.trim();

		// 匹配 ```language\n代码\n```
		const codeBlockMatch = code.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
		if (codeBlockMatch) {
			code = codeBlockMatch[1].trim();
		}

		// 去除其他 markdown 标记
		code = code.replace(/```/g, '').trim();

		return code;
	}

	/**
	 * 提取注释内容
	 * 参考Java的extractCodeBlock实现
	 */
	private extractComment(response: string, language: string): string {
		let comment = response.trim();

		// 1. 先清理markdown代码块标记（参考Java实现）
		if (comment.startsWith('```')) {
			const firstNewline = comment.indexOf('\n');
			if (firstNewline > 0) {
				comment = comment.substring(firstNewline + 1);
			}
		}
		if (comment.endsWith('```')) {
			comment = comment.substring(0, comment.length - 3);
		}
		comment = comment.trim();

		// 2. 如果已经是完整的注释格式，直接返回
		if (language === 'python') {
			if (comment.startsWith('"""') && comment.endsWith('"""')) {
				return comment;
			}
		} else {
			if (comment.startsWith('/**') && comment.endsWith('*/')) {
				return comment;
			}
		}

		// 3. 尝试从文本中提取注释块
		if (language === 'python') {
			const docstringMatch = comment.match(/"""([\s\S]*?)"""/);
			if (docstringMatch) {
				return `"""${docstringMatch[1].trim()}\n"""`;
			}
			// 没有找到，包装一下
			return `"""\n${comment}\n"""`;
		} else {
			const javaDocMatch = comment.match(/\/\*\*([\s\S]*?)\*\//);
			if (javaDocMatch) {
				return `/**${javaDocMatch[1]}*/`;
			}
			// 没有找到完整格式，尝试修复
			if (comment.startsWith('/*') && !comment.startsWith('/**')) {
				comment = '/**' + comment.substring(2);
			}
			if (!comment.startsWith('/**')) {
				comment = '/**\n' + comment;
			}
			if (!comment.endsWith('*/')) {
				comment = comment + '\n*/';
			}
			return comment;
		}
	}
}

registerSingleton(IAIService, AIService, InstantiationType.Delayed);
