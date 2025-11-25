/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Complete Task implementation based on Kilocode's Task class
// Full functionality: ask/say system, tool approval, error handling, attempt_completion

import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IApiHandler, MessageParam, ToolDefinition, ContentBlock, StreamChunk } from '../api/types.js';
import { IToolExecutor } from '../tools/toolExecutor.js';
import { ToolName } from '../tools/toolTypes.js';
import { ToolRepetitionDetector } from '../tools/ToolRepetitionDetector.js';
import { formatResponse } from '../prompts/formatResponse.js';
import {
	TaskStatus,
	TokenUsage,
	ToolUsage,
	TaskMetadata,
	ClineMessage,
	CreateTaskOptions,
	ClineApiReqCancelReason,
	ClineAsk,
	ClineSay,
	ClineAskResponse,
	ToolProgressStatus
} from './taskTypes.js';

const MAX_EXPONENTIAL_BACKOFF_SECONDS = 600; // 10分钟最大退避时间
const MAX_CONSECUTIVE_MISTAKES = 3; // 最大连续错误次数

/**
 * TaskService配置选项
 */
export interface TaskServiceOptions extends CreateTaskOptions {
	apiHandler: IApiHandler;
	toolExecutor: IToolExecutor;
	getSystemPrompt: () => string;
	getToolDefinitions: () => ToolDefinition[];
	workspaceRoot?: string;
	consecutiveMistakeLimit?: number;
	currentMode?: string; // 当前模式，用于特殊处理（如ask模式）
}

/**
 * TaskService - 完整实现参照Kilocode Task
 * 核心功能：
 * - 完整的ask/say消息系统
 * - 工具审批流程
 * - 递归API调用循环
 * - 工具执行与重复检测
 * - 错误处理与重试
 * - attempt_completion用户确认
 */
export class TaskService extends Disposable {
	// Events
	private readonly _onStatusChanged = this._register(new Emitter<TaskStatus>());
	readonly onStatusChanged: Event<TaskStatus> = this._onStatusChanged.event;

	private readonly _onMessageAdded = this._register(new Emitter<ClineMessage>());
	readonly onMessageAdded: Event<ClineMessage> = this._onMessageAdded.event;

	private readonly _onStreamChunk = this._register(new Emitter<{ text?: string; isPartial: boolean }>());
	readonly onStreamChunk: Event<{ text?: string; isPartial: boolean }> = this._onStreamChunk.event;

	private readonly _onTokenUsageUpdated = this._register(new Emitter<TokenUsage>());
	readonly onTokenUsageUpdated: Event<TokenUsage> = this._onTokenUsageUpdated.event;

	private readonly _onUserInputRequired = this._register(new Emitter<{ question: string; toolUseId: string }>());
	readonly onUserInputRequired: Event<{ question: string; toolUseId: string }> = this._onUserInputRequired.event;

	// Task metadata
	readonly taskId: string;
	readonly metadata: TaskMetadata;

	// Status
	private _status: TaskStatus = TaskStatus.IDLE;
	abort: boolean = false;
	abortReason?: ClineApiReqCancelReason;

	// Ask/Say response handling - 参照kilocode
	private askResponse?: ClineAskResponse;
	private askResponseText?: string;
	private askResponseImages?: string[];
	private lastMessageTs?: number;

	// API & Tools
	private readonly apiHandler: IApiHandler;
	private readonly toolExecutor: IToolExecutor;
	private readonly getSystemPrompt: () => string;
	private readonly getToolDefinitions: () => ToolDefinition[];

	// Tool repetition detection
	private readonly toolRepetitionDetector: ToolRepetitionDetector;
	consecutiveMistakeCount: number = 0;
	private readonly consecutiveMistakeLimit: number;

	// Current mode (for special handling like ask mode)
	private readonly currentMode: string;

	// Message history
	private apiConversationHistory: MessageParam[] = [];
	clineMessages: ClineMessage[] = [];

	// Token & Tool usage
	private tokenUsage: TokenUsage = {
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCost: 0,
		contextTokens: 0
	};
	toolUsage: ToolUsage = {};

