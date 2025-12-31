/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { ISearchService } from '../../../services/search/common/search.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IRipgrepService } from '../../../services/ripgrep/common/ripgrep.js';
import { ToolExecutorImpl } from './tools/toolExecutorImpl.js';
import { IToolExecutor } from '../common/tools/toolExecutor.js';
import { ToolUse, ToolResponse, ToolName } from '../common/tools/toolTypes.js';
import { ApiFactory } from '../common/api/apiFactory.js';
import { IApiHandler, ToolDefinition } from '../common/api/types.js';
import { SystemPromptGenerator } from '../common/prompts/systemPrompt.js';
import { Mode, DEFAULT_MODE, getModeBySlug, getToolsForMode } from '../common/modes/modeTypes.js';
import { type SystemInfo } from '../common/prompts/sections/systemInfo.js';
import { isWindows, isMacintosh, isLinux } from '../../../../base/common/platform.js';
import { TaskService } from '../common/task/TaskService.js';
import { TaskStatus, ClineMessage, ClineAskResponse, ClineApiReqCancelReason } from '../common/task/taskTypes.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { DiffViewProvider } from './diffViewProvider.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { DifyHandler, DifyConfiguration } from '../common/api/difyHandler.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IAILogService } from '../../../../platform/aiLog/common/aiLog.js';
import { IRequestService } from '../../../../platform/request/common/request.js';
import { EnvironmentContextTracker } from './EnvironmentContextTracker.js';
import { FileContextTracker } from '../common/context-tracking/FileContextTracker.js';
import { IRepoMapService, IRepoMapContext } from '../common/repomap/repoMapService.js';

export const IMaxianService = createDecorator<IMaxianService>('maxianService');

/**
 * 消息事件类型 - 保留向后兼容
 */
export interface IMessageEvent {
	type: 'user' | 'assistant' | 'tool' | 'error';
	content: string;
	isPartial?: boolean;
}

/**
 * Cline消息事件类型 - 新的完整消息格式
 */
export interface IClineMessageEvent {
	message: ClineMessage;
}

/**
 * 用户问答事件类型
 */
export interface IQuestionAskedEvent {
	question: string;
	toolUseId: string;
}

/**
 * 知识库配置（用于ask模式）
 */
export interface IKnowledgeBaseConfig {
	apiUrl: string;
	apiKey: string;
	id?: string;  // 知识库ID (可选)
	name?: string;  // 知识库名称 (可选)
}

/**
 * Token使用量统计（会话级别）
 */
export interface ISessionUsage {
	promptTokens: number;      // 累计输入token
	completionTokens: number;  // 累计输出token
	totalTokens: number;       // 累计总token
	requestCount: number;      // 请求次数
}

/**
 * 单次请求的Token使用量事件
 */
export interface ITokenUsageEvent {
	promptTokens: number;      // 本次输入token
	completionTokens: number;  // 本次输出token
	totalTokens: number;       // 本次总token
	mode: string;              // 模式（ask/code/architect等）
	timestamp: number;         // 时间戳
}

/**
 * 任务进度事件
 */
export interface ITaskProgressEvent {
	current: number;           // 当前步骤
	total: number;             // 总步骤数
	currentStep?: string;      // 当前步骤描述
	status: 'running' | 'completed' | 'error' | 'cancelled';  // 任务状态
}

/**
 * 工具输入流式事件
 * 用于实时显示工具调用的参数信息
 */
export interface IToolInputStreamingEvent {
	toolId: string;            // 工具调用ID
	toolName: string;          // 工具名称
	input: any;                // 工具输入参数
	isPartial: boolean;        // 是否为部分输入（流式传输中）
}

/**
 * 码弦服务接口
 */
export interface IMaxianService {
	readonly _serviceBrand: undefined;

	/**
	 * 消息事件 - 保留向后兼容
	 */
	readonly onMessage: Event<IMessageEvent>;

	/**
	 * Cline消息事件 - 新的完整消息格式
	 */
	readonly onClineMessage: Event<IClineMessageEvent>;

	/**
	 * 用户问答事件（AI向用户提问）- 保留向后兼容
	 */
	readonly onQuestionAsked: Event<IQuestionAskedEvent>;

	/**
	 * 初始化码弦服务
	 */
	initialize(): Promise<void>;

	/**
	 * 发送消息到 AI
	 * @param message 用户消息
	 * @param mode 当前模式（默认为code模式）
	 * @param knowledgeBaseConfig 知识库配置（ask模式专用）
	 */
	sendMessage(message: string, mode?: Mode, knowledgeBaseConfig?: IKnowledgeBaseConfig): Promise<void>;

	/**
	 * 提交用户回复（回答AI的问题）- 旧版本
	 * @param response 用户的回复
	 */
	submitUserResponse(response: string): void;

	/**
	 * 处理Ask响应 - 新版本，支持完整的ClineAskResponse格式
	 * @param askTs ask消息的时间戳
	 * @param response 响应类型
	 * @param text 响应文本（可选）
	 * @param images 响应图片（可选）
	 */
	handleAskResponse(askTs: number, response: ClineAskResponse, text?: string, images?: string[]): void;

	/**
	 * 执行工具调用
	 */
	executeTool(toolUse: ToolUse): Promise<ToolResponse>;

	/**
	 * 获取可用工具列表
	 */
	getAvailableTools(): ToolName[];

	/**
	 * 获取当前任务状态
	 */
	getTaskStatus(): any;

	/**
	 * 打开文件diff视图
	 * @param filePath 文件路径
	 * @param newContent 新内容
	 */
	openDiffView(filePath: string, newContent: string): Promise<boolean>;

	/**
	 * 应用SEARCH/REPLACE差异并打开diff视图
	 * @param filePath 文件路径
	 * @param diff SEARCH/REPLACE格式的差异
	 */
	applyDiffView(filePath: string, diff: string): Promise<boolean>;

	/**
	 * 保存diff修改并关闭diff编辑器，打开修改后的文件
	 */
	saveDiffAndClose(): Promise<boolean>;

	/**
	 * 关闭diff编辑器但不保存
	 */
	closeDiffWithoutSave(): Promise<boolean>;

	/**
	 * 取消当前正在执行的任务
	 */
	cancelTask(): void;

	/**
	 * 清空对话历史
	 */
	clearConversation(): void;

	/**
	 * 重置ask模式的会话ID（不影响其他状态）
	 */
	resetAskConversation(): void;

	/**
	 * 任务取消事件
	 */
	readonly onTaskCancelled: Event<void>;

	/**
	 * 对话清空事件
	 */
	readonly onConversationCleared: Event<void>;

	/**
	 * 单次对话完成的Token使用量事件
	 * （一次code/ask等模式对话完成时触发，包含本次对话的总token）
	 */
	readonly onTokenUsage: Event<ITokenUsageEvent>;

	/**
	 * 任务进度事件
	 * （任务执行过程中触发，显示当前进度）
	 */
	readonly onTaskProgress: Event<ITaskProgressEvent>;

	/**
	 * 工具输入流式事件
	 * （工具调用时实时触发，显示工具参数输入）
	 */
	readonly onToolInputStreaming: Event<IToolInputStreamingEvent>;

	/**
	 * 设置工具自动批准规则
	 * @param toolName 工具名称
	 * @param autoApprove 是否自动批准
	 */
	setToolAutoApprove(toolName: string, autoApprove: boolean): void;

	/**
	 * 检查工具是否设置为自动批准
	 * @param toolName 工具名称
	 */
	isToolAutoApproved(toolName: string): boolean;

	/**
	 * 设置命令自动批准规则
	 * @param command 命令（支持通配符 * 表示所有命令）
	 * @param autoApprove 是否自动批准
	 */
	setCommandAutoApprove(command: string, autoApprove: boolean): void;

	/**
	 * 检查命令是否设置为自动批准
	 * @param command 命令
	 */
	isCommandAutoApproved(command: string): boolean;

	/**
	 * 获取所有自动批准规则
	 */
	getAutoApproveRules(): { tools: string[]; commands: string[] };

