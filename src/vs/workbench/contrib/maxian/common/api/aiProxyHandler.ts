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
	businessCode?: string;  // 业务场景代码（推荐使用，后端会根据此代码自动选择模型）
	provider?: string;   // AI提供商标识（可选，不使用businessCode时才需要）
	model?: string;      // 模型名称（可选，不使用businessCode时才需要）
}

/**
 * AiProxy Chat 请求参数
 */
interface AiProxyRequest {
	username: string;
	password: string;
	requestId?: string;
	businessCode?: string;  // 业务场景代码（推荐使用）
	provider?: string;       // AI提供商（可选）
	model?: string;          // 模型名称（可选）
	messages: AiProxyMessage[];
	maxTokens?: number;
	temperature?: number;
	top_p?: number;
	stream?: boolean;
	tools?: AiProxyTool[];
	toolChoice?: any;
	parallelToolCalls?: boolean;  // 驼峰格式（部分后端）
	parallel_tool_calls?: boolean;  // 下划线格式（阿里云千问API）
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
 *
 * 性能优化：
 * - P0: 超时和重试机制
 * - P1: Rate Limit 自适应（借鉴 Continue）
 * - P1: Prompt Cache 支持（借鉴 Cline/Aider）
 * - P1: 系统提示词本地缓存
 */
export class AiProxyHandler implements IApiHandler {
	private config: AiProxyConfiguration;
	private currentRequestId: string | null = null;
	private modelInfo: ModelInfo;
	private currentAbortController: AbortController | null = null;
	private userAborted = false;

	// 🚀 超时和重试配置
	private readonly REQUEST_TIMEOUT = 120000; // 120秒超时（流式响应需要较长时间）
	private readonly MAX_RETRIES = 2; // 最大重试次数
	private readonly RETRY_DELAY = 1000; // 重试延迟（毫秒）
	private readonly RETRY_BACKOFF = 2; // 重试退避倍数
	private readonly JITTER_FACTOR = 0.3; // 抖动因子（借鉴Continue）

	// P1优化：Rate Limit 统计
	private rateLimitHits = 0;
	private lastRateLimitTime = 0;

	// P1优化：Prompt Cache 支持（借鉴 Cline/Aider）
	private lastSystemPromptHash: string | null = null;
	private systemPromptCacheHits = 0;
	private systemPromptCacheMisses = 0;
	private readonly PROMPT_CACHE_CONFIG = {
		/** 是否启用 Prompt Cache（取决于后端支持） */
		enabled: true,
		/** 最大缓存消息数（借鉴 Continue） */
		maxCachingMessages: 4,
		/** 缓存的最小 token 阈值（大于此值才值得缓存） */
		minTokensForCaching: 500,
		/** 缓存预热间隔（5分钟，借鉴 Aider） */
		cacheWarmupInterval: 5 * 60 * 1000,
	};

	constructor(config: AiProxyConfiguration) {
		this.config = config;
		console.log('[Maxian] AiProxyHandler 初始化，API URL:', config.apiUrl);

		// 初始化模型信息
		this.modelInfo = {
			id: config.businessCode || config.model || 'qwen-plus',
			name: config.businessCode || config.model || 'qwen-plus',
			maxTokens: 8192,
			supportsTools: true,
			supportsVision: false,
			supportsStreaming: true
		};
	}

