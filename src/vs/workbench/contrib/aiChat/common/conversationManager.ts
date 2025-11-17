/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import {
	ChatMessage,
	ChatRole,
	ChatResponse,
	ChatRequest,
	Conversation,
	ChatRequestType,
	SuggestedAction
} from './chatTypes.js';
import { generateUuid } from '../../../../base/common/uuid.js';

/**
 * 对话管理器
 * 负责管理聊天会话、消息历史、AI交互
 */
export class ConversationManager extends Disposable {
	private static readonly MAX_HISTORY_LENGTH = 50;
	private static readonly MAX_CONTEXT_MESSAGES = 10;

	private readonly _onMessageAdded = this._register(new Emitter<ChatMessage>());
	readonly onMessageAdded: Event<ChatMessage> = this._onMessageAdded.event;

	private readonly _onConversationCleared = this._register(new Emitter<void>());
	readonly onConversationCleared: Event<void> = this._onConversationCleared.event;

	private readonly _onMessageUpdated = this._register(new Emitter<ChatMessage>());
	readonly onMessageUpdated: Event<ChatMessage> = this._onMessageUpdated.event;

	private currentConversation: Conversation;

	constructor(
		private readonly aiService: IAIService
	) {
		super();
		this.currentConversation = this.createNewConversation();
	}

	/**
	 * 发送消息(流式)
	 */
	async sendMessage(request: ChatRequest, token?: CancellationToken): Promise<ChatResponse> {
		try {
			// 创建用户消息
			const userMessage: ChatMessage = {
				id: generateUuid(),
				role: ChatRole.User,
				content: request.message,
				timestamp: Date.now(),
				codeSnippet: request.context?.selectedCode,
				fileContext: request.context?.currentFile
			};

			// 添加到历史
			this.addMessage(userMessage);

			// 构建AI提示词
			const prompt = this.buildPrompt(request);

			// 创建助手消息占位符
			const assistantMessage: ChatMessage = {
				id: generateUuid(),
				role: ChatRole.Assistant,
				content: '',
				timestamp: Date.now()
			};

			// 添加到历史并设置为当前流式消息
			this.addMessage(assistantMessage);

			// 使用流式API调用AI服务
			let fullContent = '';
			const abortController = new AbortController();

			// 如果有取消令牌,监听它
			if (token) {
				token.onCancellationRequested(() => {
					abortController.abort();
				});
			}

			await this.aiService.completeStream(prompt, (chunk) => {
				fullContent = chunk.content;
				// 更新消息内容
				assistantMessage.content = fullContent;
				// 触发更新事件
				this._onMessageUpdated.fire(assistantMessage);
			}, abortController.signal);

			// 流式响应完成,清除当前流式消息ID

			// 生成建议操作
			const suggestedActions = this.generateSuggestedActions(request.type, fullContent);

			return {
				message: assistantMessage,
				suggestedActions: suggestedActions,
				isComplete: true
			};

		} catch (error) {
			console.error('[Conversation Manager] Failed to send message:', error);

			// 创建错误消息
			const errorMessage: ChatMessage = {
				id: generateUuid(),
				role: ChatRole.Assistant,
				content: '抱歉，AI服务暂时不可用，请稍后重试。',
				timestamp: Date.now()
			};

			// 如果已经创建了流式消息,更新它;否则添加新消息
			const lastMessage = this.currentConversation.messages[this.currentConversation.messages.length - 1];
			if (lastMessage && lastMessage.role === ChatRole.Assistant && !lastMessage.content) {
				lastMessage.content = errorMessage.content;
				this._onMessageUpdated.fire(lastMessage);
				return {
					message: lastMessage,
					isComplete: false,
					error: String(error)
				};
			} else {
				this.addMessage(errorMessage);
				return {
					message: errorMessage,
					isComplete: false,
					error: String(error)
				};
			}
		}
	}

	/**
	 * 获取消息历史
	 */
	getHistory(limit?: number): ChatMessage[] {
		const messages = this.currentConversation.messages;
		if (limit && limit < messages.length) {
			return messages.slice(-limit);
		}
		return [...messages];
	}

	/**
	 * 清除历史
	 */
	clearHistory(): void {
		this.currentConversation = this.createNewConversation();
		this._onConversationCleared.fire();
		console.log('[Conversation Manager] History cleared');
	}

	/**
	 * 获取当前会话
	 */
	getCurrentConversation(): Conversation {
		return this.currentConversation;
	}