	constructor(options: TaskServiceOptions) {
		super();

		this.taskId = this.generateTaskId();
		this.apiHandler = options.apiHandler;
		this.toolExecutor = options.toolExecutor;
		this.getSystemPrompt = options.getSystemPrompt;
		this.getToolDefinitions = options.getToolDefinitions;
		this.consecutiveMistakeLimit = options.consecutiveMistakeLimit || MAX_CONSECUTIVE_MISTAKES;
		this.currentMode = options.currentMode || 'code';

		this.toolRepetitionDetector = new ToolRepetitionDetector(this.consecutiveMistakeLimit);

		this.metadata = {
			taskId: this.taskId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			status: TaskStatus.IDLE
		};

		// 如果提供了初始任务，添加到历史
		if (options.task) {
			this.apiConversationHistory.push({
				role: 'user',
				content: options.task
			});
		}
	}

	/**
	 * 生成任务ID
	 */
	private generateTaskId(): string {
		return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	/**
	 * 生成消息时间戳 - 参照kilocode
	 */
	private async nextClineMessageTimestamp(): Promise<number> {
		let ts = Date.now();
		while (ts <= (this.clineMessages[this.clineMessages.length - 1]?.ts ?? 0)) {
			await new Promise<void>(resolve => setTimeout(resolve, 1));
			ts = Date.now();
		}
		return ts;
	}

	/**
	 * 获取当前状态
	 */
	get status(): TaskStatus {
		return this._status;
	}

	/**
	 * 设置状态
	 */
	private setStatus(status: TaskStatus): void {
		if (this._status !== status) {
			this._status = status;
			this.metadata.status = status;
			this.metadata.updatedAt = Date.now();
			this._onStatusChanged.fire(status);
		}
	}

	// ========== Ask/Say消息系统 - 参照kilocode完整实现 ==========

	/**
	 * Ask - 向用户询问并等待响应
	 * 参照kilocode的ask方法完整实现
	 */
	async ask(
		type: ClineAsk,
		text?: string,
		partial?: boolean,
		progressStatus?: ToolProgressStatus
	): Promise<{ response: ClineAskResponse; text?: string; images?: string[] }> {
		if (this.abort) {
			throw new Error(`[TaskService#ask] task ${this.taskId} aborted`);
		}

		let askTs: number;

		if (partial !== undefined) {
			const lastMessage = this.clineMessages[this.clineMessages.length - 1];

			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === 'ask' && lastMessage.ask === type;

			if (partial) {
				if (isUpdatingPreviousPartial) {
					// 更新现有的partial消息
					lastMessage.text = text;
					lastMessage.partial = partial;
					lastMessage.progressStatus = progressStatus;
					this._onMessageAdded.fire(lastMessage);
					throw new Error('Current ask promise was ignored (#1)');
				} else {
					// 新的partial消息
					askTs = await this.nextClineMessageTimestamp();
					this.lastMessageTs = askTs;
					const message: ClineMessage = { ts: askTs, type: 'ask', ask: type, text, partial };
					this.clineMessages.push(message);
					this._onMessageAdded.fire(message);
					throw new Error('Current ask promise was ignored (#2)');
				}
			} else {
				if (isUpdatingPreviousPartial) {
					// 完成之前的partial消息
					this.askResponse = undefined;
					this.askResponseText = undefined;
					this.askResponseImages = undefined;

					askTs = lastMessage.ts;
					this.lastMessageTs = askTs;
					lastMessage.text = text;
					lastMessage.partial = false;
					lastMessage.progressStatus = progressStatus;
					this._onMessageAdded.fire(lastMessage);
				} else {
					// 新的完整消息
					this.askResponse = undefined;
					this.askResponseText = undefined;
					this.askResponseImages = undefined;
					askTs = await this.nextClineMessageTimestamp();
					this.lastMessageTs = askTs;
					const message: ClineMessage = { ts: askTs, type: 'ask', ask: type, text };
					this.clineMessages.push(message);
					this._onMessageAdded.fire(message);
				}
			}
		} else {
			// 新的非partial消息
			this.askResponse = undefined;
			this.askResponseText = undefined;
			this.askResponseImages = undefined;
			askTs = await this.nextClineMessageTimestamp();
			this.lastMessageTs = askTs;
			const message: ClineMessage = { ts: askTs, type: 'ask', ask: type, text };
			this.clineMessages.push(message);
			this._onMessageAdded.fire(message);
		}

		// 等待用户响应
		await this.waitForAskResponse(askTs);

		const result = {
			response: this.askResponse!,
			text: this.askResponseText,
			images: this.askResponseImages
		};

		// 清空响应
		this.askResponse = undefined;
		this.askResponseText = undefined;
		this.askResponseImages = undefined;

		return result;
	}

	/**
	 * 等待ask响应
	 */
	private async waitForAskResponse(askTs: number): Promise<void> {
		// 简化版本：使用轮询等待askResponse被设置
		while (!(this.askResponse !== undefined || this.lastMessageTs !== askTs)) {
			if (this.abort) {
				throw new Error(`[TaskService] task ${this.taskId} aborted while waiting for ask response`);
			}
			await new Promise<void>(resolve => setTimeout(resolve, 100));
		}
	}

	/**
	 * 处理webview的ask响应 - 由MaxianService调用
	 */
	public handleWebviewAskResponse(askTs: number, response: ClineAskResponse, text?: string, images?: string[]): void {
		// 验证askTs是否匹配当前等待的ask
		if (this.lastMessageTs !== askTs) {
			console.warn(`[TaskService] Ask响应时间戳不匹配: 期望 ${this.lastMessageTs}, 收到 ${askTs}`);
			return;
		}

		this.askResponse = response;
		this.askResponseText = text;
		this.askResponseImages = images;
	}

	/**
	 * 恢复任务并添加用户输入 - 由MaxianService调用
	 * 用于submitUserResponse的实现
	 */
	public resumeWithUserInput(userMessage: string): void {
		// 添加用户消息到历史
		this.addUserMessage(userMessage);

		// 如果正在等待ask响应,将其设置为messageResponse
		if (this.lastMessageTs !== undefined) {
			this.askResponse = 'messageResponse';
			this.askResponseText = userMessage;
			this.askResponseImages = undefined;
		}
	}

	/**
	 * Say - 向用户发送消息
	 * 参照kilocode的say方法完整实现
	 */
	async say(
		type: ClineSay,
		text?: string,
		images?: string[],
		partial?: boolean,
		progressStatus?: ToolProgressStatus
	): Promise<void> {
		if (this.abort) {
			throw new Error(`[TaskService#say] task ${this.taskId} aborted`);
		}

		if (partial !== undefined) {
			const lastMessage = this.clineMessages[this.clineMessages.length - 1];

			const isUpdatingPreviousPartial =
				lastMessage && lastMessage.partial && lastMessage.type === 'say' && lastMessage.say === type;

			if (partial) {
				if (isUpdatingPreviousPartial) {
					// 更新现有的partial消息
					lastMessage.text = text;
					lastMessage.images = images;
					lastMessage.partial = partial;
					lastMessage.progressStatus = progressStatus;
					this._onMessageAdded.fire(lastMessage);
				} else {
					// 新的partial消息
					const sayTs = await this.nextClineMessageTimestamp();
					this.lastMessageTs = sayTs;
					const message: ClineMessage = { ts: sayTs, type: 'say', say: type, text, images, partial };
					this.clineMessages.push(message);
					this._onMessageAdded.fire(message);
				}
			} else {
				if (isUpdatingPreviousPartial) {
					// 完成之前的partial消息
					this.lastMessageTs = lastMessage.ts;
					lastMessage.text = text;
					lastMessage.images = images;
					lastMessage.partial = false;
					lastMessage.progressStatus = progressStatus;
					this._onMessageAdded.fire(lastMessage);
				} else {
					// 新的完整消息
					const sayTs = await this.nextClineMessageTimestamp();
					this.lastMessageTs = sayTs;
					const message: ClineMessage = { ts: sayTs, type: 'say', say: type, text, images };
					this.clineMessages.push(message);
					this._onMessageAdded.fire(message);
				}
			}
		} else {
			// 新的非partial消息
			const sayTs = await this.nextClineMessageTimestamp();
			this.lastMessageTs = sayTs;
			const message: ClineMessage = { ts: sayTs, type: 'say', say: type, text, images };
			this.clineMessages.push(message);
			this._onMessageAdded.fire(message);
		}
	}

	/**
	 * 缺少参数错误并say
	 */
	async sayAndCreateMissingParamError(toolName: string, paramName: string): Promise<string> {
		await this.say('error', `AI尝试使用 ${toolName} 但缺少必需参数 '${paramName}'。正在重试...`);
		return formatResponse.toolError(formatResponse.missingToolParameterError(paramName));
	}

	// ========== 任务主循环 ==========

	/**
	 * 添加用户消息
	 */
	public addUserMessage(message: string, images?: string[]): void {
		this.apiConversationHistory.push({
			role: 'user',
			content: message
		});

		// 不使用say，直接添加以避免异步问题
		const ts = Date.now();
		const clineMessage: ClineMessage = {
			ts,
			type: 'say',
			say: 'user_feedback',
			text: message,
			images
		};
		this.clineMessages.push(clineMessage);
		this._onMessageAdded.fire(clineMessage);
	}

	/**
	 * 开始任务执行
	 */
	public async start(): Promise<void> {
		if (this.abort) {
			return;
		}

		this.setStatus(TaskStatus.PROCESSING);

		try {
			await this.initiateTaskLoop();
			this.setStatus(TaskStatus.COMPLETED);
		} catch (error) {
			console.error('[TaskService] 任务执行错误:', error);
			this.setStatus(TaskStatus.ERROR);
		}
	}

	/**
	 * 任务主循环 - 参照kilocode
	 */
	private async initiateTaskLoop(): Promise<void> {
		while (!this.abort) {
			const didEndLoop = await this.recursivelyMakeClineRequests();

			if (didEndLoop) {
				break;
			} else {
				// 对于问答模式，AI可以不使用工具直接回答，直接结束循环
				if (this.currentMode === 'ask') {
					console.log('[TaskService] 问答模式：AI已回答，无需使用工具，任务结束');
					break;
				}

				// AI没有使用工具 - 提示继续
				await this.say('text', formatResponse.noToolsUsed());

				this.apiConversationHistory.push({
					role: 'user',
					content: formatResponse.noToolsUsed()
				});

				this.consecutiveMistakeCount++;
			}
		}
	}

	/**
	 * 递归调用API - 参照kilocode
	 */
	private async recursivelyMakeClineRequests(retryAttempt: number = 0): Promise<boolean> {
		if (this.abort) {
			return true;
		}

		try {
			// 调用API
			const stream = await this.attemptApiRequest(retryAttempt);

			// 处理流式响应
			const { assistantMessage, toolUses, hasError } = await this.processApiStream(stream);

			if (hasError) {
				return true;
			}

			// 添加助手响应到历史
			if (assistantMessage || toolUses.length > 0) {
				await this.addAssistantResponse(assistantMessage, toolUses);
			}

			// 没有工具调用
			if (toolUses.length === 0) {
				return false;
			}

			// 执行工具
			const { shouldContinue, shouldEndLoop } = await this.executeTools(toolUses);

			if (shouldEndLoop) {
				return true;
			}

			if (!shouldContinue) {
				return true;
			}

			// 工具执行成功，递归继续API循环（处理工具结果）
			return this.recursivelyMakeClineRequests(0);

		} catch (error) {
			console.error('[TaskService] API调用错误:', error);

			// API错误重试
			if (retryAttempt < 3) {
				const delay = Math.min(Math.pow(2, retryAttempt) * 1000, MAX_EXPONENTIAL_BACKOFF_SECONDS * 1000);
				await this.say('api_req_retry_delayed', `将在 ${delay / 1000} 秒后重试...`);
				await this.sleep(delay);
				return this.recursivelyMakeClineRequests(retryAttempt + 1);
			}

			// 询问用户是否重试
			const { response } = await this.ask('api_req_failed', formatResponse.apiRequestFailed(error instanceof Error ? error.message : String(error)));

			if (response === 'yesButtonClicked') {
				return this.recursivelyMakeClineRequests(0);
			}

			return true;
		}
	}

	/**
	 * 尝试API请求
	 */
	private async attemptApiRequest(retryAttempt: number): Promise<AsyncIterable<StreamChunk>> {
		const systemPrompt = this.getSystemPrompt();
		const toolDefinitions = this.getToolDefinitions();

		if (retryAttempt === 0) {
			await this.say('api_req_started', 'API请求已开始...');
		} else {
			await this.say('api_req_retried', `正在重试 API 请求 (尝试 ${retryAttempt + 1})...`);
		}

		return this.apiHandler.createMessage(systemPrompt, this.apiConversationHistory, toolDefinitions);
	}

	/**
	 * 处理API流式响应
	 */
	private async processApiStream(stream: AsyncIterable<StreamChunk>): Promise<{
		assistantMessage: string;
		toolUses: Array<{ id: string; name: string; input: any }>;
		hasError: boolean;
	}> {
		let assistantMessage = '';
		const toolUses: Array<{ id: string; name: string; input: any }> = [];
		let hasError = false;

		for await (const chunk of stream) {
			// 检查是否已中止，如果是则停止处理流
			if (this.abort) {
				console.log('[TaskService] 任务已中止，停止处理API流');
				hasError = true;
				break;
			}

			console.log('[TaskService] 收到chunk:', chunk.type); // 添加调试日志

			if (chunk.type === 'text') {
				assistantMessage += chunk.text;
				this._onStreamChunk.fire({ text: chunk.text, isPartial: true });
			} else if (chunk.type === 'tool_use') {
				let input: any;
				try {
					input = typeof chunk.input === 'string' ? JSON.parse(chunk.input) : chunk.input;
				} catch (e) {
					console.error('[TaskService] 工具参数解析失败:', chunk.input);
					input = {};
				}

				toolUses.push({ id: chunk.id, name: chunk.name, input });
			} else if (chunk.type === 'usage') {
				console.log('[TaskService] 收到usage chunk:', chunk); // 添加调试日志
				this.updateTokenUsage(chunk);
			} else if (chunk.type === 'error') {
				console.error('[TaskService] API错误:', chunk.error);
				hasError = true;
			}
		}

		if (!this.abort && (assistantMessage || toolUses.length > 0)) {
			this._onStreamChunk.fire({ text: undefined, isPartial: false });
			await this.say('api_req_finished', 'API请求已完成');
		}

		return { assistantMessage, toolUses, hasError };
	}

	/**
	 * 添加助手响应到历史
	 */
	private async addAssistantResponse(
		assistantMessage: string,
		toolUses: Array<{ id: string; name: string; input: any }>
	): Promise<void> {
		const content: ContentBlock[] = [];

		if (assistantMessage) {
			content.push({ type: 'text', text: assistantMessage });
		}

		for (const toolUse of toolUses) {
			content.push({
				type: 'tool_use',
				id: toolUse.id,
				name: toolUse.name,
				input: toolUse.input
			});
		}

		this.apiConversationHistory.push({
			role: 'assistant',
			content
		});
	}

	// ========== 工具执行 ==========

	/**
	 * 执行工具列表 - 带审批和attempt_completion处理
	 * 参照Kilocode实现：在执行危险工具前请求用户确认
	 */
	private async executeTools(toolUses: Array<{ id: string; name: string; input: any }>): Promise<{
		shouldContinue: boolean;
		shouldEndLoop: boolean;
	}> {
		const toolResults: ContentBlock[] = [];

		for (const toolUse of toolUses) {
			// 检查重复调用
			const repetitionCheck = this.toolRepetitionDetector.check({
				type: 'tool_use',
				name: toolUse.name as ToolName,
				params: toolUse.input,
				partial: false,
				toolUseId: toolUse.id
			});

			if (!repetitionCheck.allowExecution) {
				console.warn('[TaskService] 工具重复调用检测触发:', toolUse.name);
				this.consecutiveMistakeCount++;

				if (this.consecutiveMistakeCount >= this.consecutiveMistakeLimit) {
					const { response, text } = await this.ask('mistake_limit_reached', '已达到连续错误限制。请提供指导以继续。');

					if (response === 'messageResponse') {
						toolResults.push({
							type: 'tool_result',
							tool_use_id: toolUse.id,
							content: formatResponse.tooManyMistakes(text),
							is_error: false
						});
						this.consecutiveMistakeCount = 0;
					} else {
						this.abortTask(ClineApiReqCancelReason.ReachedMistakeLimit);
						return { shouldContinue: false, shouldEndLoop: true };
					}
				} else {
					toolResults.push({
						type: 'tool_result',
						tool_use_id: toolUse.id,
						content: repetitionCheck.askUser?.messageDetail || '工具重复调用',
						is_error: true
					});
				}
				continue;
			}

			// 处理attempt_completion
			if (toolUse.name === 'attempt_completion') {
				const result = await this.handleAttemptCompletion(toolUse);
				if (result.shouldEndLoop) {
					return result;
				}
				if (result.toolResult) {
					toolResults.push(result.toolResult);
				}
				continue;
			}

			// ========== 工具确认流程 - 参照Kilocode实现 ==========
			// 根据工具类型决定是否需要用户确认
			const needsApproval = this.toolNeedsApproval(toolUse.name);

			if (needsApproval) {
				const approvalResult = await this.requestToolApproval(toolUse);

				if (!approvalResult.approved) {
					// 用户拒绝了工具执行
					toolResults.push({
						type: 'tool_result',
						tool_use_id: toolUse.id,
						content: approvalResult.feedback
							? `用户拒绝了工具执行并提供了反馈: ${approvalResult.feedback}`
							: '用户拒绝了工具执行',
						is_error: true
					});
					continue;
				}
			}

			// 执行工具
			try {
				// 显示工具执行状态 - 让用户知道正在执行什么
				const toolStatusText = this.formatToolStatusForDisplay(toolUse);
				await this.say('tool', toolStatusText);

				const result = await this.toolExecutor.executeTool({
					type: 'tool_use',
					name: toolUse.name as ToolName,
					params: toolUse.input,
					partial: false,
					toolUseId: toolUse.id
				});

				// 处理ask_followup_question的用户输入
				if (typeof result === 'string' && result.startsWith('__USER_INPUT_REQUIRED__:')) {
					const payload = result.substring('__USER_INPUT_REQUIRED__:'.length);
					const { question } = JSON.parse(payload);

					const { response, text } = await this.ask('followup', question);

					if (response === 'messageResponse') {
						toolResults.push({
							type: 'tool_result',
							tool_use_id: toolUse.id,
							content: `用户回复: ${text}`,
							is_error: false
						});
					}
				} else {
					toolResults.push({
						type: 'tool_result',
						tool_use_id: toolUse.id,
						content: typeof result === 'string' ? result : JSON.stringify(result),
						is_error: false
					});
				}

				// 更新工具使用统计
				this.toolUsage[toolUse.name] = (this.toolUsage[toolUse.name] || 0) + 1;

				// 工具执行成功，重置错误计数
				this.consecutiveMistakeCount = 0;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.error('[TaskService] 工具执行失败:', toolUse.name, error);

				toolResults.push({
					type: 'tool_result',
					tool_use_id: toolUse.id,
					content: formatResponse.toolError(errorMsg),
					is_error: true
				});

				this.consecutiveMistakeCount++;
			}
		}

		// 添加工具结果到历史
		if (toolResults.length > 0) {
			this.apiConversationHistory.push({
				role: 'tool',
				content: toolResults
			});
		}

		return { shouldContinue: true, shouldEndLoop: false };
	}

	/**
	 * 检查工具是否需要用户确认
	 * 参照Kilocode：危险操作（文件修改、命令执行）需要确认
	 */
	private toolNeedsApproval(toolName: string): boolean {
		// 需要确认的工具列表
		const toolsRequiringApproval = [
			'write_to_file',      // 写入文件
			'apply_diff',         // 应用差异
			'edit_file',          // 编辑文件
			'insert_content',     // 插入内容
			'search_and_replace', // 搜索替换
			'execute_command'     // 执行命令
		];

		return toolsRequiringApproval.includes(toolName);
	}

	/**
	 * 请求工具执行确认 - 参照Kilocode实现
	 * 对于命令使用 ask('command')，对于其他工具使用 ask('tool')
	 */
	private async requestToolApproval(toolUse: { id: string; name: string; input: any }): Promise<{
		approved: boolean;
		feedback?: string;
	}> {
		// 构建工具描述信息
		const toolDescription = this.formatToolForApproval(toolUse);

		// 根据工具类型选择ask类型
		const askType = toolUse.name === 'execute_command' ? 'command' : 'tool';

		// 请求用户确认
		const { response, text } = await this.ask(askType, toolDescription);

		if (response === 'yesButtonClicked') {
			return { approved: true };
		} else if (response === 'messageResponse' && text) {
			// 用户提供了反馈，可能需要修改
			return { approved: false, feedback: text };
		} else {
			// 用户拒绝
			return { approved: false };
		}
	}

	/**
	 * 格式化工具信息用于确认显示
	 */
	private formatToolForApproval(toolUse: { id: string; name: string; input: any }): string {
		const toolName = toolUse.name;
		const params = toolUse.input;

		switch (toolName) {
			case 'write_to_file':
				return JSON.stringify({
					tool: 'newFileCreated',
					path: params.path,
					content: params.content?.substring(0, 500) + (params.content?.length > 500 ? '...' : '')
				});

			case 'apply_diff':
				return JSON.stringify({
					tool: 'appliedDiff',
					path: params.path,
					diff: params.diff
				});

			case 'edit_file':
				return JSON.stringify({
					tool: 'editedExistingFile',
					path: params.target_file,
					instructions: params.instructions,
					code_edit: params.code_edit?.substring(0, 500) + (params.code_edit?.length > 500 ? '...' : '')
				});

			case 'insert_content':
				return JSON.stringify({
					tool: 'insertContent',
					path: params.path,
					line: params.line,
					content: params.content?.substring(0, 500) + (params.content?.length > 500 ? '...' : '')
				});

			case 'search_and_replace': {
				// 将operations数组转换为新旧内容，用于diff显示
				const operations = params.operations || [];
				let originalContent = '';
				let newContent = '';
				for (const op of operations) {
					if (op.search && op.replace !== undefined) {
						originalContent += op.search + '\n\n';
						newContent += op.replace + '\n\n';
					}
				}
				return JSON.stringify({
					tool: 'searchAndReplace',
					path: params.path,
					originalContent: originalContent.trim(),
					newContent: newContent.trim(),
					operationCount: operations.length
				});
			}

			case 'execute_command':
				// 命令直接显示命令文本
				return params.command;

			default:
				return JSON.stringify({
					tool: toolName,
					params: params
				});
		}
	}

	/**
	 * 格式化工具状态用于UI显示
	 * 用于在聊天框中显示当前正在执行什么工具
	 */
	private formatToolStatusForDisplay(toolUse: { id: string; name: string; input: any }): string {
		const toolName = toolUse.name;
		const params = toolUse.input;

		switch (toolName) {
			case 'read_file':
				return JSON.stringify({
					tool: 'readFile',
					path: params.path
				});

			case 'list_files':
				return JSON.stringify({
					tool: 'listFiles',
					path: params.path,
					recursive: params.recursive || false
				});

			case 'search_files':
				return JSON.stringify({
					tool: 'searchFiles',
					path: params.path,
					regex: params.regex
				});

			case 'list_code_definition_names':
				return JSON.stringify({
					tool: 'listCodeDefinitionNames',
					path: params.path
				});

			case 'write_to_file':
				return JSON.stringify({
					tool: 'newFileCreated',
					path: params.path
				});

			case 'apply_diff':
				return JSON.stringify({
					tool: 'appliedDiff',
					path: params.path
				});

			case 'edit_file':
				return JSON.stringify({
					tool: 'editedExistingFile',
					path: params.target_file
				});

			case 'insert_content':
				return JSON.stringify({
					tool: 'insertContent',
					path: params.path,
					line: params.line
				});

			case 'execute_command':
				return JSON.stringify({
					tool: 'executeCommand',
					command: params.command?.substring(0, 100) + (params.command?.length > 100 ? '...' : '')
				});

			case 'ask_followup_question':
				return JSON.stringify({
					tool: 'askFollowupQuestion',
					question: params.question?.substring(0, 100) + (params.question?.length > 100 ? '...' : '')
				});

			case 'attempt_completion':
				return JSON.stringify({
					tool: 'attemptCompletion'
				});

			default:
				return JSON.stringify({
					tool: toolName,
					params: Object.keys(params || {})
				});
		}
	}

	/**
	 * 处理attempt_completion - 参照kilocode完整实现
	 */
	private async handleAttemptCompletion(toolUse: { id: string; name: string; input: any }): Promise<{
		shouldContinue: boolean;
		shouldEndLoop: boolean;
		toolResult?: ContentBlock;
	}> {
		const result = toolUse.input.result;

		if (!result) {
			const errorMsg = await this.sayAndCreateMissingParamError('attempt_completion', 'result');
			return {
				shouldContinue: true,
				shouldEndLoop: false,
				toolResult: {
					type: 'tool_result',
					tool_use_id: toolUse.id,
					content: errorMsg,
					is_error: true
				}
			};
		}

		// 显示完成结果
		await this.say('completion_result', result);

		// 对于问答模式，不需要用户确认，直接结束
		if (this.currentMode === 'ask') {
			console.log('[TaskService] 问答模式：跳过任务完成确认');
			return {
				shouldContinue: true,
				shouldEndLoop: true
			};
		}

		// 询问用户
		const { response, text, images } = await this.ask('completion_result', '');

		if (response === 'yesButtonClicked') {
			// 用户接受，任务完成
			return {
				shouldContinue: true,
				shouldEndLoop: true
			};
		}

		// 用户提供反馈，继续任务
		await this.say('user_feedback', text || '', images);

		return {
			shouldContinue: true,
			shouldEndLoop: false,
			toolResult: {
				type: 'tool_result',
				tool_use_id: toolUse.id,
				content: formatResponse.attemptCompletionFeedback(text || ''),
				is_error: false
			}
		};
	}

	// ========== 辅助方法 ==========

	/**
	 * 更新Token使用统计
	 */
	private updateTokenUsage(usageChunk: any): void {
		if (usageChunk.inputTokens) {
			this.tokenUsage.totalTokensIn += usageChunk.inputTokens;
		}
		if (usageChunk.outputTokens) {
			this.tokenUsage.totalTokensOut += usageChunk.outputTokens;
		}
		this._onTokenUsageUpdated.fire(this.tokenUsage);
	}

	/**
	 * 中止任务
	 */
	public abortTask(reason?: ClineApiReqCancelReason): void {
		this.abort = true;
		this.abortReason = reason;
		this.setStatus(TaskStatus.ABORTED);
		console.log('[TaskService] 任务已中止:', this.taskId, reason);
	}

	/**
	 * Sleep辅助函数
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * 获取消息历史
	 */
	public getMessageHistory(): MessageParam[] {
		return this.apiConversationHistory;
	}

	/**
	 * 获取Cline消息
	 */
	public getClineMessages(): ClineMessage[] {
		return this.clineMessages;
	}

	/**
	 * 获取Token使用
	 */
	public getTokenUsage(): TokenUsage {
		return { ...this.tokenUsage };
	}

	/**
	 * 获取工具使用
	 */
	public getToolUsage(): ToolUsage {
		return { ...this.toolUsage };
	}

	override dispose(): void {
		this.abort = true;
		super.dispose();
	}
}