	/**
	 * 清除所有自动批准规则
	 */
	clearAutoApproveRules(): void;
}

/**
 * 码弦服务实现
 */
export class MaxianService extends Disposable implements IMaxianService {
	declare readonly _serviceBrand: undefined;

	private readonly _onMessage = this._register(new Emitter<IMessageEvent>());
	readonly onMessage: Event<IMessageEvent> = this._onMessage.event;

	private readonly _onClineMessage = this._register(new Emitter<IClineMessageEvent>());
	readonly onClineMessage: Event<IClineMessageEvent> = this._onClineMessage.event;

	private readonly _onQuestionAsked = this._register(new Emitter<IQuestionAskedEvent>());
	readonly onQuestionAsked: Event<IQuestionAskedEvent> = this._onQuestionAsked.event;

	private readonly _onTaskCancelled = this._register(new Emitter<void>());
	readonly onTaskCancelled: Event<void> = this._onTaskCancelled.event;

	private readonly _onConversationCleared = this._register(new Emitter<void>());
	readonly onConversationCleared: Event<void> = this._onConversationCleared.event;

	private readonly _onTokenUsage = this._register(new Emitter<ITokenUsageEvent>());
	readonly onTokenUsage: Event<ITokenUsageEvent> = this._onTokenUsage.event;

	private readonly _onTaskProgress = this._register(new Emitter<ITaskProgressEvent>());
	readonly onTaskProgress: Event<ITaskProgressEvent> = this._onTaskProgress.event;

	private readonly _onToolInputStreaming = this._register(new Emitter<IToolInputStreamingEvent>());
	readonly onToolInputStreaming: Event<IToolInputStreamingEvent> = this._onToolInputStreaming.event;

	private _initialized = false;
	private toolExecutor: IToolExecutor | null = null;
	private apiHandler: IApiHandler | null = null;
	private apiFactory: ApiFactory;
	private currentMode: Mode = DEFAULT_MODE;
	private currentTask: TaskService | null = null;
	private currentTaskCancelled: boolean = false;  // 标记当前任务是否已被取消，防止重复处理
	private diffViewProvider: DiffViewProvider | null = null;
	private difyHandler: DifyHandler | null = null;
	private currentDifyConfig: string | null = null;  // 当前Dify配置的hash（用于判断是否需要重新创建Handler）
	private isAskModeRunning: boolean = false;  // 标记ask模式是否正在运行
	private askModeAbortController: AbortController | null = null;  // ask模式的中止控制器

	// AI调用日志记录相关字段
	private currentTraceId: string | null = null;  // 当前会话的追踪ID
	private currentCallStartTime: Date | null = null;  // 当前调用开始时间
	private currentFirstTokenTime: Date | null = null;  // 首Token到达时间
	private currentKnowledgeBaseConfig: IKnowledgeBaseConfig | null = null;  // 当前知识库配置

	// 自动批准规则
	private autoApprovedTools: Set<string> = new Set();  // 自动批准的工具名称
	private autoApprovedCommands: Set<string> = new Set();  // 自动批准的命令（* 表示所有命令）

	// 上下文跟踪器（P0优化：environment_details增强）
	private environmentTracker: EnvironmentContextTracker;
	private fileTracker: FileContextTracker | null = null;

