/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	IApiHandler,
	ApiStream,
	StreamChunk,
	TextStreamChunk,
	UsageStreamChunk,
	ErrorStreamChunk,
	ToolUseStreamChunk,
	MessageParam,
	ToolDefinition,
	ModelInfo,
	ContentBlock
} from './types.js';

/**
 * AiProxy API 配置
 */
export interface AiProxyConfiguration {
	apiUrl: string;      // 码弦 API 地址
	username: string;    // 用户名（Base64编码）
	password: string;    // 密码（Base64编码）
	provider?: string;   // AI提供商标识，默认 'qwen'
	model?: string;      // 模型名称
}

/**
 * AiProxy Chat 请求参数
 */
interface AiProxyRequest {
	username: string;
	password: string;
	requestId?: string;
	provider: string;
	model?: string;
	messages: AiProxyMessage[];
	maxTokens?: number;
	temperature?: number;
	stream?: boolean;
	tools?: AiProxyTool[];
	toolChoice?: any;
	parallelToolCalls?: boolean;
	apiType?: string;  // chat 或 completion
}

interface AiProxyMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	tool_calls?: AiProxyToolCall[];
	tool_call_id?: string;
	name?: string;
}

interface AiProxyTool {
	type: string;
	function: {
		name: string;
		description: string;
		parameters: Record<string, any>;
		strict?: boolean;
	};
}

interface AiProxyToolCall {
	id: string;
	type: string;
	function: {
		name: string;
		arguments: string;
	};
}

/**
 * AiProxy SSE 事件类型（使用下划线命名，与OpenAI兼容格式一致）
 */