	/**
	 * 🚀 带超时的fetch请求
	 */
	private async fetchWithTimeout(
		url: string,
		options: RequestInit,
		timeout: number
	): Promise<Response> {
		const controller = new AbortController();
		this.currentAbortController = controller;

		const timeoutId = setTimeout(() => {
			controller.abort();
			console.warn(`[Maxian] API请求超时 (${timeout}ms)`);
		}, timeout);

		try {
			const response = await fetch(url, {
				...options,
				signal: controller.signal
			});
			return response;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	/**
	 * 🚀 判断错误是否可重试
	 */
	private isRetryableError(error: any): boolean {
		// 用户主动取消 → 不重试
		if (this.userAborted) {
			return false;
		}
		// 网络错误可重试
		if (error.name === 'TypeError' && error.message.includes('fetch')) {
			return true;
		}
		// 超时导致的AbortError可重试，用户取消不重试
		if (error.name === 'AbortError') {
			return true;
		}
		// 特定HTTP状态码可重试（429 Too Many Requests, 500 Internal Server Error, 502, 503, 504）
		if (error.status && [429, 500, 502, 503, 504].includes(error.status)) {
			return true;
		}
		return false;
	}

	/**
	 * 🚀 计算重试延迟（指数退避 + 抖动）
	 * P1优化：借鉴Continue的抖动策略，避免雷群效应
	 */
	private getRetryDelay(attempt: number, rateLimitDelay?: number): number {
		// 如果有Rate Limit指定的延迟，优先使用
		if (rateLimitDelay && rateLimitDelay > 0) {
			return rateLimitDelay;
		}

		// 基础延迟 + 指数退避
		const baseDelay = this.RETRY_DELAY * Math.pow(this.RETRY_BACKOFF, attempt);

		// 添加抖动（±30%）
		const jitter = baseDelay * this.JITTER_FACTOR * (Math.random() * 2 - 1);
		const delay = Math.round(baseDelay + jitter);

		// 限制最大延迟为30秒
		return Math.min(delay, 30000);
	}

	/**
	 * P1优化：从响应头解析Rate Limit延迟
	 * 借鉴Continue的实现：支持Retry-After和X-RateLimit-Reset头
	 */
	private parseRateLimitDelay(response: Response): number | undefined {
		// 检查 Retry-After 头
		const retryAfter = response.headers.get('Retry-After');
		if (retryAfter) {
			// Retry-After 可以是秒数或HTTP日期
			const seconds = parseInt(retryAfter, 10);
			if (!isNaN(seconds)) {
				console.log(`[Maxian] 检测到 Retry-After: ${seconds}s`);
				this.rateLimitHits++;
				this.lastRateLimitTime = Date.now();
				return seconds * 1000;
			}

			// 尝试解析为日期
			const date = new Date(retryAfter);
			if (!isNaN(date.getTime())) {
				const delayMs = date.getTime() - Date.now();
				if (delayMs > 0) {
					console.log(`[Maxian] 检测到 Retry-After (日期): ${delayMs}ms`);
					this.rateLimitHits++;
					this.lastRateLimitTime = Date.now();
					return delayMs;
				}
			}
		}

		// 检查 X-RateLimit-Reset 头（一些API使用这个）
		const rateLimitReset = response.headers.get('X-RateLimit-Reset') ||
							   response.headers.get('X-RateLimit-Reset-Requests');
		if (rateLimitReset) {
			const resetTime = parseInt(rateLimitReset, 10);
			if (!isNaN(resetTime)) {
				// 可能是Unix时间戳或秒数
				let delayMs: number;
				if (resetTime > 1000000000) {
					// Unix时间戳
					delayMs = resetTime * 1000 - Date.now();
				} else {
					// 秒数
					delayMs = resetTime * 1000;
				}
				if (delayMs > 0) {
					console.log(`[Maxian] 检测到 X-RateLimit-Reset: ${delayMs}ms`);
					this.rateLimitHits++;
					this.lastRateLimitTime = Date.now();
					return delayMs;
				}
			}
		}

		return undefined;
	}

	/**
	 * P1优化：获取Rate Limit统计
	 */
	public getRateLimitStats(): { hits: number; lastHitTime: number } {
		return {
			hits: this.rateLimitHits,
			lastHitTime: this.lastRateLimitTime
		};
	}

	/**
	 * P1优化：获取 Prompt Cache 统计
	 */
	public getPromptCacheStats(): {
		enabled: boolean;
		hits: number;
		misses: number;
		hitRate: string;
	} {
		const total = this.systemPromptCacheHits + this.systemPromptCacheMisses;
		const hitRate = total > 0 ? ((this.systemPromptCacheHits / total) * 100).toFixed(1) : '0';
		return {
			enabled: this.PROMPT_CACHE_CONFIG.enabled,
			hits: this.systemPromptCacheHits,
			misses: this.systemPromptCacheMisses,
			hitRate,
		};
	}

	/**
	 * P1优化：计算字符串哈希（用于系统提示词比较）
	 * 借鉴 Aider 的简单哈希实现
	 */
	private hashString(str: string): string {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // 转换为32位整数
		}
		return hash.toString(16);
	}

	/**
	 * P1优化：检查系统提示词是否可缓存
	 */
	private isSystemPromptCacheable(systemPrompt: string): boolean {
		if (!this.PROMPT_CACHE_CONFIG.enabled) {
			return false;
		}

		// 估算 token 数（每4个字符约1个token）
		const estimatedTokens = Math.ceil(systemPrompt.length / 4);

		// 只有大于阈值的提示词才值得缓存
		return estimatedTokens >= this.PROMPT_CACHE_CONFIG.minTokensForCaching;
	}

	/**
	 * P1优化：处理系统提示词缓存
	 * 借鉴 Cline 的 cache_control 标记策略
	 */
	private processSystemPromptForCache(systemPrompt: string): {
		prompt: string;
		cached: boolean;
		hash: string;
	} {
		const hash = this.hashString(systemPrompt);

		// 检查是否与上次相同
		if (this.lastSystemPromptHash === hash) {
			this.systemPromptCacheHits++;
			console.log(`[Maxian] 系统提示词缓存命中 (命中率: ${this.getPromptCacheStats().hitRate}%)`);
			return {
				prompt: systemPrompt,
				cached: true,
				hash,
			};
		}

		// 缓存未命中
		this.systemPromptCacheMisses++;
		this.lastSystemPromptHash = hash;
		console.log(`[Maxian] 系统提示词缓存未命中，新哈希: ${hash}`);

		return {
			prompt: systemPrompt,
			cached: false,
			hash,
		};
	}

	/**
	 * P1优化：为消息添加缓存控制标记
	 * 借鉴 Cline/Continue 的实现
	 * 注意：这主要用于 Anthropic API，对于其他 API 可能需要适配
	 */
	private addCacheControlToMessages(messages: AiProxyMessage[]): AiProxyMessage[] {
		if (!this.PROMPT_CACHE_CONFIG.enabled) {
			return messages;
		}

		// 标记策略（借鉴 Continue 的 optimized 策略）：
		// 1. 系统消息始终标记为可缓存
		// 2. 大消息（>500 tokens）标记为可缓存
		// 3. 最多标记 maxCachingMessages 个消息

		let cachedCount = 0;

		return messages.map((msg, index) => {
			// 系统消息始终可缓存
			if (msg.role === 'system') {
				return {
					...msg,
					// 添加缓存控制标记（如果后端支持）
					// @ts-ignore - cache_control 是扩展字段
					cache_control: { type: 'ephemeral' },
				};
			}

			// 限制缓存数量
			if (cachedCount >= this.PROMPT_CACHE_CONFIG.maxCachingMessages) {
				return msg;
			}

			// 大消息可缓存
			const estimatedTokens = Math.ceil(msg.content.length / 4);
			if (estimatedTokens >= this.PROMPT_CACHE_CONFIG.minTokensForCaching) {
				cachedCount++;
				return {
					...msg,
					// @ts-ignore
					cache_control: { type: 'ephemeral' },
				};
			}

			return msg;
		});
	}

	/**
	 * 🚀 延迟函数
	 */
	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
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
			// 重置用户取消标志
			this.userAborted = false;

			// 生成请求ID
			this.currentRequestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

			// P1优化：处理系统提示词缓存
			const cacheResult = this.isSystemPromptCacheable(systemPrompt)
				? this.processSystemPromptForCache(systemPrompt)
				: { prompt: systemPrompt, cached: false, hash: '' };

			// 转换消息格式
			let aiProxyMessages = this.convertMessages(cacheResult.prompt, messages);

			// P1优化：为消息添加缓存控制标记
			aiProxyMessages = this.addCacheControlToMessages(aiProxyMessages);

			// 转换工具定义
			const aiProxyTools = tools ? this.convertTools(tools) : undefined;

			// 构建请求参数
			const requestBody: AiProxyRequest = {
				username: this.config.username,
				password: this.config.password,
				requestId: this.currentRequestId,
				messages: aiProxyMessages,
				maxTokens: 8192,  // 必须设置有效的 max_tokens，千问API要求范围 [1, 32768]
				temperature: 0.55,  // Qwen 最优温度（参考 OpenCode transform.ts，0.55 比 0.15 减少重复重试）
				top_p: 1,           // Qwen 专属配置（参考 OpenCode transform.ts）
				stream: true,
				apiType: 'chat',  // 重要：指定为 chat 模式，否则后端默认使用 completions 模式
				...(aiProxyTools && aiProxyTools.length > 0 ? {
					tools: aiProxyTools,
					toolChoice: 'auto',
					parallelToolCalls: true,        // 启用并行工具调用（驼峰命名，匹配后端Java DTO）
					parallel_tool_calls: true       // 同时发送下划线格式（阿里云千问API格式）
				} : {})
			};

		// 优先使用businessCode，如果没有则使用provider/model（向后兼容）
		if (this.config.businessCode) {
			requestBody.businessCode = this.config.businessCode;
		} else {
			requestBody.provider = this.config.provider || 'qwen';
			requestBody.model = this.config.model;
		}

			// 调试日志：确认工具是否正确发送
			console.log('[Maxian] AiProxy 请求:', {
				businessCode: requestBody.businessCode,
				provider: requestBody.provider,
				model: requestBody.model,
				apiType: requestBody.apiType,
				toolsCount: aiProxyTools?.length || 0,
				messagesCount: aiProxyMessages.length,
				hasTools: !!(aiProxyTools && aiProxyTools.length > 0),
				parallelToolCalls: requestBody.parallelToolCalls,  // ✅ 显示并行工具调用状态
				promptCached: cacheResult.cached,  // P1优化：显示缓存状态
				promptCacheHitRate: this.getPromptCacheStats().hitRate + '%',
			});
			if (aiProxyTools && aiProxyTools.length > 0) {
				console.log('[Maxian] 工具列表:', aiProxyTools.map(t => t.function.name));
				console.log('[Maxian] 并行工具调用已启用 - AI可以在一次响应中调用多个工具');
			}

			// 构建 API 端点
			const apiEndpoint = this.buildApiEndpoint();
			const requestOptions: RequestInit = {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'text/event-stream'
				},
				body: JSON.stringify(requestBody)
			};

