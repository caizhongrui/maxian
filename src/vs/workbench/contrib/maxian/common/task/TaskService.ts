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
import { AgentOrchestrator, TaskContext } from '../agents/index.js';
import { ToolResultCache } from '../tools/ToolResultCache.js';
import { ErrorHandler } from './ErrorHandler.js';
import { ContextCompactor, CompactableMessage } from '../context/contextCompaction.js';

const MAX_CONSECUTIVE_MISTAKES = 3; // 最大连续错误次数

// ========== 上下文管理常量 ==========
const MAX_CONTEXT_TOKENS = 100000; // 最大上下文 token 数
const TOKEN_BUFFER = 20000; // 预留给响应的 token
const MAX_TOOL_RESULT_LENGTH = 50000; // 工具结果最大字符数
const MAX_HISTORY_MESSAGES = 50; // 最大历史消息数
const TRUNCATE_FRACTION = 0.5; // 截断时移除的消息比例

/**
 * Agent 配置选项
 */
export interface AgentConfig {
	enableExploration: boolean;  // 是否启用探索阶段
	enablePlanning: boolean;     // 是否启用规划阶段
	autoExecute: boolean;        // 是否自动执行规划
	verbose: boolean;            // 是否输出详细日志
}

/**
 * 默认 Agent 配置
 */
const DEFAULT_AGENT_CONFIG: AgentConfig = {
	enableExploration: true,
	enablePlanning: true,
	autoExecute: true,
	verbose: true
};

/**
 * TaskService配置选项
 */
export interface TaskServiceOptions extends CreateTaskOptions {
	apiHandler: IApiHandler;
	toolExecutor: IToolExecutor;
	getSystemPrompt: () => Promise<string>;  // 修改为异步
	getToolDefinitions: () => ToolDefinition[];
	workspaceRoot?: string;
	consecutiveMistakeLimit?: number;
	currentMode?: string; // 当前模式，用于特殊处理（如ask模式）
	agentConfig?: Partial<AgentConfig>; // Agent 配置
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
	private readonly getSystemPrompt: () => Promise<string>;  // 修改为异步
	private readonly getToolDefinitions: () => ToolDefinition[];

	// Tool repetition detection
	private readonly toolRepetitionDetector: ToolRepetitionDetector;
	consecutiveMistakeCount: number = 0;
	private readonly consecutiveMistakeLimit: number;

	// Current mode (for special handling like ask mode)
	private readonly currentMode: string;

	// Agent 编排器
	private readonly agentOrchestrator: AgentOrchestrator;
	private readonly agentConfig: AgentConfig;
	private readonly workspaceRoot: string;
	private taskContext?: TaskContext;

	// 工具结果缓存
	private readonly toolCache: ToolResultCache;

	// 错误处理器
	private readonly errorHandler: ErrorHandler;

	// P0优化：上下文压缩器
	private readonly contextCompactor: ContextCompactor;

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
		this.workspaceRoot = options.workspaceRoot || '.';

		// 初始化 Agent 配置
		this.agentConfig = { ...DEFAULT_AGENT_CONFIG, ...options.agentConfig };

		// 初始化工具重复检测器
		this.toolRepetitionDetector = new ToolRepetitionDetector(this.consecutiveMistakeLimit);

		// 初始化工具结果缓存
		this.toolCache = new ToolResultCache();

		// 初始化错误处理器
		this.errorHandler = new ErrorHandler({
			maxRetries: 3,
			baseDelayMs: 1000,
			maxDelayMs: 60000,
			jitterFactor: 0.2
		});

		// P0优化：初始化上下文压缩器
		this.contextCompactor = new ContextCompactor(MAX_CONTEXT_TOKENS);