interface AiProxyStreamEvent {
	id?: string;
	object?: string;
	created?: number;
	model?: string;
	choices?: Array<{
		index: number;
		delta?: {
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
		message?: {
			role: string;
			content: string;
			tool_calls?: AiProxyToolCall[];
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
 * AiProxy API Handler
 * 实现 IApiHandler 接口，用于调用统一的 AI 代理服务
 */
export class AiProxyHandler implements IApiHandler {
	private config: AiProxyConfiguration;
	private currentRequestId: string | null = null;
	private modelInfo: ModelInfo;

	constructor(config: AiProxyConfiguration) {
		this.config = config;
		console.log('[Maxian] AiProxyHandler 初始化，API URL:', config.apiUrl);

		// 初始化模型信息
		this.modelInfo = {
			id: config.model || 'qwen-plus',
			name: config.model || 'qwen-plus',
			maxTokens: 8192,
			supportsTools: true,
			supportsVision: false,
			supportsStreaming: true
		};
	}

	/**
	 * 创建消息并返回流式响应
	 * 实现 IApiHandler 接口
	 */
	async *createMessage(
		systemPrompt: string,
		messages: MessageParam[],
		tools?: ToolDefinition[]
	): ApiStream {
		try {
			// 生成请求ID
			this.currentRequestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

			// 转换消息格式
			const aiProxyMessages = this.convertMessages(systemPrompt, messages);

			// 转换工具定义
			const aiProxyTools = tools ? this.convertTools(tools) : undefined;

			// 构建请求参数
			const requestBody: AiProxyRequest = {
				username: this.config.username,
				password: this.config.password,
				requestId: this.currentRequestId,
				provider: this.config.provider || 'qwen',
				model: this.config.model,
				messages: aiProxyMessages,
				stream: true,
				apiType: 'chat',  // 重要：指定为 chat 模式，否则后端默认使用 completions 模式
				...(aiProxyTools && aiProxyTools.length > 0 ? { tools: aiProxyTools, toolChoice: 'auto' } : {})
			};

			// 调试日志：确认工具是否正确发送
			console.log('[Maxian] AiProxy 请求:', {
				provider: requestBody.provider,
				apiType: requestBody.apiType,
				toolsCount: aiProxyTools?.length || 0,
				messagesCount: aiProxyMessages.length,
				hasTools: !!(aiProxyTools && aiProxyTools.length > 0)
			});
			if (aiProxyTools && aiProxyTools.length > 0) {
				console.log('[Maxian] 工具列表:', aiProxyTools.map(t => t.function.name));
			}

			// 构建 API 端点
			const apiEndpoint = this.buildApiEndpoint();

			// 发送请求
			const response = await fetch(apiEndpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'text/event-stream'
				},
				body: JSON.stringify(requestBody)
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error('[Maxian] AiProxy API 错误:', response.status, errorText);
				const errorChunk: ErrorStreamChunk = {
					type: 'error',
					error: `AiProxy API 错误 (${response.status}): ${errorText}`
				};
				yield errorChunk;
				return;
			}

			// 处理流式响应
			yield* this.processStream(response);

		} catch (error) {
			console.error('[Maxian] AiProxyHandler 错误:', error);
			const errorChunk: ErrorStreamChunk = {
				type: 'error',
				error: error instanceof Error ? error.message : String(error)
			};
			yield errorChunk;
		} finally {
			this.currentRequestId = null;
		}
	}

	/**
	 * 转换消息格式为 AiProxy 格式
	 */
	private convertMessages(systemPrompt: string, messages: MessageParam[]): AiProxyMessage[] {
		const result: AiProxyMessage[] = [];

		// 添加系统提示词
		if (systemPrompt) {
			result.push({
				role: 'system',
				content: systemPrompt
			});
		}

		// 转换消息
		for (const msg of messages) {
			if (typeof msg.content === 'string') {
				result.push({
					role: msg.role,
					content: msg.content
				});
			} else {
				// 处理内容块数组
				let textContent = '';
				const toolCalls: AiProxyToolCall[] = [];
				let toolCallId: string | undefined;
				let toolName: string | undefined;

				for (const block of msg.content) {
					if (block.type === 'text') {
						textContent += block.text;
					} else if (block.type === 'tool_use') {
						toolCalls.push({
							id: block.id,
							type: 'function',
							function: {
								name: block.name,
								arguments: JSON.stringify(block.input)
							}
						});
					} else if (block.type === 'tool_result') {
						toolCallId = block.tool_use_id;
						textContent = block.content;
					}
				}

				const aiProxyMsg: AiProxyMessage = {
					role: msg.role,
					content: textContent
				};

				if (toolCalls.length > 0) {
					aiProxyMsg.tool_calls = toolCalls;
				}

				if (toolCallId) {
					aiProxyMsg.tool_call_id = toolCallId;
				}

				if (toolName) {
					aiProxyMsg.name = toolName;
				}

				result.push(aiProxyMsg);
			}
		}

		return result;
	}

	/**
	 * 转换工具定义为 AiProxy 格式
	 */
	private convertTools(tools: ToolDefinition[]): AiProxyTool[] {
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
	 * 构建 API 端点
	 * 使用HTTP透传模式，直接转发到千问的OpenAI兼容端点
	 */
	private buildApiEndpoint(): string {
		let baseUrl = this.config.apiUrl.replace(/\/$/, ''); // 移除末尾斜杠
		return `${baseUrl}/ai/proxy/stream/chat/completions`;
	}

	/**
	 * 处理 SSE 流式响应（与 QwenHandler 保持一致）
	 */
	private async *processStream(response: Response): AsyncGenerator<StreamChunk> {
		const reader = response.body?.getReader();
		if (!reader) {
			console.error('[Maxian] 无法获取 AiProxy 响应流');
			return;
		}

		const decoder = new TextDecoder();
		let buffer = '';

		// 用于累积工具调用的参数（使用index作为key，与QwenHandler一致）
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
					const trimmedLine = line.trim();
					if (!trimmedLine) {
						continue;
					}

					// 兼容两种格式: "data: {...}" 和 "data:{...}"
					let data: string;
					if (trimmedLine.startsWith('data: ')) {
						data = trimmedLine.slice(6); // 移除 "data: " 前缀
					} else if (trimmedLine.startsWith('data:')) {
						data = trimmedLine.slice(5); // 移除 "data:" 前缀
					} else {
						continue;
					}

					// 检查是否结束
					if (data === '[DONE]') {
						continue;
					}

					try {
						const event: AiProxyStreamEvent = JSON.parse(data);

						// 处理文本内容
						const delta = event.choices?.[0]?.delta;
						if (delta?.content) {
							const textChunk: TextStreamChunk = {
								type: 'text',
								text: delta.content
							};
							yield textChunk;
						}

						// 处理工具调用（流式累积，与QwenHandler一致）
						if (delta?.tool_calls) {
							for (const toolCall of delta.tool_calls) {
								// 使用index作为key，因为后续chunks的id可能是空字符串
								const toolKey = `tool_${toolCall.index}`;
								const toolId = toolCall.id || toolKey;
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

						// 在finish_reason为tool_calls时，输出所有累积的工具调用（与QwenHandler一致）
						if (event.choices?.[0]?.finish_reason === 'tool_calls') {
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

						// 处理使用量信息
						if (event.usage) {
							const usageChunk: UsageStreamChunk = {
								type: 'usage',
								inputTokens: event.usage.prompt_tokens,
								outputTokens: event.usage.completion_tokens,
								totalTokens: event.usage.total_tokens
							};
							yield usageChunk;
						}

					} catch (parseError) {
						console.error('[Maxian] 解析 AiProxy 响应失败:', parseError, 'data:', data);
					}
				}
			}

		} finally {
			reader.releaseLock();
		}
	}

	/**
	 * 获取当前模型信息
	 * 实现 IApiHandler 接口
	 */
	getModel(): ModelInfo {
		return this.modelInfo;
	}

	/**
	 * 计算 token 数量
	 * 实现 IApiHandler 接口
	 * 简单估算：每4个字符约1个token
	 */
	async countTokens(content: ContentBlock[]): Promise<number> {
		let totalChars = 0;

		for (const block of content) {
			if (block.type === 'text') {
				totalChars += block.text.length;
			} else if (block.type === 'tool_use') {
				totalChars += JSON.stringify(block.input).length;
			} else if (block.type === 'tool_result') {
				totalChars += block.content.length;
			}
		}

		// 简单估算：每4个字符约1个token
		return Math.ceil(totalChars / 4);
	}

	/**
	 * 中止当前请求
	 * 使用HTTP透传模式端点
	 */
	async stopCurrentRequest(): Promise<boolean> {
		if (!this.currentRequestId) {
			return false;
		}

		try {
			const baseUrl = this.config.apiUrl.replace(/\/$/, '');
			const response = await fetch(`${baseUrl}/ai/proxy/stop/${this.currentRequestId}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (response.ok) {
				console.log('[Maxian] AiProxy 请求已中止:', this.currentRequestId);
				return true;
			}
		} catch (error) {
			console.error('[Maxian] 中止 AiProxy 请求失败:', error);
		}

		return false;
	}

	/**
	 * 获取当前请求ID
	 */
	getCurrentRequestId(): string | null {
		return this.currentRequestId;
	}
}