	// RepoMap服务（P1优化：最大影响50-60%）
	private repoMapService: IRepoMapService | null = null;
	private lastRepoMap: string | null = null;
	private lastRepoMapTime: number = 0;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@ISearchService private readonly searchService: ISearchService,
		@IRipgrepService private readonly ripgrepService: IRipgrepService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorService _editorService: IEditorService,
		@IModelService _modelService: IModelService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStorageService private readonly storageService: IStorageService,
		@IAILogService private readonly aiLogService: IAILogService,
		@IRequestService private readonly requestService: IRequestService,
		@IRepoMapService private readonly _repoMapService: IRepoMapService
	) {
		super();
		this.apiFactory = new ApiFactory(this.configurationService);
		// 使用IInstantiationService创建DiffViewProvider实例，确保依赖注入正确工作
		this.diffViewProvider = this.instantiationService.createInstance(DiffViewProvider);
		this._register(this.diffViewProvider);

		// P0优化：初始化环境上下文跟踪器
		this.environmentTracker = new EnvironmentContextTracker(
			_editorService,
			this.terminalService,
			this.workspaceContextService
		);
		console.log('[Maxian] 环境上下文跟踪器已初始化');
	}

	/**
	 * 从StorageService加载认证凭据
	 * 使用与authService相同的存储key
	 */
	private loadAuthCredentials(): { username: string; password: string } | undefined {
		try {
			const stored = this.storageService.get('zhikai.auth.credentials', StorageScope.APPLICATION);
			if (!stored) {
				console.log('[Maxian] 未找到存储的认证凭据');
				return undefined;
			}

			const parsed = JSON.parse(stored);
			if (parsed && parsed.username && parsed.password) {
				console.log('[Maxian] 从StorageService加载认证凭据成功，用户:', parsed.username);
				return {
					username: parsed.username,
					password: parsed.password
				};
			}

			return undefined;
		} catch (error) {
			console.error('[Maxian] 加载认证凭据失败:', error);
			return undefined;
		}
	}

	async initialize(): Promise<void> {
		if (this._initialized) {
			return;
		}

		console.log('[Maxian] 码弦服务初始化...');

		// 获取工作区根目录
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		const workspaceRoot = workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : '';

		// 初始化工具执行器
		this.toolExecutor = new ToolExecutorImpl(
			this.fileService,
			this.terminalService,
			this.searchService,
			this.ripgrepService,
			{
				cwd: workspaceRoot,
				workspaceRoot: workspaceRoot
			}
		);

		console.log('[Maxian] 工具执行器已初始化，工作区:', workspaceRoot);

		// P1优化：初始化 RepoMapService
		if (workspaceRoot) {
			this.repoMapService = this._repoMapService;
			await this.repoMapService.initialize(workspaceRoot);
			console.log('[Maxian] RepoMapService已初始化');
		}

		// 从StorageService读取认证凭据（与authService使用相同的key）
		const credentials = this.loadAuthCredentials();

		// 初始化API Handler（优先使用代理服务）
		const validation = this.apiFactory.validateConfiguration();
		if (!validation.valid) {
			console.warn('[Maxian] API配置验证失败:', validation.error);
		}

		this.apiHandler = this.apiFactory.createHandler(credentials, this.currentMode);
		const modelInfo = this.apiHandler.getModel();
		console.log('[Maxian] API Handler已初始化，模型:', modelInfo.name, '模式:', this.currentMode);

		this._initialized = true;
		console.log('[Maxian] 码弦服务初始化完成');
	}

	async sendMessage(message: string, mode: Mode = DEFAULT_MODE, knowledgeBaseConfig?: IKnowledgeBaseConfig): Promise<void> {
		console.log('[Maxian] 发送消息:', message, '模式:', mode, '知识库配置:', knowledgeBaseConfig ? '已提供' : '未提供');

		// 更新当前模式
		this.currentMode = mode;

		// 生成新的TraceId和记录开始时间
		this.currentTraceId = this.generateTraceId();
		this.currentCallStartTime = new Date();
		this.currentFirstTokenTime = null;
		this.currentKnowledgeBaseConfig = knowledgeBaseConfig || null;

		console.log('[Maxian] AI调用开始 - TraceId:', this.currentTraceId, '开始时间:', this.currentCallStartTime.toISOString());

		// 确保已初始化
		if (!this._initialized) {
			await this.initialize();
		}

		// 触发用户消息事件
		this._onMessage.fire({
			type: 'user',
			content: message
		});

		// 根据模式选择不同的处理方式
		if (mode === 'ask') {
			// ask 模式：使用 DifyHandler 调用知识库接口
			await this.sendDifyMessage(message, knowledgeBaseConfig);
		} else {
			// 其他模式：使用 TaskService 进行完整的任务处理
			await this.sendTaskMessage(message);
		}
	}

	/**
	 * 使用 DifyHandler 发送消息（ask 模式专用）
	 * 直接调用知识库接口，不使用工具
	 * @param message 用户消息
	 * @param knowledgeBaseConfig 知识库配置（可选，如果提供则使用，否则从VSCode配置读取）
	 */
	private async sendDifyMessage(message: string, knowledgeBaseConfig?: IKnowledgeBaseConfig): Promise<void> {
		// 标记ask模式正在运行
		this.isAskModeRunning = true;
		this.askModeAbortController = new AbortController();

		// 用于跟踪token统计（中止时使用）
		let inputLength = 0;
		let outputLength = 0;
		let wasAborted = false;

		try {
			// 确定 Dify 配置：优先使用传入的知识库配置，否则从VSCode设置读取
			let difyApiUrl: string;
			let difyApiKey: string;
			const difyUser = this.configurationService.getValue<string>('zhikai.dify.user') || 'default-user';

			// 读取代理服务地址（从Auth配置中读取）
			const proxyBaseUrl = this.configurationService.getValue<string>('zhikai.auth.apiUrl');
			if (proxyBaseUrl) {
				console.log('[Maxian] 使用代理服务地址:', proxyBaseUrl);
			}

			if (knowledgeBaseConfig) {
				// 使用传入的知识库配置
				difyApiUrl = knowledgeBaseConfig.apiUrl;
				difyApiKey = knowledgeBaseConfig.apiKey;
				console.log('[Maxian] 使用选中的知识库配置:', difyApiUrl);

				// 生成配置hash用于判断是否需要重新创建Handler
				const configHash = `${difyApiUrl}|${difyApiKey}`;

				// 只有当配置改变或Handler不存在时才重新创建
				if (this.currentDifyConfig !== configHash || !this.difyHandler) {
					const difyConfig: DifyConfiguration = {
						apiUrl: difyApiUrl,
						apiKey: difyApiKey,
						user: difyUser,
						proxyBaseUrl: proxyBaseUrl,  // 使用代理服务
						requestService: this.requestService
					};
					this.difyHandler = new DifyHandler(difyConfig);
					this.currentDifyConfig = configHash;
					console.log('[Maxian] DifyHandler 已使用新配置初始化');
				} else {
					console.log('[Maxian] 复用现有DifyHandler实例（配置未改变，保留conversation_id）');
				}
			} else {
				// 从VSCode配置中读取（向后兼容）
				difyApiUrl = this.configurationService.getValue<string>('zhikai.dify.apiUrl') || 'http://dify.boyocloud.com/v1';
				difyApiKey = this.configurationService.getValue<string>('zhikai.dify.apiKey') || '';

				if (!difyApiKey) {
					console.error('[Maxian] Dify API Key 未配置');
					this._onMessage.fire({
						type: 'error',
						content: '错误: 请选择一个知识库，或在设置中配置 zhikai.dify.apiKey'
					});
					return;
				}

				// 只在没有 DifyHandler 或配置不同时重新初始化
				if (!this.difyHandler) {
				const difyConfig: DifyConfiguration = {
					apiUrl: difyApiUrl,
					apiKey: difyApiKey,
					user: difyUser,
					proxyBaseUrl: proxyBaseUrl,  // 使用代理服务
					requestService: this.requestService
				};
				this.difyHandler = new DifyHandler(difyConfig);
				console.log('[Maxian] DifyHandler 已从VSCode配置初始化');
				}
			}

			console.log('[Maxian] 使用 Dify 知识库接口发送消息');

			// 记录输入长度（用于中止时的估算）
			inputLength = message.length;

			// 调用 Dify API 并处理流式响应（传递AbortSignal以支持真正的中止）
			let fullResponse = '';
			for await (const chunk of this.difyHandler.sendMessage(message, undefined, this.askModeAbortController.signal)) {
				// 检查是否被中止
				if (this.askModeAbortController?.signal.aborted) {
					console.log('[Maxian] Ask模式已被中止');
					wasAborted = true;
					break;
				}

				if (chunk.type === 'text') {
					// 记录首Token时间
					if (!this.currentFirstTokenTime && chunk.text) {
						this.currentFirstTokenTime = new Date();
						console.log('[Maxian] 首Token到达时间:', this.currentFirstTokenTime.toISOString());
					}

					// 流式输出文本
					fullResponse += chunk.text;
					this._onMessage.fire({
						type: 'assistant',
						content: chunk.text,
						isPartial: true
					});
				} else if (chunk.type === 'usage') {
					// 触发单次对话完成的token使用量事件
					const usageEvent: ITokenUsageEvent = {
						promptTokens: chunk.inputTokens,
						completionTokens: chunk.outputTokens,
						totalTokens: chunk.totalTokens,
						mode: 'ask',
						timestamp: Date.now()
					};
					this._onTokenUsage.fire(usageEvent);

					console.log(`[Maxian] Ask模式Token使用量 - 输入:${usageEvent.promptTokens}, 输出:${usageEvent.completionTokens}, 总计:${usageEvent.totalTokens}`);

					// 记录AI调用日志（成功）
					await this.logAICall({
						inputTokens: chunk.inputTokens,
						outputTokens: chunk.outputTokens,
						status: 'success',
						requestSummary: message.substring(0, 200) // 限制长度
					});
				} else if (chunk.type === 'error') {
					// 处理错误
					console.error('[Maxian] Dify 错误:', chunk.error);
					this._onMessage.fire({
						type: 'error',
						content: chunk.error
					});

					// 记录AI调用日志（失败）
					await this.logAICall({
						inputTokens: Math.ceil(inputLength / 3), // 估算
						outputTokens: Math.ceil(outputLength / 3), // 估算
						status: 'failed',
						errorMessage: chunk.error,
						requestSummary: message.substring(0, 200)
					});
					return;
				}
			}

			// 记录输出长度
			outputLength = fullResponse.length;

			// 流结束
			this._onMessage.fire({
				type: 'assistant',
				content: '',
				isPartial: false
			});

			console.log('[Maxian] Dify 响应完成，总长度:', fullResponse.length);

		} catch (error) {
			// 检查是否是中止导致的错误
			if (this.askModeAbortController?.signal.aborted) {
				console.log('[Maxian] Ask模式已被用户中止');
				wasAborted = true;
			} else {
				console.error('[Maxian] Dify 请求错误:', error);
				this._onMessage.fire({
					type: 'error',
					content: `Dify 错误: ${error instanceof Error ? error.message : String(error)}`
				});

				// 记录AI调用日志（失败）
				await this.logAICall({
					inputTokens: Math.ceil(inputLength / 3),
					outputTokens: Math.ceil(outputLength / 3),
					status: 'failed',
					errorMessage: error instanceof Error ? error.message : String(error),
					requestSummary: message.substring(0, 200)
				});
			}
		} finally {
			// 如果被中止且有部分输出，记录估算的token使用量
			if (wasAborted && (inputLength > 0 || outputLength > 0)) {
				// 粗略估算：1个token ≈ 4个字符（中文约2-3字符，英文约4字符）
				const estimatedInputTokens = Math.ceil(inputLength / 3);
				const estimatedOutputTokens = Math.ceil(outputLength / 3);

				const usageEvent: ITokenUsageEvent = {
					promptTokens: estimatedInputTokens,
					completionTokens: estimatedOutputTokens,
					totalTokens: estimatedInputTokens + estimatedOutputTokens,
					mode: 'ask',
					timestamp: Date.now()
				};
				this._onTokenUsage.fire(usageEvent);

				console.log(`[Maxian] Ask模式中止，估算Token使用量 - 输入字符:${inputLength}(≈${estimatedInputTokens}tokens), 输出字符:${outputLength}(≈${estimatedOutputTokens}tokens), 总计:${usageEvent.totalTokens}tokens（注意：此为估算值，非精确统计）`);

				// 记录AI调用日志（中止）
				await this.logAICall({
					inputTokens: estimatedInputTokens,
					outputTokens: estimatedOutputTokens,
					status: 'aborted',
					requestSummary: message.substring(0, 200)
				});
			}

			// 清理ask模式状态
			this.isAskModeRunning = false;
			this.askModeAbortController = null;
		}
	}

	/**
	 * 使用 TaskService 发送消息（code/architect/debug 等模式）
	 * 完整的任务处理，包括工具调用
	 */
	private async sendTaskMessage(message: string): Promise<void> {
		if (!this.apiHandler || !this.toolExecutor) {
			console.error('[Maxian] API Handler 或工具执行器未初始化');
			this._onMessage.fire({
				type: 'error',
				content: '错误: 服务未初始化。请检查配置。'
			});
			return;
		}

		// 获取工作区根目录
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		const workspaceRoot = workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : '';

		try {
			// P0优化：生成 environment_details 并附加到用户消息
			const recentlyModifiedFiles = this.fileTracker?.getAndClearRecentlyModifiedFiles() || [];
			const environmentDetails = await this.environmentTracker.generateEnvironmentDetails(recentlyModifiedFiles);

			// P1优化：生成 RepoMap（首次或文件变化时）
			let repoMap = '';
			if (this.repoMapService && this.shouldGenerateRepoMap(recentlyModifiedFiles)) {
				repoMap = await this.generateRepoMap(workspaceRoot);
			}

			// 组合完整消息
			const messageParts = [message];
			if (environmentDetails) {
				messageParts.push(environmentDetails);
			}
			if (repoMap) {
				messageParts.push(repoMap);
			}
			const fullMessage = messageParts.join('\n\n');

			console.log('[Maxian] 消息组合完成，总长度:', fullMessage.length,
				'(原始:', message.length,
				'+ env:', environmentDetails.length,
				'+ repomap:', repoMap.length, ')');

			// 创建新的TaskService实例，并重置取消标志
			this.currentTaskCancelled = false;
			this.currentTask = new TaskService({
				task: fullMessage,
				apiHandler: this.apiHandler,
				toolExecutor: this.toolExecutor,
				getSystemPrompt: () => this.getSystemPrompt(),
				getToolDefinitions: () => this.getToolDefinitions(),
				workspaceRoot,
				consecutiveMistakeLimit: 3,
				currentMode: this.currentMode
			});

			// 连接TaskService事件
			const statusChangedDisposable = this.currentTask.onStatusChanged(async (status) => {
				console.log('[Maxian] Task状态变更:', status, ', 任务已取消:', this.currentTaskCancelled);

				// 如果任务已被取消，忽略后续状态变化（除了ABORTED）
				if (this.currentTaskCancelled && status !== TaskStatus.ABORTED) {
					console.log('[Maxian] 任务已被取消，忽略状态变化:', status);
					return;
				}

				if (status === TaskStatus.COMPLETED || status === TaskStatus.ERROR || status === TaskStatus.ABORTED) {
					// 任务结束（无论成功、失败还是中止），记录AI调用日志
					// 但如果任务已被取消，不再重复记录
					if (this.currentTask && !this.currentTaskCancelled) {
						const taskUsage = this.currentTask.getTokenUsage();

						// 尝试使用后端返回的精确token数据
						if (taskUsage && (taskUsage.totalTokensIn > 0 || taskUsage.totalTokensOut > 0)) {
							// 有精确的token数据
							const usageEvent: ITokenUsageEvent = {
								promptTokens: taskUsage.totalTokensIn || 0,
								completionTokens: taskUsage.totalTokensOut || 0,
								totalTokens: (taskUsage.totalTokensIn || 0) + (taskUsage.totalTokensOut || 0),
								mode: this.currentMode,
								timestamp: Date.now()
							};
							this._onTokenUsage.fire(usageEvent);

							console.log(`[Maxian] ${this.currentMode}模式Token使用量(精确) - 输入:${usageEvent.promptTokens}, 输出:${usageEvent.completionTokens}, 总计:${usageEvent.totalTokens}`);

							// 记录AI调用日志(使用精确token数据)
							await this.logAICall({
								inputTokens: usageEvent.promptTokens,
								outputTokens: usageEvent.completionTokens,
								status: status === TaskStatus.COMPLETED ? 'success' : (status === TaskStatus.ABORTED ? 'aborted' : 'failed'),
								errorMessage: status === TaskStatus.ERROR ? '任务执行失败' : undefined,
								requestSummary: message.substring(0, 200)
							});
						} else {
							// 没有精确token数据,使用估算值并记录日志
							console.warn(`[Maxian] ${this.currentMode}模式后端未返回token数据，使用估算值记录日志`);

							// 估算token: 基于消息长度
							// 1个中文字符 ≈ 1.5 tokens, 1个英文单词 ≈ 1.3 tokens
							// 简化估算: 每3个字符 ≈ 1 token
							const estimatedInputTokens = Math.ceil(message.length / 3);

							// 估算输出token: 收集所有文本响应
							let totalOutputText = '';
							const messages = this.currentTask.getClineMessages();
							for (const msg of messages) {
								if (msg.type === 'say' && (msg.say === 'text' || msg.say === 'completion_result') && msg.text) {
									totalOutputText += msg.text;
								}
							}
							const estimatedOutputTokens = Math.ceil(totalOutputText.length / 3);

							const usageEvent: ITokenUsageEvent = {
								promptTokens: estimatedInputTokens,
								completionTokens: estimatedOutputTokens,
								totalTokens: estimatedInputTokens + estimatedOutputTokens,
								mode: this.currentMode,
								timestamp: Date.now()
							};
							this._onTokenUsage.fire(usageEvent);

							console.log(`[Maxian] ${this.currentMode}模式Token使用量(估算) - 输入:${usageEvent.promptTokens}(${message.length}字符), 输出:${usageEvent.completionTokens}(${totalOutputText.length}字符), 总计:${usageEvent.totalTokens}tokens (注意:为估算值)`);

							// 记录AI调用日志(使用估算token数据)
							await this.logAICall({
								inputTokens: estimatedInputTokens,
								outputTokens: estimatedOutputTokens,
								status: status === TaskStatus.COMPLETED ? 'success' : (status === TaskStatus.ABORTED ? 'aborted' : 'failed'),
								errorMessage: status === TaskStatus.ERROR ? '任务执行失败' : undefined,
								requestSummary: message.substring(0, 200)
							});
						}
					}
				}

				if (status === TaskStatus.COMPLETED) {
					this._onMessage.fire({
						type: 'assistant',
						content: '',
						isPartial: false
					});
					// 任务结束后重置currentTask，避免取消按钮误触发
					this.currentTask = null;
				} else if (status === TaskStatus.ERROR) {
					// 仅对真正的错误显示错误提示，中止时静默处理
					this._onMessage.fire({
						type: 'error',
						content: '任务错误'
					});
					// 任务结束后重置currentTask，避免取消按钮误触发
					this.currentTask = null;
				} else if (status === TaskStatus.ABORTED) {
					// ABORTED状态静默处理，不显示任何提示
					// 任务结束后重置currentTask，避免取消按钮误触发
					this.currentTask = null;
				}
			});
			this._register(statusChangedDisposable);

			const messageAddedDisposable = this.currentTask.onMessageAdded(clineMessage => {
				console.log('[Maxian] Task消息:', clineMessage);

				// 发送完整的ClineMessage（新版本）
				this._onClineMessage.fire({ message: clineMessage });

				// 同时将ClineMessage转换为IMessageEvent（向后兼容）
				if (clineMessage.type === 'say') {
					if (clineMessage.say === 'text' || clineMessage.say === 'completion_result') {
						this._onMessage.fire({
							type: 'assistant',
							content: clineMessage.text || '',
							isPartial: true
						});
					} else if (clineMessage.say === 'error') {
						this._onMessage.fire({
							type: 'error',
							content: clineMessage.text || '未知错误'
						});
					}
				}
			});
			this._register(messageAddedDisposable);

			// 监听流式chunks，实时发送文本到UI
			const streamChunkDisposable = this.currentTask.onStreamChunk(chunk => {
				if (chunk.text) {
					// 记录首Token时间
					if (!this.currentFirstTokenTime) {
						this.currentFirstTokenTime = new Date();
						console.log('[Maxian] 首Token到达时间:', this.currentFirstTokenTime.toISOString());
					}

					// 实时发送文本chunks
					this._onMessage.fire({
						type: 'assistant',
						content: chunk.text,
						isPartial: chunk.isPartial
					});
				} else if (!chunk.isPartial) {
					// 流结束信号
					this._onMessage.fire({
						type: 'assistant',
						content: '',
						isPartial: false
					});
				}
			});
			this._register(streamChunkDisposable);

			// 注意：token使用量事件已在onStatusChanged中统一触发，这里不再重复触发
			// 只记录日志用于调试
			const tokenUsageDisposable = this.currentTask.onTokenUsageUpdated((tokenUsage) => {
				if (tokenUsage && (tokenUsage.totalTokensIn > 0 || tokenUsage.totalTokensOut > 0)) {
					console.log(`[Maxian] Token使用量实时更新 - 输入:${tokenUsage.totalTokensIn}, 输出:${tokenUsage.totalTokensOut}`);
				}
			});
			this._register(tokenUsageDisposable);

			// 监听用户输入请求
			const userInputDisposable = this.currentTask.onUserInputRequired(({ question, toolUseId }) => {
				console.log('[Maxian] 转发用户输入请求到UI:', question);
				this._onQuestionAsked.fire({ question, toolUseId });
			});
			this._register(userInputDisposable);

			// 监听步骤更新事件，转发到任务进度事件
			const stepUpdatedDisposable = this.currentTask.onStepUpdated((stepInfo) => {
				console.log('[Maxian] 步骤更新:', stepInfo);

				// 转换状态
				let status: 'running' | 'completed' | 'error' | 'cancelled';
				switch (stepInfo.status) {
					case 'running':
						status = 'running';
						break;
					case 'completed':
						status = 'completed';
						break;
					case 'error':
						status = 'error';
						break;
					default:
						status = 'running';
				}

				// 发出任务进度事件
				this._onTaskProgress.fire({
					current: stepInfo.current,
					total: stepInfo.total,
					currentStep: stepInfo.description,
					status: status,
				});
			});
			this._register(stepUpdatedDisposable);

			// 监听工具输入流式事件，转发到UI
			const toolInputStreamingDisposable = this.currentTask.onToolInputStreaming((event) => {
				console.log('[Maxian] 工具输入流式:', event.toolName, event.isPartial ? '(部分)' : '(完整)');
				this._onToolInputStreaming.fire({
					toolId: event.toolId,
					toolName: event.toolName,
					input: event.input,
					isPartial: event.isPartial
				});
			});
			this._register(toolInputStreamingDisposable);

			// 启动任务
			await this.currentTask.start();

		} catch (error) {
			console.error('[Maxian] 任务执行错误:', error);
			this._onMessage.fire({
				type: 'error',
				content: `错误: ${error instanceof Error ? error.message : String(error)}`
			});

			// 记录AI调用日志（失败）
			console.log('[Maxian] 任务执行出现异常，记录失败日志');
			await this.logAICall({
				status: 'failed',
				errorMessage: error instanceof Error ? error.message : String(error),
				requestSummary: message.substring(0, 200)
			});
		}
	}


	/**
	 * 获取系统信息
	 */
	private getSystemInfo(): SystemInfo {
		// 获取平台信息
		let platform = 'unknown';
		let shell = 'bash';

		if (isWindows) {
			platform = 'win32';
			shell = 'cmd.exe或PowerShell';
		} else if (isMacintosh) {
			platform = 'darwin';
			shell = 'zsh或bash';
		} else if (isLinux) {
			platform = 'linux';
			shell = 'bash';
		}

		// 架构信息（浏览器环境中无法直接获取，使用默认值）
		const arch = 'x64'; // 默认值，实际可以从navigator.userAgent推断

		// Node版本（浏览器环境中无法获取，使用占位符）
		const nodeVersion = 'v18.x'; // VSCode内置的Node版本

		return {
			platform,
			arch,
			nodeVersion,
			shell
		};
	}

	/**
	 * 获取系统提示词（本地生成）
	 * 工具描述在IDE中硬编码，确保最佳的提示词质量
	 */
	private async getSystemPrompt(): Promise<string> {
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		const workspaceRoot = workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : '';
		const systemInfo = this.getSystemInfo();
		const availableTools = this.getAvailableTools();

		// 直接使用本地生成，工具描述在IDE中硬编码
		const prompt = SystemPromptGenerator.generate(workspaceRoot, availableTools, systemInfo, this.currentMode);
		console.log('[Maxian] 本地生成系统提示词，长度:', prompt.length);
		return prompt;
	}

	/**
	 * 获取所有工具定义
	 * 包含所有23个工具的完整定义（含P0/P1优化新增的8个工具）
	 */
	private getAllToolDefinitions(): ToolDefinition[] {
		return [
			// 1. read_file - 读取文件
			{
				name: 'read_file',
				description: '读取指定文件的内容。支持行范围读取、二进制文件检测、大文件限制。',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: '文件路径（相对于工作区根目录）' },
						start_line: { type: 'number', description: '起始行号（可选，从1开始）' },
						end_line: { type: 'number', description: '结束行号（可选）' }
					},
					required: ['path']
				}
			},

			// 2. write_to_file - 写入文件
			{
				name: 'write_to_file',
				description: '创建新文件或完全覆盖现有文件。必须提供完整文件内容，不允许省略部分。',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: '文件路径' },
						content: { type: 'string', description: '完整文件内容（禁止使用"// 其余代码不变"等占位符）' },
						line_count: { type: 'number', description: '预期行数（可选，用于验证）' }
					},
					required: ['path', 'content']
				}
			},

			// 3. list_files - 列出文件
			{
				name: 'list_files',
				description: '列出目录中的文件和子目录。支持递归列出、.gitignore过滤。',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: '目录路径（默认为工作区根目录）' },
						recursive: { type: 'boolean', description: '是否递归列出子目录（默认false）' }
					},
					required: []
				}
			},

			// 4. execute_command - 执行命令
			{
				name: 'execute_command',
				description: '在终端执行命令。危险命令执行前应询问用户。',
				parameters: {
					type: 'object',
					properties: {
						command: { type: 'string', description: '要执行的命令' },
						cwd: { type: 'string', description: '工作目录（可选）' }
					},
					required: ['command']
				}
			},

			// 5. search_files - 搜索文件
			{
				name: 'search_files',
				description: '在文件中搜索文本或正则表达式模式。支持上下文显示、文件过滤。',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: '搜索路径（默认为工作区）' },
						regex: { type: 'string', description: '搜索模式（支持正则表达式）' },
						file_pattern: { type: 'string', description: '文件过滤模式（可选）' }
					},
					required: ['regex']
				}
			},

			// 6. codebase_search - 语义搜索
			{
				name: 'codebase_search',
				description: '语义搜索代码库。基于含义而非关键词查找相关代码，探索未知代码时必须优先使用。',
				parameters: {
					type: 'object',
					properties: {
						query: { type: 'string', description: '搜索查询（自然语言描述）' },
						path: { type: 'string', description: '搜索路径（可选）' },
						file_pattern: { type: 'string', description: '文件过滤模式（可选）' }
					},
					required: ['query']
				}
			},

			// 7. glob - Glob模式匹配
			{
				name: 'glob',
				description: '使用Glob模式匹配文件。支持通配符: * (匹配任意字符), ** (匹配任意层级目录), ? (匹配单个字符), [] (匹配字符集合)',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: '要搜索的目录路径' },
						file_pattern: { type: 'string', description: 'Glob模式，如 "**/*.ts" 匹配所有TypeScript文件' }
					},
					required: ['path', 'file_pattern']
				}
			},

			// 8. apply_diff - 应用差异
			{
				name: 'apply_diff',
				description: '使用SEARCH/REPLACE块精确编辑文件。SEARCH块必须与文件内容精确匹配（空格、缩进、换行符）。',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: '文件路径' },
						diff: { type: 'string', description: '一个或多个SEARCH/REPLACE块' }
					},
					required: ['path', 'diff']
				}
			},

			// 9. edit_file - 编辑文件（查找替换）
			{
				name: 'edit_file',
				description: '编辑文件内容（查找替换）。oldText要足够独特以准确匹配。',
				parameters: {
					type: 'object',
					properties: {
						target_file: { type: 'string', description: '文件路径' },
						instructions: { type: 'string', description: '编辑说明' },
						code_edit: { type: 'string', description: '代码编辑内容' }
					},
					required: ['target_file', 'instructions', 'code_edit']
				}
			},

			// 10. insert_content - 插入内容
			{
				name: 'insert_content',
				description: '在文件的指定位置插入内容。不会覆盖现有内容，只插入。',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: '文件路径' },
						line: { type: 'string', description: '插入位置（行号，0表示文件末尾）' },
						content: { type: 'string', description: '要插入的内容' }
					},
					required: ['path', 'line', 'content']
				}
			},

			// 11. list_code_definition_names - 列出代码定义
			{
				name: 'list_code_definition_names',
				description: '列出代码文件中的定义（函数、类、方法等）。快速了解文件结构。',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: '代码文件路径' }
					},
					required: ['path']
				}
			},

			// 12. ask_followup_question - 提问
			{
				name: 'ask_followup_question',
				description: '向用户询问问题以获取更多信息。仅在真正需要时使用，问题要清晰、具体、可操作。',
				parameters: {
					type: 'object',
					properties: {
						question: { type: 'string', description: '要问的问题' },
						follow_up: { type: 'string', description: '后续行动（可选）' }
					},
					required: ['question']
				}
			},

			// 13. attempt_completion - 完成任务
			{
				name: 'attempt_completion',
				description: '完成任务并报告结果。任务真正完成时才使用，结果描述要清晰、完整，不要以问题结尾。',
				parameters: {
					type: 'object',
					properties: {
						result: { type: 'string', description: '任务完成的详细描述' }
					},
					required: ['result']
				}
			},

			// 14. new_task - 创建新任务
			{
				name: 'new_task',
				description: '创建新的子任务。将复杂任务分解为多个子任务时使用。',
				parameters: {
					type: 'object',
					properties: {
						mode: { type: 'string', description: '任务模式（可选）' },
						message: { type: 'string', description: '子任务描述' },
						todos: { type: 'string', description: '待办列表（可选）' }
					},
					required: ['message']
				}
			},

			// 15. update_todo_list - 更新待办列表
			{
				name: 'update_todo_list',
				description: '更新任务待办列表。跟踪任务进度、管理多个待办项。',
				parameters: {
					type: 'object',
					properties: {
						todos: { type: 'array', description: '待办事项列表' }
					},
					required: ['todos']
				}
			},

			// ==================== P0/P1 优化工具 ====================

			// 16. batch - 批量并行执行工具【重要：优先使用！】
			{
				name: 'batch',
				description: '【优先使用】批量并行执行多个独立的读取/搜索工具。当需要执行2个或更多read_file、search_files、glob、list_files、codebase_search操作时，必须使用batch而非逐个调用。性能提升2-5倍。示例：读取3个文件→使用batch一次完成，而非调用3次read_file。',
				parameters: {
					type: 'object',
					properties: {
						tool_calls: {
							type: 'array',
							description: '工具调用数组。格式：[{"tool":"read_file","parameters":{"path":"a.ts"}},{"tool":"read_file","parameters":{"path":"b.ts"}}]。最多10个。禁止：batch、apply_diff、write_to_file、execute_command',
							items: {
								type: 'object',
								properties: {
									tool: { type: 'string', description: '工具名称' },
									parameters: { type: 'object', description: '工具参数' }
								},
								required: ['tool', 'parameters']
							}
						}
					},
					required: ['tool_calls']
				}
			},

			// 17. edit - 容错字符串替换
			{
				name: 'edit',
				description: '基于old_string/new_string的容错字符串替换。支持9种匹配策略：精确匹配、行trim、首尾锚点、空白归一化、缩进灵活、转义处理、边界trim、上下文感知、多处匹配。',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: '要编辑的文件路径' },
						old_string: { type: 'string', description: '要被替换的原始内容（需与文件内容匹配）' },
						new_string: { type: 'string', description: '替换后的新内容' },
						replace_all: { type: 'boolean', description: '是否替换所有匹配项（默认false）' },
						create_if_missing: { type: 'boolean', description: '文件不存在时是否创建（默认false）' }
					},
					required: ['path', 'new_string']
				}
			},

			// 18. multiedit - 单文件多处编辑
			{
				name: 'multiedit',
				description: '在单个文件中执行多处编辑操作（原子性）。所有编辑要么全部成功，要么全部不执行。',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: '文件路径' },
						edits: {
							type: 'array',
							description: '编辑数组，每项包含 old_string, new_string, replace_all(可选)',
							items: {
								type: 'object',
								properties: {
									old_string: { type: 'string', description: '要被替换的内容' },
									new_string: { type: 'string', description: '替换后的内容' },
									replace_all: { type: 'boolean', description: '是否替换所有匹配' }
								},
								required: ['old_string', 'new_string']
							}
						}
					},
					required: ['path', 'edits']
				}
			},

			// 19. patch - 多文件批量操作
			{
				name: 'patch',
				description: '批量执行多文件操作：创建、修改、删除、重命名。适合重命名多个文件、创建多个新文件、批量修改文件。',
				parameters: {
					type: 'object',
					properties: {
						patches: {
							type: 'array',
							description: 'JSON数组，每项包含：action (create/modify/delete/rename), path, content(可选), new_path(rename时必需)',
							items: {
								type: 'object',
								properties: {
									action: { type: 'string', enum: ['create', 'modify', 'delete', 'rename'], description: '操作类型' },
									path: { type: 'string', description: '文件路径' },
									content: { type: 'string', description: '文件内容（create/modify时）' },
									new_path: { type: 'string', description: '新路径（rename时）' }
								},
								required: ['action', 'path']
							}
						}
					},
					required: ['patches']
				}
			},

			// 20. webfetch - 网页获取
			{
				name: 'webfetch',
				description: '获取网页内容并转换为Markdown格式。支持缓存、自动处理重定向。适合获取API文档、读取网页内容。',
				parameters: {
					type: 'object',
					properties: {
						url: { type: 'string', description: '要获取的网页URL' },
						useCache: { type: 'boolean', description: '是否使用缓存（默认true，15分钟有效）' },
						format: { type: 'string', enum: ['markdown', 'text', 'html'], description: '输出格式（默认markdown）' }
					},
					required: ['url']
				}
			},

			// 21. task - 子Agent委托
			{
				name: 'task',
				description: '将复杂任务委托给子Agent执行。适合独立的子任务、需要专门上下文的任务、分解复杂任务。',
				parameters: {
					type: 'object',
					properties: {
						prompt: { type: 'string', description: '任务描述（详细说明子Agent需要完成的工作）' },
						subagent_type: { type: 'string', enum: ['general-purpose', 'explore', 'plan'], description: '子Agent类型（可选，默认general-purpose）' }
					},
					required: ['prompt']
				}
			},

			// 22. lsp_hover - LSP悬停信息
			{
				name: 'lsp_hover',
				description: '获取代码位置的LSP悬停信息，包括类型、函数签名、文档等。',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: '文件路径' },
						line: { type: 'number', description: '行号（从1开始）' },
						column: { type: 'number', description: '列号（从1开始）' }
					},
					required: ['path', 'line', 'column']
				}
			},

			// 23. lsp_diagnostics - LSP诊断信息
			{
				name: 'lsp_diagnostics',
				description: '获取文件的LSP诊断信息，包括编译错误、类型错误、lint警告等。',
				parameters: {
					type: 'object',
					properties: {
						path: { type: 'string', description: '文件路径' }
					},
					required: ['path']
				}
			}
		];
	}

	/**
	 * 获取工具定义（根据当前模式过滤）
	 * 实现与Kilocode一致的模式-工具组限制
	 */
	private getToolDefinitions(): ToolDefinition[] {
		const mode = getModeBySlug(this.currentMode);
		if (!mode) {
			console.warn('[Maxian] 未找到模式配置:', this.currentMode, '返回所有工具');
			return this.getAllToolDefinitions();
		}

		// 获取当前模式允许使用的工具列表
		const allowedTools = getToolsForMode(mode.groups);
		console.log(`[Maxian] 模式 ${this.currentMode} 允许的工具:`, allowedTools);

		// 过滤工具定义
		const allTools = this.getAllToolDefinitions();
		const filteredTools = allTools.filter(tool => allowedTools.includes(tool.name));

		console.log(`[Maxian] 模式 ${this.currentMode} 实际提供的工具数量: ${filteredTools.length}/${allTools.length}`);

		return filteredTools;
	}

	async executeTool(toolUse: ToolUse): Promise<ToolResponse> {
		if (!this.toolExecutor) {
			await this.initialize();
		}

		if (!this.toolExecutor) {
			return '错误: 工具执行器未初始化';
		}

		return this.toolExecutor.executeTool(toolUse);
	}

	getAvailableTools(): ToolName[] {
		if (!this.toolExecutor) {
			return [];
		}

		// 获取工具执行器支持的所有工具
		const allTools = this.toolExecutor.getAvailableTools();

		// 根据当前模式过滤工具
		const mode = getModeBySlug(this.currentMode);
		if (!mode) {
			return allTools;
		}

		const allowedTools = getToolsForMode(mode.groups);
		return allTools.filter(tool => allowedTools.includes(tool));
	}

	getTaskStatus(): any {
		if (!this.currentTask) {
			return {
				status: TaskStatus.IDLE,
				taskId: null,
				availableTools: this.getAvailableTools().length,
				tokenUsage: null
			};
		}

		return {
			status: this.currentTask.status,
			taskId: this.currentTask.taskId,
			metadata: this.currentTask.metadata,
			availableTools: this.getAvailableTools().length,
			tokenUsage: this.currentTask.getTokenUsage(),
			toolUsage: this.currentTask.getToolUsage()
		};
	}

	submitUserResponse(response: string): void {
		if (!this.currentTask) {
			console.error('[Maxian] 无当前任务，无法提交用户回复');
			return;
		}
		console.log('[Maxian] 提交用户回复:', response);
		this.currentTask.resumeWithUserInput(response);
	}

	/**
	 * 处理Ask响应 - 新版本
	 */
	handleAskResponse(askTs: number, response: ClineAskResponse, text?: string, images?: string[]): void {
		if (!this.currentTask) {
			console.error('[Maxian] 无当前任务，无法提交ask响应');
			return;
		}
		console.log('[Maxian] 提交ask响应:', { askTs, response, text, images });
		this.currentTask.handleWebviewAskResponse(askTs, response, text, images);
	}

	/**
	 * 打开文件diff视图
	 */
	async openDiffView(filePath: string, newContent: string): Promise<boolean> {
		if (!this.diffViewProvider) {
			console.error('[Maxian] DiffViewProvider未初始化');
			return false;
		}
		return this.diffViewProvider.openDiff(filePath, newContent);
	}

	/**
	 * 应用SEARCH/REPLACE差异并打开diff视图
	 */
	async applyDiffView(filePath: string, diff: string): Promise<boolean> {
		if (!this.diffViewProvider) {
			console.error('[Maxian] DiffViewProvider未初始化');
			return false;
		}
		return this.diffViewProvider.applyDiff(filePath, diff);
	}

	/**
	 * 保存diff修改并关闭diff编辑器，打开修改后的文件
	 */
	async saveDiffAndClose(): Promise<boolean> {
		if (!this.diffViewProvider) {
			console.error('[Maxian] DiffViewProvider未初始化');
			return false;
		}
		return this.diffViewProvider.saveAndClose();
	}

	/**
	 * 关闭diff编辑器但不保存
	 */
	async closeDiffWithoutSave(): Promise<boolean> {
		if (!this.diffViewProvider) {
			console.error('[Maxian] DiffViewProvider未初始化');
			return false;
		}
		return this.diffViewProvider.closeWithoutSave();
	}

	/**
	 * 取消当前正在执行的任务
	 */
	cancelTask(): void {
		console.log('[Maxian] cancelTask 被调用, currentTask:', !!this.currentTask, ', currentTaskCancelled:', this.currentTaskCancelled, ', isAskModeRunning:', this.isAskModeRunning);

		// 如果任务已经被取消，直接返回，不做任何处理
		if (this.currentTaskCancelled) {
			console.log('[Maxian] 任务已被取消，忽略重复取消请求');
			return;
		}

		// 检查是否有TaskService任务在运行（code/architect/debug等模式）
		if (this.currentTask) {
			console.log('[Maxian] 取消当前TaskService任务');
			// 立即设置取消标志和重置currentTask，防止重复点击
			this.currentTaskCancelled = true;
			const task = this.currentTask;
			this.currentTask = null;
			task.abortTask(ClineApiReqCancelReason.UserCancelled);
			this._onTaskCancelled.fire();
			return;
		}

		// 检查是否有ask模式任务在运行
		if (this.isAskModeRunning && this.askModeAbortController && this.difyHandler) {
			console.log('[Maxian] 中止Ask模式任务');
			// 立即重置状态，防止重复点击
			this.isAskModeRunning = false;
			const controller = this.askModeAbortController;
			this.askModeAbortController = null;
			// 1. 调用Dify停止API（异步，不等待结果）
			this.difyHandler.stopCurrentTask().catch(err => {
				console.error('[Maxian] Dify停止API调用失败:', err);
			});
			// 2. 中止前端HTTP请求
			controller.abort();
			this._onTaskCancelled.fire();
			return;
		}

		// 没有正在执行的任务，不触发任何事件，不显示任何提示
		console.log('[Maxian] 没有正在执行的任务，忽略取消请求');
	}

	/**
	 * 清空对话历史
	 */
	clearConversation(): void {
		console.log('[Maxian] 清空对话历史');

		// 如果有正在执行的TaskService任务，先中止它
		if (this.currentTask) {
			this.currentTask.abortTask(ClineApiReqCancelReason.UserCancelled);
		}

		// 如果有正在执行的ask模式任务，先中止它
		if (this.isAskModeRunning && this.askModeAbortController) {
			this.askModeAbortController.abort();
		}

		// 重置当前任务
		this.currentTask = null;
		this.isAskModeRunning = false;
		this.askModeAbortController = null;

		// 触发对话清空事件
		this._onConversationCleared.fire();

		console.log('[Maxian] 对话历史已清空');
	}

	/**
	 * 重置ask模式的会话ID（不影响其他状态）
	 */
	resetAskConversation(): void {
		if (this.difyHandler) {
			this.difyHandler.resetConversation();
			console.log('[Maxian] Ask模式会话ID已重置');
		}
	}

	/**
	 * 生成追踪ID (UUID v4)
	 */
	private generateTraceId(): string {
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
			const r = Math.random() * 16 | 0;
			const v = c === 'x' ? r : (r & 0x3 | 0x8);
			return v.toString(16);
		});
	}

	/**
	 * 获取设备信息
	 */
	private getDeviceInfo(): any {
		let osType = 'unknown';
		let osVersion = '';

		if (isWindows) {
			osType = 'Windows';
			// 可以通过navigator.userAgent获取详细版本
			osVersion = navigator.userAgent.match(/Windows NT (\d+\.\d+)/)?.[1] || '';
		} else if (isMacintosh) {
			osType = 'macOS';
			osVersion = navigator.userAgent.match(/Mac OS X (\d+[_\.]\d+[_\.]\d+)/)?.[1]?.replace(/_/g, '.') || '';
		} else if (isLinux) {
			osType = 'Linux';
		}

		return {
			type: osType,
			id: '', // 可以生成设备ID
			name: '', // 可以获取计算机名
			osVersion: osVersion || osType
		};
	}

	/**
	 * 获取IDE信息
	 */
	private getIdeInfo(): any {
		// 从VSCode配置中获取版本信息
		return {
			type: 'vscode',
			version: '1.90.0', // 可以从vscode API获取
			pluginVersion: '1.0.0', // 插件版本
			projectName: this.workspaceContextService.getWorkspace().folders[0]?.name || ''
		};
	}

	/**
	 * 获取用户邮箱
	 */
	private getUserEmail(): string | undefined {
		const credentials = this.loadAuthCredentials();
		return credentials?.username; // username通常是邮箱
	}

	/**
	 * 记录AI调用日志
	 */
	private async logAICall(options: {
		inputTokens?: number;
		outputTokens?: number;
		status: 'success' | 'failed' | 'aborted';
		errorMessage?: string;
		requestSummary?: string;
		responseSummary?: string;
	}): Promise<void> {
		if (!this.currentTraceId || !this.currentCallStartTime) {
			console.warn('[Maxian] 无法记录AI调用日志：缺少TraceId或开始时间');
			return;
		}

		try {
			const endTime = new Date();
			const durationMs = endTime.getTime() - this.currentCallStartTime.getTime();

			// 计算首Token耗时
			let firstTokenMs: number | undefined;
			if (this.currentFirstTokenTime) {
				firstTokenMs = this.currentFirstTokenTime.getTime() - this.currentCallStartTime.getTime();
			}

			// 获取provider和model信息
			let provider = 'qwen'; // 默认提供商
			let model = 'qwen-turbo';

			// 根据当前模式获取provider和model
			if (this.currentMode === 'ask' && this.difyHandler) {
				provider = 'dify';
				model = 'dify-workflow';
			} else if (this.apiHandler) {
				const modelInfo = this.apiHandler.getModel();
				model = modelInfo.id;
				// ModelInfo没有provider字段,使用默认值
				provider = 'qwen';
			}

			// 获取知识库信息(仅ask模式)
			let knowledgeBaseInfo: any = undefined;
			if (this.currentMode === 'ask' && this.currentKnowledgeBaseConfig) {
				knowledgeBaseInfo = {
					id: this.currentKnowledgeBaseConfig.id ? parseInt(this.currentKnowledgeBaseConfig.id) : undefined,
					name: this.currentKnowledgeBaseConfig.name,
					type: 'dify'  // 知识库类型
				};
			}

			// 构建日志数据
			const logData = {
				traceId: this.currentTraceId,
				userEmail: this.getUserEmail(),
				deviceInfo: this.getDeviceInfo(),
				ideInfo: this.getIdeInfo(),
				knowledgeBaseInfo: knowledgeBaseInfo,
				provider: provider,
				model: model,
				operation: 'chat',
				mode: this.currentMode,
				inputTokens: options.inputTokens,
				outputTokens: options.outputTokens,
				durationMs: durationMs,
				firstTokenMs: firstTokenMs,
				status: options.status,
				errorMessage: options.errorMessage,
				requestSummary: options.requestSummary,
				responseSummary: options.responseSummary,
				startTime: this.currentCallStartTime,
				endTime: endTime
			};

			console.log('[Maxian] 记录AI调用日志:', {
				traceId: logData.traceId,
				mode: logData.mode,
				status: logData.status,
				durationMs: logData.durationMs,
				tokens: {
					input: logData.inputTokens,
					output: logData.outputTokens
				}
			});

			// 调用日志服务
			await this.aiLogService.logAICall(logData);

		} catch (error) {
			console.error('[Maxian] 记录AI调用日志失败:', error);
			// 不抛出错误，避免影响正常功能
		}
	}

	// ========== 自动批准规则管理 ==========

	/**
	 * 设置工具自动批准规则
	 */
	setToolAutoApprove(toolName: string, autoApprove: boolean): void {
		if (autoApprove) {
			this.autoApprovedTools.add(toolName);
			console.log(`[Maxian] 工具 "${toolName}" 已设置为自动批准`);
		} else {
			this.autoApprovedTools.delete(toolName);
			console.log(`[Maxian] 工具 "${toolName}" 已取消自动批准`);
		}
	}

	/**
	 * 检查工具是否设置为自动批准
	 */
	isToolAutoApproved(toolName: string): boolean {
		return this.autoApprovedTools.has(toolName) || this.autoApprovedTools.has('*');
	}

	/**
	 * 设置命令自动批准规则
	 */
	setCommandAutoApprove(command: string, autoApprove: boolean): void {
		if (autoApprove) {
			this.autoApprovedCommands.add(command);
			console.log(`[Maxian] 命令 "${command}" 已设置为自动批准`);
		} else {
			this.autoApprovedCommands.delete(command);
			console.log(`[Maxian] 命令 "${command}" 已取消自动批准`);
		}
	}

	/**
	 * 检查命令是否设置为自动批准
	 */
	isCommandAutoApproved(command: string): boolean {
		// 检查通配符 * 或精确匹配
		if (this.autoApprovedCommands.has('*')) {
			return true;
		}
		return this.autoApprovedCommands.has(command);
	}

	/**
	 * 获取所有自动批准规则
	 */
	getAutoApproveRules(): { tools: string[]; commands: string[] } {
		return {
			tools: Array.from(this.autoApprovedTools),
			commands: Array.from(this.autoApprovedCommands)
		};
	}

	/**
	 * 清除所有自动批准规则
	 */
	clearAutoApproveRules(): void {
		this.autoApprovedTools.clear();
		this.autoApprovedCommands.clear();
		console.log('[Maxian] 所有自动批准规则已清除');
	}

	/**
	 * 判断是否应该生成RepoMap
	 * 策略：首次使用或有文件修改时重新生成
	 */
	private shouldGenerateRepoMap(recentlyModifiedFiles: string[]): boolean {
		// 1. 首次生成
		if (!this.lastRepoMap) {
			return true;
		}

		// 2. 有文件修改（重新生成以反映最新代码结构）
		if (recentlyModifiedFiles.length > 0) {
			return true;
		}

		// 3. 距离上次生成超过5分钟（避免过于频繁）
		const now = Date.now();
		if (now - this.lastRepoMapTime > 5 * 60 * 1000) {
			return true;
		}

		// 使用缓存
		return false;
	}

	/**
	 * 生成RepoMap
	 */
	private async generateRepoMap(workspaceRoot: string): Promise<string> {
		if (!this.repoMapService) {
			return '';
		}

		try {
			console.log('[Maxian] 开始生成RepoMap...');
			const startTime = Date.now();

			// 1. 获取工作区中的所有代码文件
			const allFiles = await this.repoMapService.getWorkspaceCodeFiles(workspaceRoot);

			// 2. 准备上下文（首次生成时chatFiles为空）
			const context: IRepoMapContext = {
				chatFiles: [],  // TODO: 后续可以从任务历史中提取
				otherFiles: allFiles,
				mentionedFiles: [],  // TODO: 从用户消息中提取
				mentionedIdents: [], // TODO: 从用户消息中提取
				tokenBudget: 2048
			};

			// 3. 生成RepoMap
			const repoMap = await this.repoMapService.generateRanked(context);

			const endTime = Date.now();
			console.log(`[Maxian] RepoMap生成完成，耗时 ${endTime - startTime}ms，长度 ${repoMap.length} 字符`);

			// 4. 更新缓存时间
			this.lastRepoMap = repoMap;
			this.lastRepoMapTime = Date.now();

			return repoMap;
		} catch (error) {
			console.error('[Maxian] RepoMap生成失败:', error);
			return '';
		}
	}

	override dispose(): void {
		console.log('[Maxian] 码弦服务正在销毁');
		super.dispose();
	}
}