	/**
	 * 删除消息
	 */
	deleteMessage(messageId: string): boolean {
		const index = this.currentConversation.messages.findIndex(m => m.id === messageId);
		if (index >= 0) {
			this.currentConversation.messages.splice(index, 1);
			this.currentConversation.updatedAt = Date.now();
			return true;
		}
		return false;
	}

	/**
	 * 编辑消息
	 */
	editMessage(messageId: string, newContent: string): boolean {
		const message = this.currentConversation.messages.find(m => m.id === messageId);
		if (message) {
			message.content = newContent;
			message.timestamp = Date.now();
			this.currentConversation.updatedAt = Date.now();
			return true;
		}
		return false;
	}

	// ====== 私有方法 ======

	/**
	 * 创建新会话
	 */
	private createNewConversation(): Conversation {
		return {
			id: generateUuid(),
			title: `对话 ${new Date().toLocaleString()}`,
			messages: [],
			createdAt: Date.now(),
			updatedAt: Date.now()
		};
	}

	/**
	 * 添加消息
	 */
	private addMessage(message: ChatMessage): void {
		this.currentConversation.messages.push(message);
		this.currentConversation.updatedAt = Date.now();

		// 限制历史长度
		if (this.currentConversation.messages.length > ConversationManager.MAX_HISTORY_LENGTH) {
			this.currentConversation.messages.shift();
		}

		this._onMessageAdded.fire(message);
	}

	/**
	 * 构建AI提示词
	 */
	private buildPrompt(request: ChatRequest): string {
		const parts: string[] = [];

		// 系统提示
		parts.push(this.getSystemPrompt(request.type));

		// 添加上下文
		if (request.includeContext && request.context) {
			const contextPrompt = this.buildContextPrompt(request.context);
			if (contextPrompt) {
				parts.push(contextPrompt);
			}
		}

		// 添加历史对话（最近N条）
		const recentHistory = this.getHistory(ConversationManager.MAX_CONTEXT_MESSAGES);
		if (recentHistory.length > 0) {
			parts.push('\n【历史对话】');
			for (const msg of recentHistory) {
				if (msg.role === ChatRole.User) {
					parts.push(`用户: ${msg.content}`);
				} else if (msg.role === ChatRole.Assistant) {
					parts.push(`助手: ${msg.content}`);
				}
			}
		}

		// 当前用户消息
		parts.push('\n【当前问题】');
		parts.push(request.message);

		return parts.join('\n');
	}

	/**
	 * 获取系统提示词
	 */
	private getSystemPrompt(type?: ChatRequestType): string {
		const basePrompt = '你是一个专业的编程助手，擅长帮助开发者解决各种编程问题。\n\n【重要格式要求】：\n1. 段落之间只能使用一个换行符(\\n)，严禁使用两个连续的换行符(\\n\\n)\n2. 代码块前后各用一个换行符分隔\n3. 列表项之间只用一个换行符\n4. 回复要紧凑，不要有多余的空行';

		switch (type) {
			case ChatRequestType.ExplainCode:
				return `${basePrompt}\n请用通俗易懂的语言解释代码的功能和实现原理。记住：段落之间只用一个换行符。`;

			case ChatRequestType.OptimizeCode:
				return `${basePrompt}\n请分析代码并提供优化建议，包括性能优化、代码可读性改进等。记住：段落之间只用一个换行符。`;

			case ChatRequestType.FindBugs:
				return `${basePrompt}\n请仔细检查代码，找出潜在的错误、Bug和安全漏洞。记住：段落之间只用一个换行符。`;

			case ChatRequestType.GenerateDocs:
				return `${basePrompt}\n请为代码生成详细的文档注释，包括参数说明、返回值、使用示例等。记住：段落之间只用一个换行符。`;

			case ChatRequestType.RefactorCode:
				return `${basePrompt}\n请提供代码重构建议，改善代码结构和设计模式。记住：段落之间只用一个换行符。`;

			default:
				return basePrompt;
		}
	}