			// 🚀 带超时和重试的请求（P1优化：支持Rate Limit自适应）
			let lastError: any = null;
			let response: Response | null = null;
			let rateLimitDelay: number | undefined = undefined;

			for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
				try {
					if (attempt > 0) {
						// P1优化：优先使用Rate Limit指定的延迟
						const retryDelay = this.getRetryDelay(attempt - 1, rateLimitDelay);
						console.log(`[Maxian] 重试API请求 (${attempt}/${this.MAX_RETRIES})，等待 ${retryDelay}ms ${rateLimitDelay ? '(Rate Limit)' : ''}`);
						await this.delay(retryDelay);
						rateLimitDelay = undefined; // 重置Rate Limit延迟
					}

					const startTime = Date.now();
					response = await this.fetchWithTimeout(apiEndpoint, requestOptions, this.REQUEST_TIMEOUT);
					const elapsed = Date.now() - startTime;
					console.log(`[Maxian] API请求完成，耗时: ${elapsed}ms`);

					if (response.ok) {
						break; // 成功，退出重试循环
					}

					// HTTP错误
					const errorText = await response.text();
					lastError = { status: response.status, message: errorText };
					console.error(`[Maxian] AiProxy API 错误 (${response.status}):`, errorText);

					// P1优化：解析Rate Limit延迟
					if (response.status === 429) {
						rateLimitDelay = this.parseRateLimitDelay(response);
					}

					// 检查是否可重试
					if (!this.isRetryableError(lastError) || attempt === this.MAX_RETRIES) {
						const errorChunk: ErrorStreamChunk = {
							type: 'error',
							error: `AiProxy API 错误 (${response.status}): ${errorText}`
						};
						yield errorChunk;
						return;
					}
				} catch (error) {
					lastError = error;
					console.error(`[Maxian] API请求失败 (尝试 ${attempt + 1}):`, error);

					// 检查是否可重试
					if (!this.isRetryableError(error) || attempt === this.MAX_RETRIES) {
						const errorChunk: ErrorStreamChunk = {
							type: 'error',
							error: error instanceof Error ? error.message : String(error)
						};
						yield errorChunk;
						return;
					}
				}
			}

