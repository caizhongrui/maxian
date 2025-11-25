/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IAIService = createDecorator<IAIService>('aiService');

/**
 * AI Token使用量统计
 */
export interface AIUsage {
	promptTokens: number;      // 输入token数
	completionTokens: number;  // 输出token数
	totalTokens: number;       // 总token数
}

/**
 * AI响应（包含内容和使用量）
 */
export interface AIResponse {
	content: string;
	usage?: AIUsage;
}

/**
 * AI Stream Chunk - 流式响应的数据块
 */
export interface AIStreamChunk {
	content: string;
	isComplete: boolean;
	usage?: AIUsage;  // 流式响应完成时包含usage
}

/**
 * AI Stream Callback - 流式响应回调
 */
export type AIStreamCallback = (chunk: AIStreamChunk) => void;

export interface IAIService {

	readonly _serviceBrand: undefined;

	/**
	 * Complete with AI (返回内容字符串，向后兼容)
	 * @param prompt The prompt text
	 * @param options Optional parameters (temperature, maxTokens, systemMessage)
	 * @returns AI response content
	 */
	complete(prompt: string, options?: { temperature?: number; maxTokens?: number; systemMessage?: string }): Promise<string>;

	/**
	 * Complete with AI and return usage statistics (返回内容和token使用量)
	 * @param prompt The prompt text
	 * @param options Optional parameters (temperature, maxTokens, systemMessage)
	 * @returns AI response with usage statistics
	 */
	completeWithUsage(prompt: string, options?: { temperature?: number; maxTokens?: number; systemMessage?: string }): Promise<AIResponse>;

	/**
	 * Complete with AI in streaming mode (流式响应)
	 * @param prompt The prompt text
	 * @param onChunk Callback for each chunk (最后一个chunk会包含usage)
	 * @param abortSignal Optional AbortSignal to cancel the request
	 * @returns Promise that resolves when streaming is complete
	 */
	completeStream(prompt: string, onChunk: AIStreamCallback, abortSignal?: AbortSignal): Promise<void>;

	/**
	 * Generate code with AI
	 * @param request Generation request
	 * @param token Cancellation token
	 * @returns Generated code
	 */
	generate(request: AIGenerationRequest, token?: any): Promise<AIGeneratedCode>;

	/**
	 * Modify code with AI
	 * @param code Original code
	 * @param instruction Modification instruction
	 * @param token Cancellation token
	 * @returns Modified code
	 */
	modify(code: string, instruction: string, token?: any): Promise<AICodeModification>;
}

/**
 * AI Generation Request
 */
export interface AIGenerationRequest {
	type: 'test' | 'comment' | 'business';
	sourceCode?: string;
	requirement?: string;
	language: string;
	context?: any;
}

/**
 * AI Generated Code
 */
export interface AIGeneratedCode {
	code: string;
	description?: string;
}

/**
 * AI Code Modification
 */
export interface AICodeModification {
	modifiedCode: string;
	summary: string;
}