		// 初始化 Agent 编排器
		this.agentOrchestrator = new AgentOrchestrator(
			this.toolExecutor,
			this.workspaceRoot,
			{
				enableExploration: this.agentConfig.enableExploration,
				enablePlanning: this.agentConfig.enablePlanning,
				autoExecute: this.agentConfig.autoExecute,
				verbose: this.agentConfig.verbose
			},
			{
				// Agent 事件回调
				onPhaseChange: (phase, context) => {
					console.log(`[TaskService] Agent 阶段变更: ${phase}`);
				},
				onExplorationComplete: (result) => {
					console.log(`[TaskService] 探索完成: ${result.output}`);
				},
				onPlanningComplete: (result) => {
					console.log(`[TaskService] 规划完成: ${result.data?.steps?.length || 0} 个步骤`);
				}
			}
		);

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
			// 获取初始任务描述
			const initialTask = this.getInitialTaskDescription();

			// 对于非简单任务，执行探索-规划阶段
			if (initialTask && this.shouldPerformExplorationAndPlanning(initialTask)) {
				await this.performExplorationAndPlanning(initialTask);
			}

			// 执行主任务循环
			await this.initiateTaskLoop();
			this.setStatus(TaskStatus.COMPLETED);
		} catch (error) {
			console.error('[TaskService] 任务执行错误:', error);
			this.setStatus(TaskStatus.ERROR);
		}
	}

	/**
	 * 获取初始任务描述
	 */
	private getInitialTaskDescription(): string | undefined {
		if (this.apiConversationHistory.length > 0) {
			const firstMsg = this.apiConversationHistory[0];
			if (firstMsg.role === 'user') {
				return typeof firstMsg.content === 'string'
					? firstMsg.content
					: undefined;
			}
		}
		return undefined;
	}

	/**
	 * 判断是否需要执行探索和规划
	 * 对于简单任务（问答模式、简短任务）跳过
	 */
	private shouldPerformExplorationAndPlanning(task: string): boolean {
		// 问答模式不需要探索规划
		if (this.currentMode === 'ask') {
			return false;
		}

		// 使用 AgentOrchestrator 的判断逻辑
		const shouldExplore = this.agentOrchestrator.shouldExplore(task);
		const shouldPlan = this.agentOrchestrator.shouldPlan(task);

		return shouldExplore || shouldPlan;
	}

	/**
	 * 执行探索和规划阶段
	 * 注意：探索规划信息只输出到console，不显示给用户
	 */
	private async performExplorationAndPlanning(task: string): Promise<void> {
		console.log('[TaskService] 开始探索-规划阶段:', task);

		try {
			// 执行完整的探索-规划流程（静默执行，不显示给用户）
			this.taskContext = await this.agentOrchestrator.executeTask(task);

			// 仅输出日志，不显示给用户
			if (this.taskContext.explorationResult?.data) {
				const { relevantFiles, summary } = this.taskContext.explorationResult.data;
				console.log('[TaskService] 探索完成:', summary);
				console.log('[TaskService] 相关文件:', relevantFiles?.map(f => f.path).slice(0, 5).join(', ') || '无');
			}

			if (this.taskContext.planResult?.data) {
				const { steps, taskAnalysis } = this.taskContext.planResult.data;
				console.log('[TaskService] 规划完成:', taskAnalysis);
				console.log('[TaskService] 步骤:', steps?.map(s => `${s.id}. ${s.description}`).join(', ') || '无');
			}

			console.log('[TaskService] 探索-规划阶段完成');
		} catch (error) {
			console.error('[TaskService] 探索-规划阶段失败:', error);
			// 失败不阻断主流程，继续执行
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

			// 没有工具调用 - 这是AI的最终回复，显示给用户
			if (toolUses.length === 0) {
				if (assistantMessage) {
					// 显示AI的最终回复（不是工具调用前的"思考"文本）
					await this.say('text', assistantMessage);
				}
				return false;
			}
			// 有工具调用时，assistantMessage 是AI的"思考"文本，不显示给用户

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
			// 使用错误处理器分析错误
			const errorInfo = this.errorHandler.classifyError(error);
			console.error(`[TaskService] API调用错误 [${errorInfo.type}]:`, error);

			// 判断是否应该自动重试
			if (this.errorHandler.shouldRetry(error, retryAttempt)) {
				const delay = this.errorHandler.calculateRetryDelay(retryAttempt);
				const userMessage = `${errorInfo.userMessage}，将在 ${Math.round(delay / 1000)} 秒后重试...`;
				await this.say('api_req_retry_delayed', userMessage);
				await this.sleep(delay);
				return this.recursivelyMakeClineRequests(retryAttempt + 1);
			}

			// 不可重试的错误或超过重试次数，询问用户
			const userFriendlyMessage = this.errorHandler.getUserFriendlyMessage(error);
			const { response } = await this.ask('api_req_failed', userFriendlyMessage);

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
		// 在发送请求前截断历史以控制 token 消耗
		this.truncateHistoryIfNeeded();

		// 获取基础系统提示词
		let systemPrompt = await this.getSystemPrompt();

		// 如果有探索和规划结果，增强系统提示词
		if (this.taskContext) {
			systemPrompt = this.agentOrchestrator.generateEnhancedPrompt(systemPrompt, this.taskContext);
		}

		const toolDefinitions = this.getToolDefinitions();

		// 记录当前上下文大小
		const estimatedTokens = this.estimateTokens(this.apiConversationHistory);
		console.log(`[TaskService] API请求: 历史消息=${this.apiConversationHistory.length}, 估算tokens=${estimatedTokens}`);

		if (retryAttempt === 0) {
			await this.say('api_req_started', 'API请求已开始...');
		} else {
			await this.say('api_req_retried', `正在重试 API 请求 (尝试 ${retryAttempt + 1})...`);
		}

		return this.apiHandler.createMessage(systemPrompt, this.apiConversationHistory, toolDefinitions);
	}

	/**
	 * 处理API流式响应
	 * 注意：文本不在流处理时显示，而是在流结束后根据是否有工具调用来决定是否显示
	 * 这样可以避免AI的"思考"文本（工具调用前的推理）被显示给用户
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
				// 仅累积文本，不立即显示
				// 原因：此时不知道后面是否有工具调用
				// 如果有工具调用，这段文本是AI的"思考"，不应显示给用户
				// 如果没有工具调用，这是最终答案，应该显示
				assistantMessage += chunk.text;
				// 注释掉实时流显示，改为在流结束后根据情况决定是否显示
				// this._onStreamChunk.fire({ text: chunk.text, isPartial: true });
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
	 * 只读工具列表（可以并行执行）
	 */
	private readonly READ_ONLY_TOOLS = new Set([
		'read_file',
		'list_files',
		'search_files',
		'list_code_definition_names',
		'codebase_search',
		'glob'
	]);

	/**
	 * 判断工具是否为只读工具
	 */
	private isReadOnlyTool(toolName: string): boolean {
		return this.READ_ONLY_TOOLS.has(toolName);
	}

	/**
	 * 执行工具列表 - 带审批和attempt_completion处理
	 * 优化：只读工具并行执行，写入工具顺序执行
	 */
	private async executeTools(toolUses: Array<{ id: string; name: string; input: any }>): Promise<{
		shouldContinue: boolean;
		shouldEndLoop: boolean;
	}> {
		const toolResults: ContentBlock[] = [];

		// 分离只读工具和写入工具
		const readOnlyTools: Array<{ id: string; name: string; input: any }> = [];
		const writeTools: Array<{ id: string; name: string; input: any }> = [];
		const specialTools: Array<{ id: string; name: string; input: any }> = []; // attempt_completion, ask_followup_question

		for (const toolUse of toolUses) {
			if (toolUse.name === 'attempt_completion' || toolUse.name === 'ask_followup_question') {
				specialTools.push(toolUse);
			} else if (this.isReadOnlyTool(toolUse.name)) {
				readOnlyTools.push(toolUse);
			} else {
				writeTools.push(toolUse);
			}
		}

		// 1. 并行执行只读工具
		if (readOnlyTools.length > 0) {
			console.log(`[TaskService] 并行执行 ${readOnlyTools.length} 个只读工具`);
			const readResults = await this.executeToolsInParallel(readOnlyTools);
			toolResults.push(...readResults);
		}

		// 2. 顺序执行写入工具（需要用户确认）
		for (const toolUse of writeTools) {
			const result = await this.executeSingleTool(toolUse);
			if (result.shouldEndLoop) {
				// 添加已收集的结果
				if (toolResults.length > 0) {
					this.apiConversationHistory.push({ role: 'tool', content: toolResults });
				}
				return result;
			}
			if (result.toolResult) {
				toolResults.push(result.toolResult);
			}
		}

		// 3. 顺序执行特殊工具（attempt_completion, ask_followup_question）
		for (const toolUse of specialTools) {
			if (toolUse.name === 'attempt_completion') {
				const result = await this.handleAttemptCompletion(toolUse);
				if (result.shouldEndLoop) {
					// 添加已收集的结果
					if (toolResults.length > 0) {
						this.apiConversationHistory.push({ role: 'tool', content: toolResults });
					}
					return result;
				}
				if (result.toolResult) {
					toolResults.push(result.toolResult);
				}
			} else if (toolUse.name === 'ask_followup_question') {
				const result = await this.executeSingleTool(toolUse);
				if (result.toolResult) {
					toolResults.push(result.toolResult);
				}
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
	 * 并行执行只读工具（带缓存）
	 */
	private async executeToolsInParallel(toolUses: Array<{ id: string; name: string; input: any }>): Promise<ContentBlock[]> {
		const promises = toolUses.map(async (toolUse) => {
			try {
				// 显示工具执行状态
				const toolStatusText = this.formatToolStatusForDisplay(toolUse);
				await this.say('tool', toolStatusText);

				// 检查缓存
				const cachedResult = this.toolCache.get(toolUse.name, toolUse.input);
				if (cachedResult !== null) {
					console.log(`[TaskService] 使用缓存结果: ${toolUse.name}`);
					return {
						type: 'tool_result' as const,
						tool_use_id: toolUse.id,
						content: cachedResult,
						is_error: false
					};
				}

				const result = await this.toolExecutor.executeTool({
					type: 'tool_use',
					name: toolUse.name as ToolName,
					params: toolUse.input,
					partial: false,
					toolUseId: toolUse.id
				});

				// 截断大工具结果
				const resultContent = typeof result === 'string' ? result : JSON.stringify(result);
				const truncatedContent = this.truncateToolResult(resultContent);

				// 设置缓存
				this.toolCache.set(toolUse.name, toolUse.input, truncatedContent);

				// 更新工具使用统计
				this.toolUsage[toolUse.name] = (this.toolUsage[toolUse.name] || 0) + 1;

				return {
					type: 'tool_result' as const,
					tool_use_id: toolUse.id,
					content: truncatedContent,
					is_error: false
				};
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.error('[TaskService] 并行工具执行失败:', toolUse.name, error);

				return {
					type: 'tool_result' as const,
					tool_use_id: toolUse.id,
					content: formatResponse.toolError(errorMsg),
					is_error: true
				};
			}
		});

		return Promise.all(promises);
	}

	/**
	 * 执行单个工具（带确认流程）
	 */
	private async executeSingleTool(toolUse: { id: string; name: string; input: any }): Promise<{
		shouldContinue: boolean;
		shouldEndLoop: boolean;
		toolResult?: ContentBlock;
	}> {
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
					this.consecutiveMistakeCount = 0;
					return {
						shouldContinue: true,
						shouldEndLoop: false,
						toolResult: {
							type: 'tool_result',
							tool_use_id: toolUse.id,
							content: formatResponse.tooManyMistakes(text),
							is_error: false
						}
					};
				} else {
					this.abortTask(ClineApiReqCancelReason.ReachedMistakeLimit);
					return { shouldContinue: false, shouldEndLoop: true };
				}
			}

			return {
				shouldContinue: true,
				shouldEndLoop: false,
				toolResult: {
					type: 'tool_result',
					tool_use_id: toolUse.id,
					content: repetitionCheck.askUser?.messageDetail || '工具重复调用',
					is_error: true
				}
			};
		}

		// 检查是否需要用户确认
		const needsApproval = this.toolNeedsApproval(toolUse.name);

		if (needsApproval) {
			const approvalResult = await this.requestToolApproval(toolUse);

			if (!approvalResult.approved) {
				return {
					shouldContinue: true,
					shouldEndLoop: false,
					toolResult: {
						type: 'tool_result',
						tool_use_id: toolUse.id,
						content: approvalResult.feedback
							? `用户拒绝了工具执行并提供了反馈: ${approvalResult.feedback}`
							: '用户拒绝了工具执行',
						is_error: true
					}
				};
			}
		}

		// 执行工具
		try {
			const toolStatusText = this.formatToolStatusForDisplay(toolUse);
			await this.say('tool', toolStatusText);

			const result = await this.toolExecutor.executeTool({
				type: 'tool_use',
				name: toolUse.name as ToolName,
				params: toolUse.input,
				partial: false,
				toolUseId: toolUse.id
			});

			// 处理 ask_followup_question 的用户输入
			if (typeof result === 'string' && result.startsWith('__USER_INPUT_REQUIRED__:')) {
				const payload = result.substring('__USER_INPUT_REQUIRED__:'.length);
				const { question } = JSON.parse(payload);

				const { response, text } = await this.ask('followup', question);

				if (response === 'messageResponse') {
					return {
						shouldContinue: true,
						shouldEndLoop: false,
						toolResult: {
							type: 'tool_result',
							tool_use_id: toolUse.id,
							content: `用户回复: ${text}`,
							is_error: false
						}
					};
				}
			}

			// 截断大工具结果
			const resultContent = typeof result === 'string' ? result : JSON.stringify(result);
			const truncatedContent = this.truncateToolResult(resultContent);

			// 写入工具执行成功后，使相关缓存失效
			this.invalidateCacheForWriteTool(toolUse);

			// 更新工具使用统计
			this.toolUsage[toolUse.name] = (this.toolUsage[toolUse.name] || 0) + 1;
			this.consecutiveMistakeCount = 0;

			return {
				shouldContinue: true,
				shouldEndLoop: false,
				toolResult: {
					type: 'tool_result',
					tool_use_id: toolUse.id,
					content: truncatedContent,
					is_error: false
				}
			};
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error('[TaskService] 工具执行失败:', toolUse.name, error);
			this.consecutiveMistakeCount++;

			return {
				shouldContinue: true,
				shouldEndLoop: false,
				toolResult: {
					type: 'tool_result',
					tool_use_id: toolUse.id,
					content: formatResponse.toolError(errorMsg),
					is_error: true
				}
			};
		}
	}

	/**
	 * 写入工具执行后使相关缓存失效
	 */
	private invalidateCacheForWriteTool(toolUse: { id: string; name: string; input: any }): void {
		const params = toolUse.input;
		const filePath = params.path || params.target_file;

		if (filePath) {
			this.toolCache.invalidateFile(filePath);

			// 如果是目录相关操作，也使目录缓存失效
			const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
			if (dirPath) {
				this.toolCache.invalidateDirectory(dirPath);
			}
		}
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

	/**
	 * 获取当前任务上下文（探索和规划结果）
	 */
	public getTaskContext(): TaskContext | undefined {
		return this.taskContext;
	}

	/**
	 * 获取 Agent 配置
	 */
	public getAgentConfig(): AgentConfig {
		return { ...this.agentConfig };
	}

	/**
	 * 获取 Agent 编排器
	 * 用于外部访问探索和规划功能
	 */
	public getAgentOrchestrator(): AgentOrchestrator {
		return this.agentOrchestrator;
	}

	// ========== 上下文管理方法 ==========

	/**
	 * 估算消息的 token 数量
	 * 简单估算：中文约2字符/token，英文约4字符/token，取平均3字符/token
	 */
	private estimateTokens(messages: MessageParam[]): number {
		let totalChars = 0;
		for (const msg of messages) {
			if (typeof msg.content === 'string') {
				totalChars += msg.content.length;
			} else if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === 'text') {
						totalChars += block.text.length;
					} else if (block.type === 'tool_result') {
						totalChars += block.content.length;
					} else if (block.type === 'tool_use') {
						totalChars += JSON.stringify(block.input).length;
					}
				}
			}
		}
		return Math.ceil(totalChars / 3);
	}

	/**
	 * P0优化：截断对话历史以控制 token 数量
	 * 增强策略：
	 * 1. 使用 ContextCompactor 自动检测和修剪
	 * 2. 如果仍然超限，再截断消息
	 */
	private truncateHistoryIfNeeded(): void {
		const currentTokens = this.estimateTokens(this.apiConversationHistory);
		const allowedTokens = MAX_CONTEXT_TOKENS - TOKEN_BUFFER;

		// 检查是否需要截断（token超限或消息数超限）
		if (currentTokens <= allowedTokens && this.apiConversationHistory.length <= MAX_HISTORY_MESSAGES) {
			return;
		}

		console.log(`[TaskService] 上下文需要优化: tokens=${currentTokens}, messages=${this.apiConversationHistory.length}`);

		// P0-3: 使用 ContextCompactor 自动修剪工具输出
		const compactResult = this.contextCompactor.updateMessages(this.apiConversationHistory as CompactableMessage[]);
		if (compactResult.needsPrune) {
			this.apiConversationHistory = compactResult.messages;
			const newTokens = this.estimateTokens(this.apiConversationHistory);
			const stats = this.contextCompactor.getStats();
			console.log(`[TaskService] ContextCompactor 修剪完成: 修剪了 ${stats.compactedParts} 个工具输出, 节省 ${stats.savedTokens} tokens, 当前 ${newTokens} tokens`);

			// 如果修剪后仍在限制内，直接返回
			if (newTokens <= allowedTokens) {
				return;
			}
		}

		// 仍然超限，执行消息截断
		console.log(`[TaskService] ContextCompactor 处理后仍超限，执行消息截断`);

		// 保留第一条消息（任务描述）
		const firstMessage = this.apiConversationHistory[0];
		const remainingMessages = this.apiConversationHistory.slice(1);

		// 计算需要移除的消息数量
		const rawMessagesToRemove = Math.floor(remainingMessages.length * TRUNCATE_FRACTION);
		// 确保移除偶数个消息（保持user/assistant配对）
		const messagesToRemove = rawMessagesToRemove - (rawMessagesToRemove % 2);

		if (messagesToRemove > 0) {
			const keptMessages = remainingMessages.slice(messagesToRemove);
			this.apiConversationHistory = [firstMessage, ...keptMessages];

			console.log(`[TaskService] 截断完成: 移除了 ${messagesToRemove} 条消息, 剩余 ${this.apiConversationHistory.length} 条`);
		}
	}

	/**
	 * 截断工具结果内容
	 * 对于大文件内容进行截断，保留开头和结尾
	 */
	private truncateToolResult(content: string): string {
		if (content.length <= MAX_TOOL_RESULT_LENGTH) {
			return content;
		}

		const halfLength = Math.floor(MAX_TOOL_RESULT_LENGTH / 2);
		const head = content.substring(0, halfLength);
		const tail = content.substring(content.length - halfLength);

		const truncatedLines = content.length - MAX_TOOL_RESULT_LENGTH;
		const truncateMsg = `\n\n... [内容已截断，省略了约 ${Math.ceil(truncatedLines / 100)} 行] ...\n\n`;

		return head + truncateMsg + tail;
	}

	override dispose(): void {
		this.abort = true;
		super.dispose();
	}
}