			if (!response || !response.ok) {
				const errorChunk: ErrorStreamChunk = {
					type: 'error',
					error: `API请求失败: ${lastError?.message || '未知错误'}`
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
			this.currentAbortController = null;
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
				const toolResults: Array<{ tool_call_id: string; content: string }> = [];

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
						toolResults.push({
							tool_call_id: block.tool_use_id,
							content: block.content
						});
					}
				}

				// assistant消息：包含文本和tool_calls
				if (msg.role === 'assistant' || toolCalls.length > 0) {
					const aiProxyMsg: AiProxyMessage = {
						role: msg.role,
						content: textContent || ''
					};
					if (toolCalls.length > 0) {
						aiProxyMsg.tool_calls = toolCalls;
					}
					result.push(aiProxyMsg);
				}

				// tool消息：每个tool_result必须作为独立消息（OpenAI API格式要求）
				// 关键修复：之前只保留最后一个tool_result，导致模型丢失前面的工具结果
				if (toolResults.length > 0) {
					for (const tr of toolResults) {
						result.push({
							role: 'tool',
							content: tr.content,
							tool_call_id: tr.tool_call_id
						});
					}
				} else if (msg.role !== 'assistant' && toolCalls.length === 0) {
					// 普通用户消息
					result.push({
						role: msg.role,
						content: textContent
					});
				}
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
		let totalBytesReceived = 0;
		let dataLinesCount = 0;
		let nonDataLinesCount = 0;
		const nonDataLines: string[] = []; // 记录非data行（通常是错误信息）

