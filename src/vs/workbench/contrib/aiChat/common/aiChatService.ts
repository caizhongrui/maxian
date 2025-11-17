/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { ChatRequest, ChatResponse, ChatMessage, Conversation, ConversationContext } from './chatTypes.js';

export const IAIChatService = createDecorator<IAIChatService>('aiChatService');

/**
 * AI 聊天服务接口
 */
export interface IAIChatService {
	readonly _serviceBrand: undefined;

	/**
	 * 当有新消息添加时触发
	 */
	readonly onMessageAdded: Event<ChatMessage>;

	/**
	 * 当对话被清除时触发
	 */
	readonly onConversationCleared: Event<void>;

	/**
	 * 当消息内容更新时触发（用于流式响应）
	 */
	readonly onMessageUpdated: Event<ChatMessage>;

	/**
	 * 发送消息
	 */
	sendMessage(message: string, includeContext: boolean, token?: CancellationToken): Promise<ChatResponse>;

	/**
	 * 发送带类型的请求
	 */
	sendRequest(request: ChatRequest, token?: CancellationToken): Promise<ChatResponse>;

	/**
	 * 获取消息历史
	 */
	getHistory(limit?: number): ChatMessage[];

	/**
	 * 清除历史
	 */
	clearHistory(): void;

	/**
	 * 获取当前会话
	 */
	getCurrentConversation(): Conversation;

	/**
	 * 提取当前上下文
	 */
	extractContext(token?: CancellationToken): Promise<ConversationContext>;

	/**
	 * 解释代码
	 */
	explainCode(code: string, language: string, token?: CancellationToken): Promise<ChatResponse>;

	/**
	 * 优化代码
	 */
	optimizeCode(code: string, language: string, token?: CancellationToken): Promise<ChatResponse>;

	/**
	 * 查找错误
	 */
	findBugs(code: string, language: string, token?: CancellationToken): Promise<ChatResponse>;

	/**
	 * 生成文档
	 */
	generateDocs(code: string, language: string, token?: CancellationToken): Promise<ChatResponse>;
}
