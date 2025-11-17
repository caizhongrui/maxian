/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	IApiHandler,
	ApiConfiguration,
	MessageParam,
	ToolDefinition,
	ApiStream,
	ModelInfo,
	ContentBlock,
	StreamChunk,
	TextStreamChunk,
	ToolUseStreamChunk,
	UsageStreamChunk,
	ErrorStreamChunk
} from './types.js';

/**
 * 千问 API 请求消息格式
 */
interface QwenMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content?: string;
	tool_call_id?: string;  // 工具结果消息需要此字段
	tool_calls?: Array<{
		id: string;
		type: 'function';
		function: {
			name: string;
			arguments: string;
		};
	}>;
}

/**
 * 千问 API 工具定义格式
 */
interface QwenTool {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: any;
	};
}

/**
 * 千问 API 请求参数
 */
interface QwenChatRequest {
	model: string;
	messages: QwenMessage[];
	temperature?: number;
	max_tokens?: number;
	stream?: boolean;
	tools?: QwenTool[];
}

/**
 * 千问 API 响应（流式）
 */
interface QwenStreamChunk {
	id: string;
	choices: Array<{
		delta: {
			role?: string;
			content?: string;
			tool_calls?: Array<{
				index: number;
				id: string;
				type: 'function';
				function: {
					name: string;
					arguments: string;
				};
			}>;
		};
		finish_reason?: string | null;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

/**
 * 千问模型信息映射
 */
const QWEN_MODELS: Record<string, ModelInfo> = {
	'qwen-coder-turbo': {
		id: 'qwen-coder-turbo',
		name: 'Qwen Coder Turbo',
		maxTokens: 4096,
		supportsTools: true,
		supportsVision: false,
		supportsStreaming: true
	},
	'qwen3-coder-480b-a35b-instruct': {
		id: 'qwen3-coder-480b-a35b-instruct',
		name: 'Qwen3 Coder 480B',
		maxTokens: 8192,
		supportsTools: true,
		supportsVision: false,
		supportsStreaming: true
	},
	'qwen-max': {
		id: 'qwen-max',
		name: 'Qwen Max',
		maxTokens: 8192,
		supportsTools: true,
		supportsVision: true,
		supportsStreaming: true
	},
	'qwen-plus': {
		id: 'qwen-plus',
		name: 'Qwen Plus',
		maxTokens: 8192,
		supportsTools: true,
		supportsVision: false,
		supportsStreaming: true
	}
};

/**
 * 千问 API Handler
 * 实现与阿里云千问模型的对接
 */
export class QwenHandler implements IApiHandler {
	private config: ApiConfiguration;
	private apiEndpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

	constructor(config: ApiConfiguration) {
		this.config = config;
		console.log('[Maxian] QwenHandler 初始化，模型:', config.model);
	}

	/**
	 * 获取模型信息
	 */
	getModel(): ModelInfo {
		const modelInfo = QWEN_MODELS[this.config.model];
		if (!modelInfo) {
			console.warn('[Maxian] 未知模型:', this.config.model, '使用默认配置');
			return {
				id: this.config.model,
				name: this.config.model,
				maxTokens: 4096,
				supportsTools: true,
				supportsVision: false,
				supportsStreaming: true
			};
		}
		return modelInfo;
	}

	/**
	 * 创建消息并返回流式响应
	 */
	async *createMessage(
		systemPrompt: string,
		messages: MessageParam[],
		tools?: ToolDefinition[]
	): ApiStream {
		try {
			// 转换消息格式
			const qwenMessages = this.convertMessages(systemPrompt, messages);

			// 转换工具定义
			const qwenTools = tools ? this.convertTools(tools) : undefined;

			// 构建请求参数
			const requestBody: QwenChatRequest = {
				model: this.config.model,
				messages: qwenMessages,
				temperature: this.config.temperature ?? 0.15,
				max_tokens: this.config.maxTokens ?? 1000,
				stream: true,
				...(qwenTools && qwenTools.length > 0 ? { tools: qwenTools } : {})
			};

			// 发送请求
			const response = await fetch(this.apiEndpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.config.apiKey}`
				},
				body: JSON.stringify(requestBody)
				// 移除超时限制，允许长时间流式响应
			// signal: AbortSignal.timeout(this.config.timeout ?? 30000)
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error('[Maxian] 千问 API 错误:', response.status, errorText);
				const errorChunk: ErrorStreamChunk = {
					type: 'error',
					error: `千问 API 错误 (${response.status}): ${errorText}`
				};
				yield errorChunk;
				return;
			}

			// 处理流式响应
			yield* this.processStream(response);

		} catch (error) {
			console.error('[Maxian] QwenHandler 错误:', error);
			const errorChunk: ErrorStreamChunk = {
				type: 'error',
				error: error instanceof Error ? error.message : String(error)
			};
			yield errorChunk;
		}
	}

	/**
	 * 处理流式响应
	 */
	private async *processStream(response: Response): AsyncGenerator<StreamChunk> {
		const reader = response.body?.getReader();
		if (!reader) {
			console.error('[Maxian] 无法获取响应流');
			return;
		}

		const decoder = new TextDecoder();
		let buffer = '';

		// 用于累积工具调用的参数（包含id、name和arguments）
		const toolCallsMap = new Map<string, { id: string; name: string; arguments: string }>();

		try {
			while (true) {
				const { done, value } = await reader.read();

				if (done) {
					break;
				}

				// 解码数据
				buffer += decoder.decode(value, { stream: true });

				// 按行分割
				const lines = buffer.split('\n');
				buffer = lines.pop() || ''; // 保留最后一行（可能不完整）

				for (const line of lines) {
					if (!line.trim() || !line.startsWith('data: ')) {
						continue;
					}

					const data = line.slice(6); // 移除 "data: " 前缀

					if (data === '[DONE]') {
						continue;
					}

					try {
						const chunk: QwenStreamChunk = JSON.parse(data);

						// 处理文本内容
						const delta = chunk.choices[0]?.delta;
						if (delta?.content) {
							const textChunk: TextStreamChunk = {
								type: 'text',
								text: delta.content
							};
							yield textChunk;
						}

						// 处理工具调用
						if (delta?.tool_calls) {
							for (const toolCall of delta.tool_calls) {
								// 使用index作为key，因为后续chunks的id可能是空字符串
								const toolKey = `tool_${toolCall.index}`;
								const toolId = toolCall.id || toolKey; // 如果有真实id则使用，否则用临时key
								const toolName = toolCall.function?.name || '';
								const argsFragment = toolCall.function?.arguments || '';

								if (!toolCallsMap.has(toolKey)) {
									toolCallsMap.set(toolKey, {
										id: toolId,
										name: toolName,
										arguments: ''
									});
								}

								const existing = toolCallsMap.get(toolKey)!;
								// 更新id和name（第一个chunk会有这些信息）
								if (toolId && toolId !== toolKey) {
									existing.id = toolId;
								}
								if (toolName) {
									existing.name = toolName;
								}
								existing.arguments += argsFragment;
							}
						}

						// 在finish_reason为tool_calls时，输出所有累积的工具调用
						if (chunk.choices[0]?.finish_reason === 'tool_calls') {
							for (const [_, toolData] of toolCallsMap.entries()) {
								const toolUseChunk: ToolUseStreamChunk = {
									type: 'tool_use',
									id: toolData.id,
									name: toolData.name,
									input: toolData.arguments
								};
								yield toolUseChunk;
							}
							toolCallsMap.clear(); // 清空，准备处理下一轮
						}

						// 处理使用量
						if (chunk.usage) {
							const usageChunk: UsageStreamChunk = {
								type: 'usage',
								inputTokens: chunk.usage.prompt_tokens,
								outputTokens: chunk.usage.completion_tokens,
								totalTokens: chunk.usage.total_tokens
							};
							yield usageChunk;
						}

					} catch (parseError) {
						console.error('[Maxian] 解析响应块失败:', parseError, 'data:', data);
					}
				}
			}

		} finally {
			reader.releaseLock();
		}
	}

	/**
	 * 转换消息格式：Maxian -> Qwen
	 */
	private convertMessages(systemPrompt: string, messages: MessageParam[]): QwenMessage[] {
		const qwenMessages: QwenMessage[] = [];

		// 添加系统提示词
		if (systemPrompt) {
			qwenMessages.push({
				role: 'system',
				content: systemPrompt
			});
		}

		// 转换消息
		for (const message of messages) {
			if (message.role === 'tool') {
				// 工具结果消息 - 必须保持tool角色并包含tool_call_id
				// OpenAI兼容API要求每个tool_call都有对应的tool消息响应
				if (typeof message.content === 'string') {
					// 简单字符串内容（旧格式），转为user消息
					qwenMessages.push({
						role: 'user',
						content: message.content
					});
				} else {
					// ContentBlock[] - 提取tool_result块
					const toolResults = message.content.filter(block => block.type === 'tool_result');

					if (toolResults.length > 0) {
						// 为每个工具结果创建单独的tool消息
						for (const block of toolResults) {
							const toolResult = block as any;
							qwenMessages.push({
								role: 'tool',
								tool_call_id: toolResult.tool_use_id,
								content: toolResult.content
							});
						}
					} else {
						// 没有tool_result块，提取文本内容
						const content = message.content.map(block => {
							if (block.type === 'text') {
								return block.text;
							}
							return '';
						}).filter(s => s).join('\n');

						if (content) {
							qwenMessages.push({
								role: 'user',
								content
							});
						}
					}
				}
			} else {
				// 处理 user 和 assistant 消息
				if (typeof message.content === 'string') {
					// 简单字符串内容
					qwenMessages.push({
						role: message.role as 'user' | 'assistant',
						content: message.content
					});
				} else {
					// ContentBlock[] - 需要分别提取文本和工具调用
					const textBlocks = message.content.filter(block => block.type === 'text');
					const toolUseBlocks = message.content.filter(block => block.type === 'tool_use');

					// 提取文本内容
					const textContent = textBlocks
						.map(block => (block as any).text)
						.join('\n');

					// 提取工具调用
					const toolCalls = toolUseBlocks.map(block => {
						const toolUse = block as any;
						return {
							id: toolUse.id,
							type: 'function' as const,
							function: {
								name: toolUse.name,
								arguments: JSON.stringify(toolUse.input)
							}
						};
					});

					// 构建消息
					const qwenMessage: QwenMessage = {
						role: message.role as 'user' | 'assistant'
					};

					// 添加文本内容（如果有）
					if (textContent) {
						qwenMessage.content = textContent;
					}

					// 添加工具调用（如果有）
					if (toolCalls.length > 0) {
						qwenMessage.tool_calls = toolCalls;
					}

					qwenMessages.push(qwenMessage);
				}
			}
		}

		return qwenMessages;
	}

	/**
	 * 转换工具定义：Maxian -> Qwen
	 */
	private convertTools(tools: ToolDefinition[]): QwenTool[] {
		return tools.map(tool => ({
			type: 'function',
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters
			}
		}));
	}

	/**
	 * 计算 token 数量（简单估算）
	 */
	async countTokens(content: ContentBlock[]): Promise<number> {
		// 简单估算：每个字符约 0.5 个 token（中文）或 0.25 个 token（英文）
		let totalChars = 0;

		for (const block of content) {
			if (block.type === 'text') {
				totalChars += block.text.length;
			} else if (block.type === 'tool_result') {
				totalChars += block.content.length;
			}
		}

		// 中英文混合，使用平均值
		return Math.ceil(totalChars * 0.4);
	}
}