		// 用于累积工具调用的参数（使用index作为key，与QwenHandler一致）
		const toolCallsMap = new Map<string, { id: string; name: string; arguments: string }>();

		try {
			while (true) {
				const { done, value } = await reader.read();

				if (done) {
					break;
				}

				// 解码数据
				const chunk = decoder.decode(value, { stream: true });
				totalBytesReceived += value.byteLength;
				buffer += chunk;

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
						dataLinesCount++;
					} else if (trimmedLine.startsWith('data:')) {
						data = trimmedLine.slice(5); // 移除 "data:" 前缀
						dataLinesCount++;
					} else {
						// 非 data: 行 - 可能是错误响应体或其他SSE字段
						nonDataLinesCount++;
						if (nonDataLines.length < 10) {
							nonDataLines.push(trimmedLine);
						}
						continue;
					}

					// 检查是否结束
					if (data === '[DONE]') {
						console.log('[Maxian] 收到 [DONE]');
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
									input: sanitizeToolArguments(toolData.arguments)
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
			// 诊断日志：显示流接收到的数据统计
			console.log(`[Maxian] 流处理完成: 总字节=${totalBytesReceived}, data行=${dataLinesCount}, 非data行=${nonDataLinesCount}`);
			if (nonDataLinesCount > 0) {
				console.warn('[Maxian] 流中存在非data行（可能是错误响应）:', nonDataLines);
			}
			if (dataLinesCount === 0 && totalBytesReceived > 0) {
				console.error('[Maxian] 收到响应数据但无任何data行！后端可能返回了非SSE格式的错误响应。');
			}
			if (totalBytesReceived === 0) {
				console.error('[Maxian] 响应流完全为空（0字节）！');
			}
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
	 * 🚀 优化：使用AbortController立即中止客户端请求
	 */
	async stopCurrentRequest(): Promise<boolean> {
		// 标记为用户主动取消，防止AbortError触发重试
		this.userAborted = true;

		// 首先使用AbortController立即中止客户端请求
		if (this.currentAbortController) {
			console.log('[Maxian] 使用AbortController中止请求（用户取消）');
			this.currentAbortController.abort();
			this.currentAbortController = null;
		}

		if (!this.currentRequestId) {
			return false;
		}

		try {
			// 同时通知后端中止处理
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

/**
 * 清理 Qwen 流式 API 返回的工具参数字符串
 * Qwen API 有时会在完整 JSON 末尾多发一个 `}` 字符，导致 JSON.parse 失败
 * 使用括号匹配算法提取第一个完整的 JSON 对象
 */
function sanitizeToolArguments(args: string): string {
	const trimmed = args.trim();
	if (!trimmed.startsWith('{')) {
		return trimmed;
	}
	try {
		JSON.parse(trimmed);
		return trimmed; // 已经是合法JSON，直接返回
	} catch {
		// 括号匹配：找到第一个完整的 JSON 对象结尾
		let depth = 0;
		let inString = false;
		let escape = false;
		for (let i = 0; i < trimmed.length; i++) {
			const c = trimmed[i];
			if (escape) { escape = false; continue; }
			if (c === '\\' && inString) { escape = true; continue; }
			if (c === '"') { inString = !inString; continue; }
			if (inString) { continue; }
			if (c === '{') { depth++; }
			else if (c === '}') {
				depth--;
				if (depth === 0) {
					const cleaned = trimmed.substring(0, i + 1);
					console.warn(`[Maxian] sanitizeToolArguments: 截取合法JSON (${i + 1}/${trimmed.length})`);
					return cleaned;
				}
			}
		}
		return trimmed; // 找不到完整JSON，返回原始值交给调用方处理
	}
}