	/**
	 * 构建上下文提示词
	 */
	private buildContextPrompt(context: any): string {
		const parts: string[] = ['\n【当前上下文】'];

		// 当前文件
		if (context.currentFile) {
			parts.push(`文件: ${context.currentFile.fileName}`);
			parts.push(`语言: ${context.currentFile.language}`);

			// 如果有代码结构信息，优先展示结构化信息
			if (context.currentFile.codeStructure) {
				parts.push('\n文件代码结构:');

				// 类信息
				if (context.currentFile.codeStructure.classes && context.currentFile.codeStructure.classes.length > 0) {
					parts.push('类:');
					context.currentFile.codeStructure.classes.forEach((cls: any) => {
						parts.push(`  - ${cls.name} (${cls.visibility})`);
						if (cls.methods && cls.methods.length > 0) {
							parts.push(`    方法: ${cls.methods.map((m: any) => m.name).join(', ')}`);
						}
						if (cls.properties && cls.properties.length > 0) {
							parts.push(`    属性: ${cls.properties.map((p: any) => p.name).join(', ')}`);
						}
					});
				}

				// 函数信息
				if (context.currentFile.codeStructure.functions && context.currentFile.codeStructure.functions.length > 0) {
					parts.push('函数:');
					context.currentFile.codeStructure.functions.forEach((func: any) => {
						parts.push(`  - ${func.name}(${func.parameters.map((p: any) => p.name).join(', ')}): ${func.returnType || 'void'}`);
					});
				}

				// 导入信息
				if (context.currentFile.codeStructure.imports && context.currentFile.codeStructure.imports.length > 0) {
					parts.push('导入:');
					const importSummary = context.currentFile.codeStructure.imports.slice(0, 5).map((imp: any) => imp.modulePath);
					if (context.currentFile.codeStructure.imports.length > 5) {
						parts.push(`  ${importSummary.join(', ')} ... (共${context.currentFile.codeStructure.imports.length}个)`);
					} else {
						parts.push(`  ${importSummary.join(', ')}`);
					}
				}

				// 框架信息
				if (context.currentFile.codeStructure.frameworks && context.currentFile.codeStructure.frameworks.length > 0) {
					parts.push(`使用框架: ${context.currentFile.codeStructure.frameworks.join(', ')}`);
				}
			}

			// 如果是小文件且有内容，也包含完整内容
			if (context.currentFile.content) {
				parts.push(`\n文件内容:\n\`\`\`${context.currentFile.language}\n${context.currentFile.content}\n\`\`\``);
			}
		}

		// 选中的代码
		if (context.selectedCode) {
			parts.push(`\n选中代码:\n\`\`\`${context.selectedCode.language}\n${context.selectedCode.code}\n\`\`\``);
		}

		// 项目信息
		if (context.projectLanguage) {
			parts.push(`项目语言: ${context.projectLanguage}`);
		}

		if (context.projectFrameworks && context.projectFrameworks.length > 0) {
			parts.push(`项目框架: ${context.projectFrameworks.join(', ')}`);
		}

		// 最近的错误
		if (context.recentErrors && context.recentErrors.length > 0) {
			parts.push(`\n最近的错误:`);
			context.recentErrors.forEach((error: string, index: number) => {
				parts.push(`${index + 1}. ${error}`);
			});
		}

		return parts.join('\n');
	}

	/**
	 * 生成建议操作
	 */
	private generateSuggestedActions(type?: ChatRequestType, response?: string): SuggestedAction[] {
		const actions: SuggestedAction[] = [];

		// 根据请求类型生成不同的建议
		switch (type) {
			case ChatRequestType.ExplainCode:
				actions.push({
					id: 'generate-docs',
					title: '生成文档',
					description: '为这段代码生成文档注释',
					command: 'zhikai.generateDocs'
				});
				actions.push({
					id: 'optimize-code',
					title: '优化代码',
					description: '查看代码优化建议',
					command: 'zhikai.optimizeCode'
				});
				break;

			case ChatRequestType.FindBugs:
				actions.push({
					id: 'fix-bugs',
					title: '修复问题',
					description: '应用AI建议修复代码问题',
					command: 'zhikai.fixBugs'
				});
				break;

			case ChatRequestType.OptimizeCode:
				actions.push({
					id: 'apply-optimization',
					title: '应用优化',
					description: '应用建议的优化方案',
					command: 'zhikai.applyOptimization'
				});
				break;

			case ChatRequestType.GenerateDocs:
				actions.push({
					id: 'insert-docs',
					title: '插入文档',
					description: '将生成的文档插入到代码中',
					command: 'zhikai.insertDocs'
				});
				break;
		}

		// 通用建议
		actions.push({
			id: 'copy-code',
			title: '复制代码',
			description: '复制AI回复中的代码',
			command: 'zhikai.copyCode'
		});

		return actions;
	}
}
