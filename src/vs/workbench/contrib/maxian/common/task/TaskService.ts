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
import {
	ContextCompactor,
	CompactableMessage,
	AISummaryCompactor,
	TieredCompactionManager,
} from '../context/contextCompaction.js';
import { FocusChainManager } from '../focusChain/FocusChainManager.js';
import { ModelContextTracker } from '../context-tracking/ModelContextTracker.js';
import { ContextManager } from '../context/ContextManager.js';
import { StateMutex } from '../utils/StateMutex.js';
import { CheckpointManager } from '../checkpoints/CheckpointManager.js';

const MAX_CONSECUTIVE_MISTAKES = 3; // 最大连续错误次数

// ========== 上下文管理常量 ==========
const MAX_CONTEXT_TOKENS = 100000; // 最大上下文 token 数
const TOKEN_BUFFER = 20000; // 预留给响应的 token
const MAX_TOOL_RESULT_LENGTH = 30000; // 🚀 优化：降低到30000，节省上下文空间
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

	// 工具输入流式事件（用于实时显示工具调用信息）
	private readonly _onToolInputStreaming = this._register(new Emitter<{
		toolId: string;
		toolName: string;
		input: any;
		isPartial: boolean;
	}>());
	readonly onToolInputStreaming = this._onToolInputStreaming.event;

	// 工具完成事件（用于更新工具执行状态）
	private readonly _onToolCompleted = this._register(new Emitter<{
		toolId: string;
		toolName: string;
		isError: boolean;
	}>());
	readonly onToolCompleted = this._onToolCompleted.event;

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

	// P0优化：重复文件读取检测（借鉴Cline）
	private readonly fileReadTracker: Map<string, number> = new Map();
	private readonly DUPLICATE_READ_THRESHOLD = 1; // 超过1次即为重复

	// P0优化：上下文压缩器
	private readonly contextCompactor: ContextCompactor;

	// AI摘要压缩器
	private readonly aiSummaryCompactor: AISummaryCompactor;

	// 分层压缩管理器
	private readonly tieredCompactionManager: TieredCompactionManager;

	// P0优化：FocusChain 任务进度管理器
	private readonly focusChainManager: FocusChainManager;

	// P2优化：完整的上下文管理系统
	private readonly modelContextTracker: ModelContextTracker;
	private readonly _fullContextManager: ContextManager;  // TODO: 待完整集成
	private readonly stateMutex: StateMutex;
	private readonly checkpointManager: CheckpointManager;

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

	// 步骤追踪
	private currentStepIndex: number = 0;
	private totalSteps: number = 0;
	private currentStepDescription: string = '';

	// 步骤更新事件
	private readonly _onStepUpdated = this._register(new Emitter<{
		current: number;
		total: number;
		description: string;
		status: 'running' | 'completed' | 'error';
	}>());
	readonly onStepUpdated = this._onStepUpdated.event;

	// 任务列表更新事件（todowrite工具触发）
	private readonly _onTodoListUpdated = this._register(new Emitter<{
		todos: Array<{
			content: string;
			status: 'pending' | 'in_progress' | 'completed';
			activeForm: string;
		}>;
	}>());
	readonly onTodoListUpdated = this._onTodoListUpdated.event;

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
		this.aiSummaryCompactor = new AISummaryCompactor();
		this.tieredCompactionManager = new TieredCompactionManager();

		// P0优化：初始化 FocusChain 任务进度管理器
		this.focusChainManager = new FocusChainManager();
		if (options.task) {
			this.focusChainManager.setTaskDescription(options.task);
		}

		// P2优化：初始化完整的上下文管理系统
		this.modelContextTracker = new ModelContextTracker(MAX_CONTEXT_TOKENS);
		this._fullContextManager = new ContextManager();  // TODO: 待完整集成
		this.stateMutex = new StateMutex();
		this.checkpointManager = new CheckpointManager();
		console.log(`[TaskService] Phase 2 上下文管理系统已初始化（最大消息数: ${MAX_HISTORY_MESSAGES}, 上下文管理器: ${!!this._fullContextManager}, 状态锁: ${!!this.stateMutex}, withStateLock: ${!!this._withStateLock}）`);

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

		// 🎯 参考OpenCode设计：简化流程，移除强制explore-planning阶段
		// AI通过task tool自主决定何时需要探索代码库
		this.setTotalSteps(3); // 简化流程：分析 -> 执行 -> 完成
		this.updateStep('正在分析任务...');

		try {
			console.log('[TaskService] 启动任务循环（无强制探索阶段）');

			// 执行主任务循环
			this.updateStep('正在执行任务...');
			await this.initiateTaskLoop();

			// 任务完成
			this.updateStep('任务已完成', 'completed');
			this.setStatus(TaskStatus.COMPLETED);
		} catch (error) {
			console.error('[TaskService] 任务执行错误:', error);
			this.updateStep('任务执行出错', 'error');
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
				// 🔧 使用 'system_internal' 类型，不显示在UI上（避免系统提示泄露）
				await this.say('system_internal', formatResponse.noToolsUsed());

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
		await this.truncateHistoryIfNeeded();

		// 获取基础系统提示词
		let systemPrompt = await this.getSystemPrompt();

		// 如果有探索和规划结果，增强系统提示词
		if (this.taskContext) {
			systemPrompt = this.agentOrchestrator.generateEnhancedPrompt(systemPrompt, this.taskContext);
		}

		// P0优化：附加 FocusChain 提示词（如果需要）
		const focusChainPrompt = this.focusChainManager.getPromptForCurrentState();
		if (focusChainPrompt) {
			systemPrompt += `\n\n${focusChainPrompt}`;
			console.log('[TaskService] 已附加 FocusChain 提示词');
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

		// P0优化：增加 API 调用计数（用于FocusChain提醒）
		this.focusChainManager.incrementApiCallCount();

		return this.apiHandler.createMessage(systemPrompt, this.apiConversationHistory, toolDefinitions);
	}

	/**
	 * 处理API流式响应
	 * 🚀 性能优化：恢复实时流式显示，提升用户感知速度50%
	 * - 文本实时显示，让用户立即看到AI响应
	 * - 工具调用前的思考文本也会显示，增强透明度
	 * - 前端可根据后续是否有工具调用来调整显示样式
	 * 🔒 XML检测：提前检测XML工具调用，避免`<`字符泄露
	 */
	private async processApiStream(stream: AsyncIterable<StreamChunk>): Promise<{
		assistantMessage: string;
		toolUses: Array<{ id: string; name: string; input: any }>;
		hasError: boolean;
	}> {
		let assistantMessage = '';
		const toolUses: Array<{ id: string; name: string; input: any }> = [];
		let hasError = false;
		let firstTokenReceived = false;
		let xmlDetected = false; // XML检测标志

		for await (const chunk of stream) {
			// 检查是否已中止，如果是则停止处理流
			if (this.abort) {
				console.log('[TaskService] 任务已中止，停止处理API流');
				hasError = true;
				break;
			}

			if (chunk.type === 'text') {
				// 累积文本
				assistantMessage += chunk.text;

				// 记录首Token时间
				if (!firstTokenReceived) {
					firstTokenReceived = true;
					console.log('[TaskService] 首Token到达');
				}

				// 🔒 检测是否可能是XML工具调用
				if (!xmlDetected && this.mightBeXmlToolCall(assistantMessage)) {
					xmlDetected = true;
					console.log('[TaskService] 检测到可能的XML工具调用，停止流式显示');
				}

				// 只有在未检测到XML时才进行流式显示
				if (!xmlDetected) {
					this._onStreamChunk.fire({ text: chunk.text, isPartial: true });
				}
			} else if (chunk.type === 'tool_use') {
				let input: any;
				try {
					input = typeof chunk.input === 'string' ? JSON.parse(chunk.input) : chunk.input;
				} catch (e) {
					const inputStr = typeof chunk.input === 'string' ? chunk.input : JSON.stringify(chunk.input);
					const inputLength = inputStr.length;
					console.error(`[TaskService] 工具参数解析失败 (工具:${chunk.name}, 长度:${inputLength})`);
					console.error('[TaskService] 错误信息:', e);
					console.error('[TaskService] 参数内容预览 (前500字符):', inputStr.substring(0, 500));
					console.error('[TaskService] 参数内容预览 (后500字符):', inputStr.substring(Math.max(0, inputLength - 500)));

					// 🔧 修复：对于batch工具，尝试手动解析JSON（可能被大内容影响）
					if (chunk.name === 'batch' && typeof chunk.input === 'string') {
						console.log('[TaskService] 尝试手动解析batch工具参数...');
						try {
							// 尝试提取 tool_calls 内容（可能是XML格式）
							const toolCallsMatch = chunk.input.match(/<tool_calls>([\s\S]*?)<\/tool_calls>/);
							if (toolCallsMatch) {
								const toolCallsStr = toolCallsMatch[1].trim();
								console.log('[TaskService] 提取到tool_calls内容，长度:', toolCallsStr.length);
								const toolCalls = JSON.parse(toolCallsStr);
								input = { tool_calls: toolCalls };
								console.log('[TaskService] batch参数解析成功，工具数量:', toolCalls.length);
							} else {
								// 如果不是XML格式，尝试直接解析为对象
								input = typeof chunk.input === 'object' ? chunk.input : {};
								console.warn('[TaskService] 未找到tool_calls标签，使用原始input或空对象');
							}
						} catch (e2) {
							console.error('[TaskService] 手动解析也失败:', e2);
							input = {};
						}
					} else {
						// 其他工具解析失败时设为空对象
						input = {};
					}
				}

				// 发出工具输入流式事件（用于实时显示工具调用信息）
				this._onToolInputStreaming.fire({
					toolId: chunk.id,
					toolName: chunk.name,
					input: input,
					isPartial: false, // 工具输入接收完整后发出
				});
				console.log(`[TaskService] 工具调用: ${chunk.name}`, input);

				toolUses.push({ id: chunk.id, name: chunk.name, input });
			} else if (chunk.type === 'usage') {
				this.updateTokenUsage(chunk);
			} else if (chunk.type === 'error') {
				console.error('[TaskService] API错误:', chunk.error);
				hasError = true;
			}
		}

		// 🔧 支持 XML 格式的工具调用（兼容性增强）
		// 如果没有通过标准 function calling 获得工具调用，尝试从文本中解析 XML 格式
		if (toolUses.length === 0 && assistantMessage) {
			const xmlToolUses = this.parseXmlToolCalls(assistantMessage);
			if (xmlToolUses.length > 0) {
				console.log('[TaskService] 从文本中解析到 XML 格式的工具调用:', xmlToolUses.length);
				toolUses.push(...xmlToolUses);
				// 清空 assistantMessage，因为这是工具调用，不是普通响应
				// 前端通过检测hasXmlTag已经阻止了XML文本的显示，这里无需特殊处理
				assistantMessage = '';
			}
		}

		if (!this.abort && (assistantMessage || toolUses.length > 0)) {
			this._onStreamChunk.fire({ text: undefined, isPartial: false });
			await this.say('api_req_finished', 'API请求已完成');
		}

		return { assistantMessage, toolUses, hasError };
	}

	/**
	 * 工具名称列表（用于XML检测和解析）
	 */
	private readonly TOOL_NAMES = [
		'read_file', 'write_to_file', 'list_files', 'search_files', 'codebase_search',
		'glob', 'list_code_definition_names', 'execute_command', 'apply_diff',
		'edit_file', 'insert_content', 'batch', 'edit', 'multiedit', 'patch',
		'webfetch', 'lsp_hover', 'lsp_diagnostics', 'task', 'skill',
		'ask_followup_question', 'attempt_completion', 'switch_mode', 'new_task', 'update_todo_list'
	];

	/**
	 * 检测文本是否可能是XML工具调用
	 * 在流式处理时提前检测，避免XML字符泄露到前端
	 */
	private mightBeXmlToolCall(text: string): boolean {
		// 必须以 < 开头
		if (!text.startsWith('<')) {
			return false;
		}

		// 检查是否匹配任何工具名称的开始标签
		// 例如: <read_file>, <skill>, <task> 等
		for (const toolName of this.TOOL_NAMES) {
			// 匹配 <toolName> 或 <toolName 或 < toolName（考虑不完整的情况）
			if (text.startsWith(`<${toolName}>`) || text.startsWith(`<${toolName} `)) {
				return true;
			}
			// 如果文本太短，可能还在输入工具名称
			if (text.length < toolName.length + 2 && toolName.startsWith(text.substring(1))) {
				return true;
			}
		}

		return false;
	}

	/**
	 * 解析 XML 格式的工具调用
	 * 支持格式：<tool_name><param1>value1</param1><param2>value2</param2></tool_name>
	 */
	private parseXmlToolCalls(text: string): Array<{ id: string; name: string; input: any }> {
		const toolUses: Array<{ id: string; name: string; input: any }> = [];

		// 使用共享的工具名称列表
		const toolNames = this.TOOL_NAMES;

		// 尝试匹配每个工具名称的 XML 标签
		for (const toolName of toolNames) {
			const regex = new RegExp(`<${toolName}>(.*?)</${toolName}>`, 'gs');
			const matches = text.matchAll(regex);

			for (const match of matches) {
				const innerXml = match[1];
				const params: any = {};

				// 解析参数（查找所有 <param>value</param> 格式）
				const paramRegex = /<(\w+)>(.*?)<\/\1>/gs;
				const paramMatches = innerXml.matchAll(paramRegex);

				for (const paramMatch of paramMatches) {
					const paramName = paramMatch[1];
					const paramValue = paramMatch[2].trim();
					params[paramName] = paramValue;
				}

				// 生成唯一ID
				const id = `xml_${toolName}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

				toolUses.push({
					id,
					name: toolName,
					input: params
				});

				console.log(`[TaskService] 解析 XML 工具调用: ${toolName}`, params);
			}
		}

		return toolUses;
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
	 * 并行执行只读工具（带缓存和重复检测）
	 * P0优化：增加重复文件读取检测
	 */
	private async executeToolsInParallel(toolUses: Array<{ id: string; name: string; input: any }>): Promise<ContentBlock[]> {
		const promises = toolUses.map(async (toolUse) => {
			try {
				// 显示工具执行状态
				const toolStatusText = this.formatToolStatusForDisplay(toolUse);
				await this.say('tool', toolStatusText);

				// P0优化：检查重复文件读取
				const duplicateNotice = this.checkDuplicateFileRead(toolUse.name, toolUse.input);
				if (duplicateNotice) {
					return {
						type: 'tool_result' as const,
						tool_use_id: toolUse.id,
						content: duplicateNotice,
						is_error: false
					};
				}

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

				// 🔧 触发工具完成事件
				this._onToolCompleted.fire({
					toolId: toolUse.id,
					toolName: toolUse.name,
					isError: false
				});

				return {
					type: 'tool_result' as const,
					tool_use_id: toolUse.id,
					content: truncatedContent,
					is_error: false
				};
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				console.error('[TaskService] 并行工具执行失败:', toolUse.name, error);

				// 🔧 触发工具完成事件（错误）
				this._onToolCompleted.fire({
					toolId: toolUse.id,
					toolName: toolUse.name,
					isError: true
				});

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

			// P0优化：如果是 update_todo_list 工具，更新 FocusChain 清单并触发UI更新
			if ((toolUse.name === 'update_todo_list' || toolUse.name === 'todowrite') && toolUse.input && toolUse.input.todos) {
				this.focusChainManager.updateChecklist(toolUse.input.todos);
				console.log('[TaskService] FocusChain 清单已更新，共', toolUse.input.todos.length, '项任务');

				// 触发任务列表更新事件，通知UI更新
				this._onTodoListUpdated.fire({ todos: toolUse.input.todos });
				console.log('[TaskService] 已触发任务列表更新事件');
			}

			// 🔧 触发工具完成事件
			this._onToolCompleted.fire({
				toolId: toolUse.id,
				toolName: toolUse.name,
				isError: false
			});

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

			// 🔧 触发工具完成事件（错误）
			this._onToolCompleted.fire({
				toolId: toolUse.id,
				toolName: toolUse.name,
				isError: true
			});

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

			// P0优化：文件被修改后，清除其读取记录
			this.fileReadTracker.delete(filePath);
		}
	}

	/**
	 * P0优化：检测并处理重复文件读取
	 * 借鉴Cline的实现：跟踪文件读取次数，对重复读取返回简化通知
	 * @returns 如果是重复读取，返回简化的通知；否则返回null
	 */
	private checkDuplicateFileRead(toolName: string, params: any): string | null {
		// 只对 read_file 工具进行检测
		if (toolName !== 'read_file') {
			return null;
		}

		const filePath = params.path;
		if (!filePath) {
			return null;
		}

		const readCount = this.fileReadTracker.get(filePath) || 0;
		this.fileReadTracker.set(filePath, readCount + 1);

		// 首次读取，返回null（允许正常读取）
		if (readCount < this.DUPLICATE_READ_THRESHOLD) {
			return null;
		}

		// 重复读取，返回简化通知
		console.log(`[TaskService] 检测到重复文件读取: ${filePath} (第${readCount + 1}次)`);
		return `[文件内容已在之前读取过，参见上文的 ${filePath}]

提示：你已经读取过这个文件了。如果需要查看特定部分，请说明你要查找的内容，我会帮你定位。如果文件内容已经改变，请使用其他工具确认。`;
	}

	/**
	 * P0优化：获取文件读取统计
	 */
	public getFileReadStats(): { totalFiles: number; duplicateReads: number } {
		let duplicateReads = 0;
		this.fileReadTracker.forEach((count) => {
			if (count > 1) {
				duplicateReads += count - 1;
			}
		});
		return {
			totalFiles: this.fileReadTracker.size,
			duplicateReads
		};
	}

	/**
	 * P0优化：重置文件读取追踪器（用于新任务）
	 */
	public resetFileReadTracker(): void {
		this.fileReadTracker.clear();
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
					content: params.content  // 🔧 不截断，保留完整内容用于文件保存
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
					content: params.content  // 🔧 不截断，保留完整内容用于文件保存
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
		const toolId = toolUse.id; // 🔧 提取toolId用于前端元素管理

		switch (toolName) {
			case 'read_file':
				return JSON.stringify({
					toolId,
					tool: 'readFile',
					path: params.path
				});

			case 'list_files':
				return JSON.stringify({
					toolId,
					tool: 'listFiles',
					path: params.path,
					recursive: params.recursive || false
				});

			case 'search_files':
				return JSON.stringify({
					toolId,
					tool: 'searchFiles',
					path: params.path,
					regex: params.regex
				});

			case 'list_code_definition_names':
				return JSON.stringify({
					toolId,
					tool: 'listCodeDefinitionNames',
					path: params.path
				});

			case 'write_to_file':
				return JSON.stringify({
					toolId,
					tool: 'newFileCreated',
					path: params.path
				});

			case 'apply_diff':
				return JSON.stringify({
					toolId,
					tool: 'appliedDiff',
					path: params.path
				});

			case 'edit_file':
				return JSON.stringify({
					toolId,
					tool: 'editedExistingFile',
					path: params.target_file
				});

			case 'insert_content':
				return JSON.stringify({
					toolId,
					tool: 'insertContent',
					path: params.path,
					line: params.line
				});

			case 'execute_command':
				return JSON.stringify({
					toolId,
					tool: 'executeCommand',
					command: params.command?.substring(0, 100) + (params.command?.length > 100 ? '...' : '')
				});

			case 'ask_followup_question':
				return JSON.stringify({
					toolId,
					tool: 'askFollowupQuestion',
					question: params.question?.substring(0, 100) + (params.question?.length > 100 ? '...' : '')
				});

			case 'attempt_completion':
				return JSON.stringify({
					toolId,
					tool: 'attemptCompletion'
				});

			case 'skill':
				return JSON.stringify({
					toolId,
					tool: 'skill',
					skillName: params.skill_name || params.name || 'unknown'
				});

			case 'task':
				return JSON.stringify({
					toolId,
					tool: 'task',
					description: params.description || 'unknown',
					subagentType: params.subagent_type || 'unknown'
				});

			default:
				return JSON.stringify({
					toolId,
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
	 * 支持精确 Token 统计和缓存 Token 统计
	 */
	private updateTokenUsage(usageChunk: any): void {
		// 精确输入 Token
		if (usageChunk.inputTokens) {
			this.tokenUsage.totalTokensIn += usageChunk.inputTokens;
		}

		// 精确输出 Token
		if (usageChunk.outputTokens) {
			this.tokenUsage.totalTokensOut += usageChunk.outputTokens;
		}

		// 缓存写入 Token（prompt caching）
		if (usageChunk.cacheCreationInputTokens) {
			this.tokenUsage.totalCacheWrites = (this.tokenUsage.totalCacheWrites || 0) + usageChunk.cacheCreationInputTokens;
		}

		// 缓存读取 Token（prompt caching）
		if (usageChunk.cacheReadInputTokens) {
			this.tokenUsage.totalCacheReads = (this.tokenUsage.totalCacheReads || 0) + usageChunk.cacheReadInputTokens;
		}

		// 更新上下文 Token（当前消息历史的估算）
		this.tokenUsage.contextTokens = this.estimateTokens(this.apiConversationHistory);

		console.log(`[TaskService] Token统计更新 - 输入:${this.tokenUsage.totalTokensIn}, 输出:${this.tokenUsage.totalTokensOut}, 缓存读:${this.tokenUsage.totalCacheReads || 0}, 缓存写:${this.tokenUsage.totalCacheWrites || 0}, 上下文:${this.tokenUsage.contextTokens}`);

		this._onTokenUsageUpdated.fire(this.tokenUsage);
	}

	/**
	 * 更新步骤状态
	 * 发出步骤更新事件，用于UI显示当前进度
	 */
	private updateStep(description: string, status: 'running' | 'completed' | 'error' = 'running'): void {
		if (status === 'running') {
			this.currentStepIndex++;
			this.currentStepDescription = description;
		}

		this._onStepUpdated.fire({
			current: this.currentStepIndex,
			total: this.totalSteps,
			description: description,
			status: status,
		});

		console.log(`[TaskService] 步骤更新: ${this.currentStepIndex}/${this.totalSteps} - ${description} (${status})`);
	}

	/**
	 * 设置总步骤数
	 * 根据规划结果或估算设置总步骤数
	 */
	private setTotalSteps(steps: number): void {
		this.totalSteps = steps;
		this.currentStepIndex = 0;
		console.log(`[TaskService] 设置总步骤数: ${steps}`);
	}

	/**
	 * 获取当前步骤信息
	 */
	public getStepInfo(): { current: number; total: number; description: string } {
		return {
			current: this.currentStepIndex,
			total: this.totalSteps,
			description: this.currentStepDescription,
		};
	}

	/**
	 * 中止任务
	 */
	public abortTask(reason?: ClineApiReqCancelReason): void {
		this.abort = true;
		this.abortReason = reason;
		this.setStatus(TaskStatus.ABORTED);
		// 发出步骤中止事件
		this._onStepUpdated.fire({
			current: this.currentStepIndex,
			total: this.totalSteps,
			description: '任务已取消',
			status: 'error',
		});
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
	 * 1. 使用 ContextCompactor 自动检测和修剪工具输出
	 * 2. 使用 AI 摘要压缩旧消息
	 * 3. 如果仍然超限，再截断消息
	 */
	private async truncateHistoryIfNeeded(): Promise<void> {
		// P2优化：使用ModelContextTracker估算token
		const currentTokens = this.modelContextTracker.estimateUsage(this.apiConversationHistory);
		const allowedTokens = MAX_CONTEXT_TOKENS - TOKEN_BUFFER;

		// P2优化：使用ModelContextTracker判断是否需要压缩
		if (!this.modelContextTracker.shouldCompact(this.apiConversationHistory, 0.8)) {
			return;
		}

		// 创建检查点（压缩前保存状态）
		await this.createCheckpointBeforeCompaction();

		console.log(`[TaskService] 上下文需要优化: tokens=${currentTokens}, messages=${this.apiConversationHistory.length}`);

		// 第一层：P0-3: 使用 ContextCompactor 自动修剪工具输出
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

		// 第二层：分层压缩策略
		const messages = this.apiConversationHistory as CompactableMessage[];
		const afterPruneTokens = this.estimateTokens(this.apiConversationHistory);

		if (this.tieredCompactionManager.shouldTieredCompact(messages, afterPruneTokens)) {
			console.log(`[TaskService] 执行分层压缩策略`);

			const tieredResult = this.tieredCompactionManager.executeTieredCompaction(messages);

			// 更新消息历史
			this.apiConversationHistory = tieredResult.messages as MessageParam[];
			const afterTieredTokens = this.estimateTokens(this.apiConversationHistory);

			console.log(`[TaskService] 分层压缩完成: Tier1=${tieredResult.tierCounts.tier1}, Tier2=${tieredResult.tierCounts.tier2}, Tier3=${tieredResult.tierCounts.tier3}, Tier4=${tieredResult.tierCounts.tier4}`);
			console.log(`[TaskService] Token变化: ${tieredResult.originalTokens} -> ${afterTieredTokens} (节省 ${tieredResult.originalTokens - afterTieredTokens})`);

			// 如果需要 AI 摘要（Tier 4 有消息）
			if (tieredResult.needsAISummary && tieredResult.summaryPrompt) {
				console.log(`[TaskService] 分层压缩需要 AI 摘要 (Tier4 消息数: ${tieredResult.tierCounts.tier4})`);

				try {
					// 调用 AI 生成摘要
					const summaryStream = this.apiHandler.createMessage(
						'你是一个专门生成对话摘要的助手。请根据提供的对话历史生成一个详细的摘要，保留所有关键技术细节。',
						[{ role: 'user', content: [{ type: 'text', text: tieredResult.summaryPrompt }] }],
						[]
					);

					let summaryText = '';
					for await (const chunk of summaryStream) {
						if (chunk.type === 'text') {
							summaryText += chunk.text;
						}
					}

					if (summaryText) {
						// 整合摘要到压缩结果
						const finalMessages = this.tieredCompactionManager.integrateSummary(tieredResult, summaryText);
						this.apiConversationHistory = finalMessages as MessageParam[];

						const finalTokens = this.estimateTokens(this.apiConversationHistory);
						console.log(`[TaskService] 分层压缩+AI摘要完成: ${tieredResult.originalTokens} -> ${finalTokens} tokens`);

						// 发出压缩完成事件
						this.say('condense_context', JSON.stringify({
							status: 'completed',
							prevContextTokens: tieredResult.originalTokens,
							newContextTokens: finalTokens,
							summary: summaryText.substring(0, 200) + '...',
							cost: 0,
							autoContinue: true,
							tiered: true, // 标记这是分层压缩
							tierCounts: tieredResult.tierCounts,
						}));
					}
				} catch (error) {
					console.error(`[TaskService] 分层压缩 AI 摘要失败:`, error);
					// AI 摘要失败，但分层压缩仍然有效
				}
			}

			// 如果分层压缩后仍在限制内，直接返回
			const newTokens = this.estimateTokens(this.apiConversationHistory);
			if (newTokens <= allowedTokens) {
				return;
			}
		}

		// 第三层：P0-2: 尝试传统 AI 摘要压缩
		const messagesAfterTiered = this.apiConversationHistory as CompactableMessage[];
		const tokensAfterTiered = this.estimateTokens(this.apiConversationHistory);

		if (this.aiSummaryCompactor.shouldSummarize(messagesAfterTiered, tokensAfterTiered)) {
			console.log(`[TaskService] 尝试 AI 摘要压缩`);

			try {
				const summaryResult = await this.condenseContext();
				if (summaryResult.success) {
					const newTokens = this.estimateTokens(this.apiConversationHistory);
					console.log(`[TaskService] AI摘要压缩完成: 从 ${summaryResult.originalTokens} tokens 压缩到 ${summaryResult.newTokens} tokens`);

					// 如果压缩后仍在限制内，直接返回
					if (newTokens <= allowedTokens) {
						return;
					}
				}
			} catch (error) {
				console.error(`[TaskService] AI摘要压缩失败:`, error);
				// 压缩失败，继续使用截断策略
			}
		}

		// 最终层：仍然超限，执行消息截断
		console.log(`[TaskService] 处理后仍超限，执行消息截断`);

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
	 * P2优化：在压缩前创建检查点
	 */
	private async createCheckpointBeforeCompaction(): Promise<void> {
		try {
			await this.checkpointManager.createCheckpoint(
				`压缩前检查点 - ${this.apiConversationHistory.length} 条消息`,
				{
					messageCount: this.apiConversationHistory.length,
					messages: [...this.apiConversationHistory],
					tokenUsage: { ...this.tokenUsage },
					timestamp: Date.now()
				}
			);
		} catch (error) {
			console.error('[TaskService] 创建检查点失败:', error);
		}
	}

	/**
	 * P2优化：使用状态锁执行关键操作
	 * TODO: 在关键状态修改处使用
	 */
	private async _withStateLock<T>(fn: () => T | Promise<T>): Promise<T> {
		return await this.stateMutex.withLock(fn);
	}

	/**
	 * AI摘要压缩
	 * 调用 AI 生成对话历史的摘要，替换旧消息
	 */
	private async condenseContext(): Promise<{
		success: boolean;
		originalTokens: number;
		newTokens: number;
		summary?: string;
	}> {
		const messages = this.apiConversationHistory as CompactableMessage[];
		const originalTokens = this.estimateTokens(this.apiConversationHistory);

		// 准备压缩数据
		const compactionPlan = this.aiSummaryCompactor.prepareCompaction(messages);

		if (!compactionPlan.needsSummary) {
			return {
				success: false,
				originalTokens,
				newTokens: originalTokens,
			};
		}

		// 发出压缩开始事件（通知 UI）
		this.say('condense_context', JSON.stringify({
			status: 'started',
			prevContextTokens: originalTokens,
			messageCount: messages.length,
		}));

		try {
			// 调用 AI 生成摘要
			const summaryPrompt = compactionPlan.summaryPrompt!;
			const summaryStream = this.apiHandler.createMessage(
				'你是一个专门生成对话摘要的助手。请根据提供的对话历史生成一个详细的摘要，保留所有关键技术细节。',
				[{ role: 'user', content: [{ type: 'text', text: summaryPrompt }] }],
				[] // 不使用工具
			);

			// 提取摘要文本
			let summaryText = '';
			for await (const chunk of summaryStream) {
				if (chunk.type === 'text') {
					summaryText += chunk.text;
				}
			}

			if (!summaryText) {
				throw new Error('AI 返回空摘要');
			}

			// 处理摘要，创建新的消息历史
			const result = this.aiSummaryCompactor.processSummary(
				summaryText,
				compactionPlan.messagesToKeep
			);

			// 更新消息历史
			this.apiConversationHistory = result.messages as MessageParam[];
			const newTokens = this.estimateTokens(this.apiConversationHistory);

			// 发出压缩完成事件
			this.say('condense_context', JSON.stringify({
				status: 'completed',
				prevContextTokens: originalTokens,
				newContextTokens: newTokens,
				summary: summaryText.substring(0, 200) + '...',
				cost: 0, // 摘要调用的成本（可选）
				autoContinue: true, // 标记将自动继续任务
			}));

			console.log(`[TaskService] AI摘要压缩成功: ${originalTokens} -> ${newTokens} tokens，自动继续任务`);

			return {
				success: true,
				originalTokens,
				newTokens,
				summary: summaryText,
			};

		} catch (error) {
			// 发出压缩错误事件
			this.say('condense_context_error', JSON.stringify({
				error: error instanceof Error ? error.message : String(error),
				prevContextTokens: originalTokens,
			}));

			console.error(`[TaskService] AI摘要压缩失败:`, error);

			return {
				success: false,
				originalTokens,
				newTokens: originalTokens,
			};
		}
	}

	/**
	 * 🚀 智能截断工具结果
	 * 根据内容类型选择不同的截断策略，优先保留关键信息
	 */
	private truncateToolResult(content: string): string {
		if (content.length <= MAX_TOOL_RESULT_LENGTH) {
			return content;
		}

		// 检测内容类型
		const contentType = this.detectContentType(content);
		const originalLength = content.length;

		let result: string;
		switch (contentType) {
			case 'error_log':
				// 错误日志：优先保留错误信息和堆栈
				result = this.truncateErrorLog(content);
				break;
			case 'code':
				// 代码文件：优先保留类定义和函数签名
				result = this.truncateCode(content);
				break;
			case 'json':
				// JSON：保留结构信息
				result = this.truncateJson(content);
				break;
			default:
				// 默认策略：头尾保留
				result = this.truncateDefault(content);
		}

		console.log(`[TaskService] 工具结果截断: ${originalLength} -> ${result.length} 字符, 类型: ${contentType}`);
		return result;
	}

	/**
	 * 检测内容类型
	 */
	private detectContentType(content: string): 'error_log' | 'code' | 'json' | 'default' {
		// 检测JSON
		if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
			return 'json';
		}
		// 检测错误日志
		if (content.includes('Error:') || content.includes('Exception') ||
			content.includes('Traceback') || content.includes('at ') && content.includes('(')) {
			return 'error_log';
		}
		// 检测代码（通过常见关键字）
		if (content.includes('function ') || content.includes('class ') ||
			content.includes('def ') || content.includes('import ') ||
			content.includes('package ') || content.includes('public ') ||
			content.includes('private ')) {
			return 'code';
		}
		return 'default';
	}

	/**
	 * 截断错误日志：优先保留错误信息和堆栈跟踪
	 */
	private truncateErrorLog(content: string): string {
		const lines = content.split('\n');
		const importantLines: string[] = [];
		const otherLines: string[] = [];

		for (const line of lines) {
			// 识别重要行：错误信息、堆栈跟踪、警告
			if (line.includes('Error') || line.includes('Exception') ||
				line.includes('Warning') || line.includes('FAILED') ||
				line.includes('at ') || line.includes('Caused by')) {
				importantLines.push(line);
			} else {
				otherLines.push(line);
			}
		}

		// 优先保留重要行，剩余空间保留其他行
		const maxImportant = Math.floor(MAX_TOOL_RESULT_LENGTH * 0.6);
		const maxOther = MAX_TOOL_RESULT_LENGTH - Math.min(importantLines.join('\n').length, maxImportant);

		let result = importantLines.slice(0, 100).join('\n');
		if (result.length > maxImportant) {
			result = result.substring(0, maxImportant);
		}

		const otherContent = otherLines.join('\n');
		if (otherContent.length > 0 && maxOther > 100) {
			const halfOther = Math.floor(maxOther / 2);
			result = otherContent.substring(0, halfOther) +
				'\n\n... [日志已截断，保留了错误信息] ...\n\n' +
				result;
		}

		return result;
	}

	/**
	 * 截断代码：优先保留类定义和函数签名
	 */
	private truncateCode(content: string): string {
		const lines = content.split('\n');
		const signatureLines: string[] = [];
		const bodyLines: string[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			// 识别函数/类/方法签名
			if (trimmed.startsWith('function ') || trimmed.startsWith('class ') ||
				trimmed.startsWith('def ') || trimmed.startsWith('public ') ||
				trimmed.startsWith('private ') || trimmed.startsWith('protected ') ||
				trimmed.startsWith('export ') || trimmed.startsWith('interface ') ||
				trimmed.startsWith('import ') || trimmed.startsWith('package ')) {
				signatureLines.push(line);
			} else {
				bodyLines.push(line);
			}
		}

		// 60%空间给签名，40%给函数体
		const maxSignatures = Math.floor(MAX_TOOL_RESULT_LENGTH * 0.6);
		const maxBody = MAX_TOOL_RESULT_LENGTH - maxSignatures;

		let signatures = signatureLines.join('\n');
		if (signatures.length > maxSignatures) {
			signatures = signatures.substring(0, maxSignatures);
		}

		const body = bodyLines.join('\n');
		const halfBody = Math.floor(maxBody / 2);
		const bodyHead = body.substring(0, halfBody);
		const bodyTail = body.substring(body.length - halfBody);

		return `${signatures}\n\n... [代码已截断，保留了签名和部分实现] ...\n\n${bodyHead}\n...\n${bodyTail}`;
	}

	/**
	 * 截断JSON：保留结构信息
	 */
	private truncateJson(content: string): string {
		// 对于JSON，尝试只保留前N个顶级键
		try {
			const parsed = JSON.parse(content);
			if (Array.isArray(parsed)) {
				// 数组：保留前10个元素
				const truncated = parsed.slice(0, 10);
				return JSON.stringify(truncated, null, 2) +
					`\n\n... [数组已截断，共 ${parsed.length} 个元素，显示前10个] ...`;
			} else if (typeof parsed === 'object') {
				// 对象：保留所有键，但值截断
				const keys = Object.keys(parsed);
				if (keys.length > 20) {
					const truncated: Record<string, any> = {};
					for (let i = 0; i < 20; i++) {
						truncated[keys[i]] = parsed[keys[i]];
					}
					return JSON.stringify(truncated, null, 2) +
						`\n\n... [对象已截断，共 ${keys.length} 个键，显示前20个] ...`;
				}
			}
		} catch {
			// JSON解析失败，使用默认策略
		}
		return this.truncateDefault(content);
	}

	/**
	 * 默认截断策略：头尾保留
	 */
	private truncateDefault(content: string): string {
		const halfLength = Math.floor(MAX_TOOL_RESULT_LENGTH / 2);
		const head = content.substring(0, halfLength);
		const tail = content.substring(content.length - halfLength);

		const truncatedChars = content.length - MAX_TOOL_RESULT_LENGTH;
		return head + `\n\n... [内容已截断，省略了约 ${truncatedChars} 字符] ...\n\n` + tail;
	}

	override dispose(): void {
		this.abort = true;
		super.dispose();
	}
}
