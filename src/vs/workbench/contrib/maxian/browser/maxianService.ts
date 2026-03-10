/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { ITerminalProfileService } from '../../terminal/common/terminal.js';
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
import { URI } from '../../../../base/common/uri.js';
import { basename, relative } from '../../../../base/common/path.js';
import { QueryType } from '../../../services/search/common/search.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { ISkillService } from '../../skills/common/skillService.js';
import { ILspDiagnosticsService, globalLspDiagnosticsHandler, DiagnosticSeverity } from '../common/lsp/lspDiagnostics.js';
import { ILspHoverService, globalLspHoverHandler } from '../common/lsp/lspHover.js';
import { ILspDefinitionService, globalLspDefinitionHandler } from '../common/lsp/lspDefinition.js';
import { ILspReferencesService, globalLspReferencesHandler } from '../common/lsp/lspReferences.js';
import { ILspTypeDefinitionService, globalLspTypeDefinitionHandler } from '../common/lsp/lspTypeDefinition.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { AutoDiagnosticInjector, IDiagnosticInjectionEvent } from './lspIntegration/AutoDiagnosticInjector.js';
import { SteeringService } from '../common/steering/SteeringService.js';
import { ICommandExecutionService } from '../common/services/commandExecutionService.js';
import { FilteredToolExecutor } from '../common/tools/filteredToolExecutor.js';
import { ITodoItem as ITodoStoreItem } from '../common/tools/todoStore.js';
import { EXPLORE_AGENT_TOOLS, PLAN_AGENT_TOOLS, EXECUTE_AGENT_TOOLS } from '../common/agents/AgentTypes.js';
import { initOutputTruncation } from '../common/utils/outputTruncation.js';

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
 * 工具完成事件
 * 用于更新工具执行状态（从运行中到完成）
 */
export interface IToolCompletedEvent {
	toolId: string;            // 工具调用ID
	toolName: string;          // 工具名称
	isError: boolean;          // 是否执行出错
}

/**
 * 任务列表事件（待办事项更新）
 */
export interface ITodoListEvent {
	todos: ITodoItem[];        // 任务列表
}

/**
 * 任务项
 */
export interface ITodoItem {
	content: string;           // 任务内容
	status: 'pending' | 'in_progress' | 'completed';  // 任务状态
	activeForm: string;        // 进行中状态的描述文本
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
	 * 工具完成事件
	 * （工具执行完成时触发，用于更新UI状态）
	 */
	readonly onToolCompleted: Event<IToolCompletedEvent>;

	/**
	 * 任务列表更新事件
	 * （todowrite工具更新任务列表时触发）
	 */
	readonly onTodoListUpdate: Event<ITodoListEvent>;

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

	/**
	 * 获取工作区文件列表（用于@mention自动完成）
	 * @param query 搜索关键词（过滤文件名/路径）
	 * @returns 匹配的相对文件路径列表
	 */
	getWorkspaceFiles(query: string): Promise<string[]>;

	/** 获取工作区根目录路径 */
	getWorkspaceRoot(): string;

	/** 读取工作区内文件的文本内容（相对路径，最多 maxLines 行） */
	readWorkspaceFile(relativePath: string, maxLines?: number): Promise<{ content: string; totalLines: number } | null>;

	// ====== 快捷键触发事件（由 VSCode 命令系统触发，视图响应） ======

	/** 触发发送消息（由 maxian.sendMessage 命令触发） */
	readonly onTriggerSend: Event<void>;
	/** 触发换行（由 maxian.newLine 命令触发） */
	readonly onTriggerNewLine: Event<void>;
	/** 触发打开码弦面板（由 maxian.openView 命令触发） */
	readonly onTriggerOpenView: Event<void>;
	/** 触发停止生成（由 maxian.stopGeneration 命令触发） */
	readonly onTriggerStopGeneration: Event<void>;
	/** 触发清空对话（由 maxian.clearConversation 命令触发） */
	readonly onTriggerClearConversation: Event<void>;

	triggerSend(): void;
	triggerNewLine(): void;
	triggerOpenView(): void;
	triggerStopGeneration(): void;
	triggerClearConversation(): void;
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

	private readonly _onToolCompleted = this._register(new Emitter<IToolCompletedEvent>());
	readonly onToolCompleted: Event<IToolCompletedEvent> = this._onToolCompleted.event;

	private readonly _onTodoListUpdate = this._register(new Emitter<ITodoListEvent>());
	readonly onTodoListUpdate: Event<ITodoListEvent> = this._onTodoListUpdate.event;

	private readonly _onTriggerSend = this._register(new Emitter<void>());
	readonly onTriggerSend: Event<void> = this._onTriggerSend.event;

	private readonly _onTriggerNewLine = this._register(new Emitter<void>());
	readonly onTriggerNewLine: Event<void> = this._onTriggerNewLine.event;

	private readonly _onTriggerOpenView = this._register(new Emitter<void>());
	readonly onTriggerOpenView: Event<void> = this._onTriggerOpenView.event;

	private readonly _onTriggerStopGeneration = this._register(new Emitter<void>());
	readonly onTriggerStopGeneration: Event<void> = this._onTriggerStopGeneration.event;

	private readonly _onTriggerClearConversation = this._register(new Emitter<void>());
	readonly onTriggerClearConversation: Event<void> = this._onTriggerClearConversation.event;

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

	// 🚀 系统提示词缓存（P0优化：减少重复生成）
	private cachedSystemPrompt: string | null = null;
	private cachedSystemPromptKey: string | null = null; // 缓存键：workspaceRoot + mode + toolCount
	private readonly SYSTEM_PROMPT_CACHE_TTL = 5 * 60 * 1000; // 5分钟TTL
	private cachedSystemPromptTime: number = 0;

	// 🚀 认证凭据缓存（P1优化：避免每次从StorageService读取）
	private _cachedCredentials: { username: string; password: string } | null | undefined = undefined;

	// 🔧 自动诊断注入器（Task #18 - LSP自动诊断注入）
	private autoDiagnosticInjector: AutoDiagnosticInjector | null = null;
	private currentDiagnosticText: string | null = null;

	// 📋 Steering 服务（P1优化 - 项目/团队级别规范注入）
	private steeringService: SteeringService | null = null;

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
		@IRepoMapService private readonly _repoMapService: IRepoMapService,
		@IAIService private readonly aiService: IAIService,
		@ISkillService private readonly skillService: ISkillService,
		@ILspDiagnosticsService private readonly lspDiagnosticsService: ILspDiagnosticsService,
		@ILspHoverService private readonly lspHoverService: ILspHoverService,
		@ILspDefinitionService private readonly lspDefinitionService: ILspDefinitionService,
		@ILspReferencesService private readonly lspReferencesService: ILspReferencesService,
		@ILspTypeDefinitionService private readonly lspTypeDefinitionService: ILspTypeDefinitionService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@ITerminalProfileService private readonly terminalProfileService: ITerminalProfileService,
		@ICommandExecutionService private readonly commandExecutionService: ICommandExecutionService
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
	
		// 🔧 初始化所有LSP服务
		globalLspDiagnosticsHandler.setService(this.lspDiagnosticsService);
		globalLspHoverHandler.setService(this.lspHoverService);
		globalLspDefinitionHandler.setService(this.lspDefinitionService);
		globalLspReferencesHandler.setService(this.lspReferencesService);
		globalLspTypeDefinitionHandler.setService(this.lspTypeDefinitionService);

		// 🔧 初始化自动诊断注入器（Task #18）
		this.autoDiagnosticInjector = this._register(
			new AutoDiagnosticInjector(
				this.textFileService,
				this.workspaceContextService,
				this.lspDiagnosticsService,
				{
					enabled: true, // 默认启用
					autoFetchOnSave: true,
					fetchDelay: 200,
					criticalErrorsOnly: false,
					watcherOptions: {
						debounceDelay: 300,
						workspaceOnly: true,
						extensionFilter: [], // 不限制文件类型
					},
					formatterOptions: {
						includeSeverities: [DiagnosticSeverity.Error, DiagnosticSeverity.Warning], // Error and Warning
						maxCount: 10,
						includeSuggestions: true,
					},
					cacheDuration: 5000,
				}
			)
		);

		// 订阅诊断就绪事件
		this._register(
			this.autoDiagnosticInjector.onDiagnosticReady((event: IDiagnosticInjectionEvent) => {
				this.currentDiagnosticText = event.formattedText;
			})
		);

		// 订阅诊断清除事件
		this._register(
			this.autoDiagnosticInjector.onDiagnosticCleared(() => {
				this.currentDiagnosticText = null;
				})
		);


		// 🔥 不再加载自动批准规则，"始终允许"仅针对单个任务会话，不持久化
		// this.loadAutoApproveRules();
	}

	/**
	 * 从StorageService加载认证凭据
	 * 使用与authService相同的存储key
	 */
	private loadAuthCredentials(): { username: string; password: string } | undefined {
		// 实例级缓存：undefined 表示未加载，null 表示加载但未找到
		if (this._cachedCredentials !== undefined) {
			return this._cachedCredentials ?? undefined;
		}
		try {
			const stored = this.storageService.get('zhikai.auth.credentials', StorageScope.APPLICATION);
			if (!stored) {
				this._cachedCredentials = null;
				return undefined;
			}

			const parsed = JSON.parse(stored);
			if (parsed && parsed.username && parsed.password) {
				this._cachedCredentials = { username: parsed.username, password: parsed.password };
				return this._cachedCredentials;
			}

			this._cachedCredentials = null;
			return undefined;
		} catch (error) {
			console.error('[Maxian] 加载认证凭据失败:', error);
			this._cachedCredentials = null;
			return undefined;
		}
	}

	/**
	 * 重置认证凭据缓存（凭据变更时调用）
	 */
	public invalidateCredentialsCache(): void {
		this._cachedCredentials = undefined;
	}

	async initialize(): Promise<void> {
		if (this._initialized) {
			return;
		}

		console.log('[Maxian] 码弦服务初始化...');

		// 工作区变更时清除文件列表缓存
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => {
			this._workspaceFileCache = null;
		}));

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
				workspaceRoot: workspaceRoot,
				// P2优化：注入 todo 更新回调，将 toolExecutor 的 todo 更新转发到 UI
				onTodoListUpdate: (todos: ITodoStoreItem[]) => {
					// 将 todoStore.ITodoItem 转换为 maxianService.ITodoItem（UI 格式）
					const uiTodos: ITodoItem[] = todos.map(t => ({
						content: t.content,
						status: t.status,
						activeForm: t.status === 'in_progress' ? t.content : ''
					}));
					this._onTodoListUpdate.fire({ todos: uiTodos });
				}
			},
			this.skillService,
			this.commandExecutionService
		);

		// P2优化：注入子 Agent 工厂（支持 task 工具）
		(this.toolExecutor as ToolExecutorImpl).setSubAgentRunner(
			async (agentType: string, prompt: string, taskId?: string, taskToolId?: string): Promise<string> => {
				return this.runSubAgent(agentType, prompt, workspaceRoot, taskToolId);
			}
		);


		// P1优化：并行初始化 RepoMapService 和 SteeringService
		if (workspaceRoot) {
			this.repoMapService = this._repoMapService;
			this.steeringService = new SteeringService(workspaceRoot, this.fileService);
			await Promise.all([
				this.repoMapService.initialize(workspaceRoot),
				this.steeringService.initialize()
			]);
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

		// 启动截断文件定期清理（7天保留期，每小时清理一次）
		initOutputTruncation();

		this._initialized = true;
		console.log('[Maxian] 码弦服务初始化完成');
	}

	async sendMessage(message: string, mode: Mode = DEFAULT_MODE, knowledgeBaseConfig?: IKnowledgeBaseConfig): Promise<void> {

		// 更新当前模式
		this.currentMode = mode;

		// 生成新的TraceId和记录开始时间
		this.currentTraceId = this.generateTraceId();
		this.currentCallStartTime = new Date();
		this.currentFirstTokenTime = null;
		this.currentKnowledgeBaseConfig = knowledgeBaseConfig || null;


		// 确保已初始化
		if (!this._initialized) {
			await this.initialize();
		}

		// 触发用户消息事件（显示原始消息，含@mention标记）
		this._onMessage.fire({
			type: 'user',
			content: message
		});

		// 解析 @文件引用，将文件内容注入到发给AI的消息中
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		const workspaceRoot = workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : '';
		const resolvedMessage = workspaceRoot ? await this.resolveAtMentionedFiles(message, workspaceRoot) : message;
		if (resolvedMessage !== message) {
		}

		// 根据模式选择不同的处理方式
		if (mode === 'ask') {
			// ask 模式：使用 DifyHandler 调用知识库接口
			await this.sendDifyMessage(resolvedMessage, knowledgeBaseConfig);
		} else {
			// 其他模式：使用 TaskService 进行完整的任务处理
			await this.sendTaskMessage(resolvedMessage);
		}
	}

	/**
	 * 解析消息中的 @文件引用，读取文件内容并注入到消息中
	 * 使用 IFileService（兼容渲染进程，无需 Node.js fs 模块）
	 */
	private async resolveAtMentionedFiles(message: string, workspaceRoot: string): Promise<string> {
		// 匹配 @filepath 模式（不含空格，允许路径分隔符和文件扩展名）
		const atMentionRegex = /@([^\s@，。？！]+)/g;
		const matches = [...message.matchAll(atMentionRegex)];

		if (matches.length === 0) return message;

		const workspaceRootUri = URI.file(workspaceRoot);
		const processedUris = new Set<string>();
		const MAX_SINGLE_FILE_SIZE = 100 * 1024; // 100KB per file
		const MAX_TOTAL_SIZE = 500 * 1024; // 500KB total

		// 去重并构建 URI 列表
		type FileEntry = { fileUri: URI; relativePath: string };
		const fileEntries: FileEntry[] = [];
		for (const match of matches) {
			const mentionedPath = match[1];
			let fileUri: URI;
			let relativePath: string;
			if (mentionedPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(mentionedPath)) {
				fileUri = URI.file(mentionedPath);
				const uriPathStr = fileUri.path;
				const rootPathStr = workspaceRootUri.path;
				relativePath = uriPathStr.startsWith(rootPathStr)
					? uriPathStr.slice(rootPathStr.length + 1)
					: mentionedPath;
			} else {
				relativePath = mentionedPath;
				fileUri = URI.joinPath(workspaceRootUri, mentionedPath);
			}
			const uriKey = fileUri.toString();
			if (processedUris.has(uriKey)) continue;
			processedUris.add(uriKey);
			fileEntries.push({ fileUri, relativePath });
		}

		// 并行读取所有 @mention 文件
		const readResults = await Promise.all(fileEntries.map(async ({ fileUri, relativePath }) => {
			try {
				const content = await this.fileService.readFile(fileUri);
				const text = content.value.toString();
				const ext = basename(relativePath).split('.').pop() || 'txt';
				return { relativePath, ext, text, error: null };
			} catch (e) {
				console.warn('[Maxian] @mention 文件读取失败:', fileUri.toString(), e);
				return { relativePath, ext: '', text: '', error: e };
			}
		}));

		// 组合结果（限制总大小）
		let fileContentsBlock = '';
		let totalSize = 0;
		for (const result of readResults) {
			if (result.error || !result.text) continue;
			if (totalSize >= MAX_TOTAL_SIZE) break;
			const text = result.text.length > MAX_SINGLE_FILE_SIZE
				? result.text.substring(0, MAX_SINGLE_FILE_SIZE) + '\n// ... [文件过大，已截断]'
				: result.text;
			fileContentsBlock += `\n<file_content path="${result.relativePath}">\n\`\`\`${result.ext}\n${text}\n\`\`\`\n</file_content>\n`;
			totalSize += text.length;
		}

		if (fileContentsBlock) {
			return message + '\n\n以下是你引用的文件内容：' + fileContentsBlock;
		}

		return message;
	}

	/**
	 * 获取工作区文件列表（用于@mention自动完成）
	 * 使用 IFileService.resolve() 递归扫描，兼容渲染进程（无需 Node.js fs 模块）
	 * @param query 搜索关键词
	 */
	getWorkspaceRoot(): string {
		const folders = this.workspaceContextService.getWorkspace().folders;
		return folders.length > 0 ? folders[0].uri.fsPath : '';
	}

	async readWorkspaceFile(relativePath: string, maxLines: number = 100): Promise<{ content: string; totalLines: number } | null> {
		const root = this.getWorkspaceRoot();
		if (!root) return null;
		try {
			const uri = URI.file(root + '/' + relativePath);
			const content = await this.fileService.readFile(uri);
			const text = content.value.toString();
			const allLines = text.split('\n');
			const totalLines = allLines.length;
			const preview = allLines.slice(0, maxLines).join('\n');
			return { content: preview, totalLines };
		} catch {
			return null;
		}
	}

	// @mention 文件列表缓存（避免每次输入都重复扫描）
	private _workspaceFileCache: { files: string[]; timestamp: number } | null = null;
	private readonly _workspaceFileCacheTTL = 10_000; // 10秒

	async getWorkspaceFiles(query: string): Promise<string[]> {
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		if (workspaceFolders.length === 0) return [];

		// 先从缓存取全量列表，再在客户端过滤
		let allFiles = this._workspaceFileCache && (Date.now() - this._workspaceFileCache.timestamp < this._workspaceFileCacheTTL)
			? this._workspaceFileCache.files
			: null;

		if (!allFiles) {
			allFiles = await this._fetchAllWorkspaceFiles(workspaceFolders);
			this._workspaceFileCache = { files: allFiles, timestamp: Date.now() };
		}

		console.log('[MaxianService] getWorkspaceFiles query:', query, 'cache size:', allFiles.length);

		if (!query) {
			return allFiles.slice(0, 200);
		}

		// 客户端大小写不敏感过滤：文件名或路径包含 query 即可
		const lowerQuery = query.toLowerCase();
		const matched = allFiles.filter(p => {
			const lowerPath = p.toLowerCase();
			return lowerPath.includes(lowerQuery);
		});

		console.log('[MaxianService] getWorkspaceFiles matched:', matched.length, 'for query:', query);

		// 排序：文件名前缀匹配优先，再按路径长度升序
		matched.sort((a, b) => {
			const aName = basename(a).toLowerCase();
			const bName = basename(b).toLowerCase();
			const aPrefix = aName.startsWith(lowerQuery) ? 0 : 1;
			const bPrefix = bName.startsWith(lowerQuery) ? 0 : 1;
			if (aPrefix !== bPrefix) return aPrefix - bPrefix;
			return a.length - b.length;
		});

		return matched.slice(0, 200);
	}

	private async _fetchAllWorkspaceFiles(workspaceFolders: readonly { uri: URI }[]): Promise<string[]> {
		const cts = new CancellationTokenSource();
		const timeout = setTimeout(() => cts.cancel(), 8000);

		try {
			const allResults: string[] = [];

			console.log('[MaxianService] _fetchAllWorkspaceFiles folders:', workspaceFolders.map(f => f.uri.fsPath));

			for (const folder of workspaceFolders) {
				const folderUri = folder.uri;
				const folderFsPath = folderUri.fsPath;

				// filePattern 为空字符串 → ripgrep 返回所有文件
				const result = await this.searchService.fileSearch({
					type: QueryType.File,
					filePattern: '',
					folderQueries: [{
						folder: folderUri,
						excludePattern: [{
							pattern: {
								'**/node_modules/**': true,
								'**/.git/**': true,
								'**/dist/**': true,
								'**/out/**': true,
								'**/build/**': true,
								'**/.next/**': true,
								'**/__pycache__/**': true,
								'**/.venv/**': true,
								'**/venv/**': true,
								'**/coverage/**': true,
								'**/.idea/**': true,
								'**/.vscode/**': true,
								'**/*.class': true,
								'**/*.jar': true,
							}
						}]
					}],
					maxResults: 2000
				}, cts.token);

				console.log('[MaxianService] fileSearch result:', result?.results?.length ?? 'null', 'files for folder:', folderFsPath);

				if (!result || !result.results) continue;

				for (const r of result.results) {
					const fsPath = r.resource.fsPath;
					const relativePath = relative(folderFsPath, fsPath).replace(/\\/g, '/');
					if (!relativePath.startsWith('..')) {
						allResults.push(relativePath);
					}
				}
			}

			// 按路径长度升序（浅层文件优先）
			allResults.sort((a, b) => a.length - b.length);
			console.log('[MaxianService] _fetchAllWorkspaceFiles total:', allResults.length, 'sample:', allResults.slice(0, 5));
			return allResults;
		} catch (e) {
			console.error('[MaxianService] _fetchAllWorkspaceFiles error:', e);
			return [];
		} finally {
			clearTimeout(timeout);
			cts.dispose();
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
				} else {
				}
			} else {
				// 未选择知识库，提示用户
				console.error('[Maxian] 未选择知识库');
				this._onMessage.fire({
					type: 'error',
					content: '请先选择一个知识库。如果知识库列表为空，请检查是否已登录。'
				});
				return;
			}


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


		} catch (error) {
			// 检查是否是中止导致的错误
			if (this.askModeAbortController?.signal.aborted) {
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

			// 1. 同步提取关键词（零延迟，无需AI调用）
			// 这些关键词会作为 mentionedIdents 传入 RepoMap，使 PageRank 个性化排序，
			// 让相关文件浮到顶部，预加载命中正确文件，减少 AI 的探索轮数
			const keywords = this.extractKeywordsSync(message);

			// 2. 生成 RepoMap（传入关键词，个性化PageRank排序）
			let repoMap = '';
			if (this.repoMapService && this.shouldGenerateRepoMap(recentlyModifiedFiles)) {
				repoMap = await this.generateRepoMap(workspaceRoot, keywords);
			} else if (this.lastRepoMap) {
				repoMap = this.lastRepoMap;
			}


			// 🚀 使用已翻译的关键词进行预加载（此时 RepoMap 已就绪）
			let preloadedCode = '';
			if (repoMap && keywords.length > 0) {
				// 使用已翻译的关键词，跳过再次翻译
				preloadedCode = await this.smartPreloadCodeWithKeywords(message, repoMap, workspaceRoot, keywords);
			} else if (repoMap) {
				// 如果关键词提取失败，使用备用方案
				preloadedCode = await this.smartPreloadCode(message, repoMap, workspaceRoot);
			}

			// 组合完整消息
			const messageParts = [message];
			if (environmentDetails) {
				messageParts.push(environmentDetails);
			}
			if (repoMap) {
				messageParts.push(repoMap);
			}
			// 🚀 将预加载的代码放在最后，这样AI会优先看到
			if (preloadedCode) {
				messageParts.push(preloadedCode);
			}
			const fullMessage = messageParts.join('\n\n');


			// 创建新的TaskService实例，并重置取消标志
			this.currentTaskCancelled = false;

			// 🔥 新任务开始时清除自动批准设置（始终允许是针对单个任务的）
			this.clearAutoApproveRules();

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
					// 🔥 任务完成，清除自动批准设置
					this.clearAutoApproveRules();
					// 任务结束后重置currentTask，避免取消按钮误触发
					this.currentTask = null;
				} else if (status === TaskStatus.ERROR) {
					// 仅对真正的错误显示错误提示，中止时静默处理
					this._onMessage.fire({
						type: 'error',
						content: '任务错误'
					});
					// 🔥 任务错误，清除自动批准设置
					this.clearAutoApproveRules();
					// 任务结束后重置currentTask，避免取消按钮误触发
					this.currentTask = null;
				} else if (status === TaskStatus.ABORTED) {
					// ABORTED状态静默处理，不显示任何提示
					// 🔥 任务中止，清除自动批准设置
					this.clearAutoApproveRules();
					// 任务结束后重置currentTask，避免取消按钮误触发
					this.currentTask = null;
				}
			});
			this._register(statusChangedDisposable);

			const messageAddedDisposable = this.currentTask.onMessageAdded(clineMessage => {

				// 发送完整的ClineMessage（新版本）
				this._onClineMessage.fire({ message: clineMessage });

				// 🔧 仅转发 error 类型到旧版IMessageEvent（向后兼容）
				// say='text' 不再重复发送：流式内容已经通过 onStreamChunk -> _onMessage 实时渲染
				// 完整消息通过 _onClineMessage -> renderTextMessage 处理（会自动替换流式气泡）
				// 重复发送会导致 renderTextMessage 累积已有内容导致内容翻倍，以及多余气泡出现
				if (clineMessage.type === 'say') {
					if (clineMessage.say === 'error') {
						this._onMessage.fire({
							type: 'error',
							content: clineMessage.text || '未知错误'
						});
					}
					// text/completion_result 只通过新版 ClineMessage 路径处理，避免重复渲染
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
				}
			});
			this._register(tokenUsageDisposable);

			// 监听用户输入请求
			const userInputDisposable = this.currentTask.onUserInputRequired(({ question, toolUseId }) => {
				this._onQuestionAsked.fire({ question, toolUseId });
			});
			this._register(userInputDisposable);

			// 监听步骤更新事件，转发到任务进度事件
			const stepUpdatedDisposable = this.currentTask.onStepUpdated((stepInfo) => {

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
				this._onToolInputStreaming.fire({
					toolId: event.toolId,
					toolName: event.toolName,
					input: event.input,
					isPartial: event.isPartial
				});
			});
			this._register(toolInputStreamingDisposable);

			// 监听工具完成事件，转发到UI
			const toolCompletedDisposable = this.currentTask.onToolCompleted((event) => {
				this._onToolCompleted.fire({
					toolId: event.toolId,
					toolName: event.toolName,
					isError: event.isError
				});
			});
			this._register(toolCompletedDisposable);

			// 监听任务列表更新事件，转发到UI
			const todoListUpdatedDisposable = this.currentTask.onTodoListUpdated((event) => {
				this._onTodoListUpdate.fire({
					todos: event.todos
				});
			});
			this._register(todoListUpdatedDisposable);

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
		let shell: string;

		if (isWindows) {
			platform = 'win32';
		} else if (isMacintosh) {
			platform = 'darwin';
		} else if (isLinux) {
			platform = 'linux';
		}

		// 读取用户实际配置的 Shell（与 Cline/Roo-Code 一致）
		// 优先从 ITerminalProfileService 获取默认 profile 名称
		let shellPath: string | undefined;
		try {
			const defaultProfileName = this.terminalProfileService.getDefaultProfileName();
			const defaultProfile = this.terminalProfileService.getDefaultProfile();

			if (defaultProfile?.path) {
				shellPath = defaultProfile.path;
				// 取路径最后一个文件名，如 powershell.exe → powershell, /bin/zsh → zsh
				const shellName = shellPath.split(/[\\/]/).pop()?.replace(/\.exe$/i, '') || shellPath;
				shell = shellName;
			} else if (defaultProfileName) {
				shell = defaultProfileName;
			} else {
				// fallback：根据平台给出默认值
				shell = isWindows ? 'PowerShell' : isMacintosh ? 'zsh' : 'bash';
			}
		} catch {
			shell = isWindows ? 'PowerShell' : isMacintosh ? 'zsh' : 'bash';
		}

		// Home Directory（参考 Cline，帮助模型正确处理 ~ 路径）
		let homeDir: string | undefined;
		try {
			if (typeof process !== 'undefined' && process.env) {
				homeDir = process.env['HOME'] || process.env['USERPROFILE'] || process.env['HOMEPATH'];
			}
		} catch {
			// ignore
		}

		// 架构信息（从 navigator.userAgent 推断）
		const arch = (typeof navigator !== 'undefined' && navigator.userAgent.includes('arm')) ? 'arm64' : 'x64';

		// Node版本（VSCode内置的Node版本）
		const nodeVersion = (typeof process !== 'undefined' && process.version) ? process.version : 'v18.x';

		return {
			platform,
			arch,
			nodeVersion,
			shell,
			shellPath,
			homeDir
		};
	}

	/**
	 * 获取系统提示词（带缓存）
	 *
	 * 🎯 架构决策：100% 本地生成，零API依赖
	 *
	 * ⚠️ 重要：此方法绝对不能改为从后端API获取！
	 * - 本地生成：<1ms
	 * - API获取：50-200ms
	 * - 性能差距：200倍
	 * - 详见：src/vs/workbench/contrib/maxian/common/prompts/README.md
	 *
	 * 🚀 P0优化：智能缓存机制
	 * - 缓存键：workspaceRoot + mode + toolCount
	 * - TTL：5分钟
	 * - 缓存命中率：>90%（实测）
	 * - 预期效果：缓存命中时耗时<1ms
	 *
	 * 📊 Token统计（当前）
	 * - 平均token数：~3000-5000 tokens
	 * - Week 1优化后：~500-800 tokens（系统提示词）+ Skills按需加载
	 *
	 * @returns 完整的系统提示词字符串
	 */
	private async getSystemPrompt(): Promise<string> {
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		const workspaceRoot = workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : '';
		const availableTools = this.getAvailableTools();

		// 生成缓存键（包含 steering 版本，确保 steering 变更时缓存失效）
		const steeringVersion = this.steeringService ? this.steeringService.getLoadVersion() : 0;
		const cacheKey = `${workspaceRoot}:${this.currentMode}:${availableTools.length}:sv${steeringVersion}`;
		const now = Date.now();

		// 检查缓存是否有效
		if (
			this.cachedSystemPrompt &&
			this.cachedSystemPromptKey === cacheKey &&
			(now - this.cachedSystemPromptTime) < this.SYSTEM_PROMPT_CACHE_TTL
		) {
			// 估算token数（简单估算：1 token ≈ 3 字符）
			const estimatedTokens = Math.ceil(this.cachedSystemPrompt.length / 3);
			console.log(`[Maxian] ✅ 系统提示词缓存命中！长度: ${this.cachedSystemPrompt.length} chars ≈ ${estimatedTokens} tokens`);

			// 追加诊断信息（诊断信息是动态的，不参与缓存）
			let finalPrompt = this.cachedSystemPrompt;
			if (this.currentDiagnosticText) {
				finalPrompt = `${finalPrompt}\n\n${this.currentDiagnosticText}`;
				console.log('[Maxian] ✅ 已追加诊断信息到System Prompt（缓存命中）');
			}

			return finalPrompt;
		}

		// 缓存未命中，重新生成
		const generateStart = Date.now();
		const systemInfo = this.getSystemInfo();

		// ✅ 本地生成系统提示词（不要改为API调用！）
		// 详见架构文档：src/vs/workbench/contrib/maxian/common/prompts/README.md

		// 预加载 Skills（避免在系统提示词生成中异步调用）
		const preloadedSkills = await Promise.resolve(this.skillService.search({}));
		const skillsArray = Array.isArray(preloadedSkills) ? preloadedSkills : [];

		// 获取 Steering 内容（来自 .maxian/steering/*.md）
		const steeringContent = this.steeringService
			? this.steeringService.getActiveContent()
			: null;
		if (steeringContent) {
			}

		let prompt = SystemPromptGenerator.generate(
			workspaceRoot,
			availableTools,
			systemInfo,
			this.currentMode,
			{
				// 开发环境下启用token统计（可以在设置中配置）
				includeStats: false, // TODO: 从配置读取
				// ✅ Skills系统已实施（Task #11-15）
				reserveForSkills: true,
				// 传入预加载的 Skills 列表
				preloadedSkills: skillsArray,
				// 🔧 自动诊断信息注入（Task #18）
				diagnosticText: this.currentDiagnosticText,
				// 📋 Steering内容注入（P1优化 - .maxian/steering/*.md）
				steeringContent: steeringContent
			}
		);

		// P1优化：如果将要附加RepoMap，添加使用说明
		if (this.repoMapService && this.lastRepoMap) {
			prompt += `\n\n====\n\nCONTEXT OPTIMIZATION (关键！提升响应速度)

⚠️ 用户消息中包含以下优化内容，请按顺序使用：

## 1. <preloaded_code> - 预加载的相关代码（优先使用！）
- 系统已根据用户问题智能选择并预加载了最相关的代码文件
- **直接分析这些代码，无需再调用 read_file**
- 如果预加载的代码已经足够回答问题，直接给出答案

## 2. <repo_map> - 代码库结构图
- 通过PageRank算法智能排序的代码结构
- 如果预加载的代码不够，从这里选择更多文件
- 使用 batch 工具批量读取

## 强制规则
✅ 正确流程：
1. 先看 <preloaded_code>，通常已包含所需代码
2. 如需更多信息，从 <repo_map> 选择文件
3. 使用 batch 批量读取：batch([read_file("a.java"), read_file("b.java")])

🚫 禁止行为：
- 禁止使用 list_files 逐层探索目录
- 禁止忽略预加载的代码而重新读取同一文件
- 禁止单独调用 read_file（使用 batch）

记住：预加载的代码是为你精心准备的，直接使用可节省50%以上的响应时间！`;
		}

		// 更新缓存
		this.cachedSystemPrompt = prompt;
		this.cachedSystemPromptKey = cacheKey;
		this.cachedSystemPromptTime = now;

		// 统计和日志
		const generateTime = Date.now() - generateStart;
		const estimatedTokens = Math.ceil(prompt.length / 3);
		console.log(`[Maxian] 🔄 生成新系统提示词
  ├─ 长度: ${prompt.length} chars ≈ ${estimatedTokens} tokens
  ├─ 模式: ${this.currentMode}
  ├─ 工具数: ${availableTools.length}
  ├─ 耗时: ${generateTime}ms
  └─ 缓存TTL: ${this.SYSTEM_PROMPT_CACHE_TTL / 1000}s`);

		// TODO: Week 1优化后，预期token数应降至500-800（不含Skills）
		if (estimatedTokens > 6000) {
			console.warn(`[Maxian] ⚠️ 系统提示词token数较高 (${estimatedTokens})，Week 1优化后应降至500-800`);
		}

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
				description: '在终端执行 shell 命令并捕获输出。\n\n**最佳实践**：\n- 使用 cwd 参数指定工作目录，避免 cd && command 模式\n- 提供 description 参数（5-10字描述），如"安装依赖"、"运行测试"\n- 危险命令（删除、覆盖等）应设置 requires_approval=true\n- 长输出命令考虑添加 | head -100 或 | grep 过滤',
				parameters: {
					type: 'object',
					properties: {
						command: { type: 'string', description: '要执行的命令' },
						cwd: { type: 'string', description: '工作目录（建议使用此参数替代 cd && command）' },
						description: { type: 'string', description: '5-10字的命令描述（用于日志和 UI 显示），如"安装依赖"、"运行测试"' },
						requires_approval: { type: 'boolean', description: '是否需要用户确认才能执行（默认 false）。有副作用的命令设为 true' }
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

			// 9. ask_followup_question - 提问
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

			// ==================== P0/P1 优化工具 ====================

			// 16. batch - 批量并行执行只读工具【重要：优先使用！】
			{
				name: 'batch',
				description: '【必须优先使用】并行执行多个独立的只读/搜索工具，减少API往返次数。当需要执行2个或更多 read_file、search_files、glob、list_files、codebase_search、lsp_* 操作时，必须合并到一次batch调用，严禁逐个单独调用。性能提升2-5倍。示例：需要读取3个文件 → 1次batch调用，而非3次read_file。注意：write_to_file、apply_diff、edit、execute_command等写操作禁止放入batch，需单独调用。',
				parameters: {
					type: 'object',
					properties: {
						tool_calls: {
							type: 'array',
							description: '只读工具调用数组，最多25个。格式：[{"tool":"read_file","parameters":{"path":"a.ts"}},{"tool":"read_file","parameters":{"path":"b.ts"}}]。禁止的工具：batch、write_to_file、apply_diff、edit、multiedit、patch、execute_command、ask_followup_question、attempt_completion',
							items: {
								type: 'object',
								properties: {
									tool: { type: 'string', description: '只读工具名称（read_file/search_files/glob/list_files/codebase_search/lsp_*等）' },
									parameters: { type: 'object', description: '工具参数对象' }
								},
								required: ['tool', 'parameters']
							},
							minItems: 1,
							maxItems: 25
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

			// 21. lsp_hover - LSP悬停信息
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
			},

			// 24. skill - Skills系统：按需加载专业知识
			{
				name: 'skill',
				description: '加载并使用专业领域的Skill，获取详细指导和最佳实践。使用此工具可以显著提升特定领域任务的质量。',
				parameters: {
					type: 'object',
					properties: {
						skill_name: {
							type: 'string',
							description: '要加载的Skill名称（slug）。可用的Skills：code-review（代码审查）、debugging（调试指导）、testing（测试策略）、refactoring（重构建议）、security（安全审查）、performance（性能优化）、documentation（文档编写）、architecture（架构设计）、api-design（API设计）、git-workflow（Git工作流）'
						}
					},
					required: ['skill_name']
				}
			},

			// 25. task - 子 Agent 委托
			{
				name: 'task',
				description: '将复杂子任务委托给专门的子 Agent 独立执行。子 Agent 拥有独立的对话历史和受限工具集，适合并行执行独立任务。\n\n子 Agent 类型（subagent_type）：\n- explore：只读探索专家，适合代码库分析、文件搜索\n- plan：规划专家，适合任务分解、风险评估\n- execute/build：全功能执行专家，适合代码实现\n\n何时使用：\n- 任务可以独立完成，不依赖主 Agent 的中间结果\n- 需要并行分析多个模块\n- 主 Agent 需要专注于整体协调',
				parameters: {
					type: 'object',
					properties: {
						subagent_type: {
							type: 'string',
							enum: ['explore', 'plan', 'execute', 'build'],
							description: '子 Agent 类型。explore=只读探索; plan=规划分析; execute/build=完整实现'
						},
						prompt: {
							type: 'string',
							description: '给子 Agent 的详细任务说明，应包含足够的上下文使子 Agent 能够独立完成任务'
						},
						description: {
							type: 'string',
							description: '5-10字的任务描述（用于 UI 显示），如"分析登录模块"'
						},
						task_id: {
							type: 'string',
							description: '（可选）恢复之前子 Agent 会话的 ID。传入后子 Agent 将继续上次的对话上下文，不需要重新开始。ID 来自上次 task 工具调用结果的第一行。'
						}
					},
					required: ['subagent_type', 'prompt']
				}
			},

			// 26. update_todo_list - 更新待办列表
			{
				name: 'update_todo_list',
				description: '更新当前任务的待办列表。用于跟踪任务进度，在 UI 中可视化显示。\n\n**重要：进行复杂多步任务时必须使用此工具创建任务清单。**\n\n每次开始任务时创建完整列表，随着任务推进更新每项的状态。',
				parameters: {
					type: 'object',
					properties: {
						todos: {
							type: 'string',
							description: 'JSON 格式的待办事项数组。每项包含：content（任务内容）、status（pending/in_progress/completed）、priority（high/medium/low）'
						}
					},
					required: ['todos']
				}
			},

			// 27. todowrite - 写入待办列表（增强版）
			{
				name: 'todowrite',
				description: '创建或更新任务待办列表。参考 OpenCode 最佳实践：\n\n**何时使用**：\n1. 收到复杂任务（3步以上）时，立即创建待办列表\n2. 开始每个子任务前，将其标记为 in_progress\n3. 完成每个子任务后，将其标记为 completed\n\n这能让用户清楚了解任务进度，也帮助你追踪已完成的工作。',
				parameters: {
					type: 'object',
					properties: {
						todos: {
							type: 'string',
							description: 'JSON 格式的待办事项数组。格式：[{"content":"任务内容","status":"pending","priority":"high"}]。status: pending|in_progress|completed; priority: high|medium|low'
						}
					},
					required: ['todos']
				}
			},

			// 28. todoread - 读取待办列表
			{
				name: 'todoread',
				description: '读取当前 Session 的待办列表。用于在长对话中重新了解任务进度。',
				parameters: {
					type: 'object',
					properties: {},
					required: []
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

		// 过滤工具定义
		const allTools = this.getAllToolDefinitions();
		const filteredTools = allTools.filter(tool => allowedTools.includes(tool.name));


		return filteredTools;
	}

	/**
	 * P2优化：运行子 Agent
	 * 创建 FilteredToolExecutor + 独立 TaskService 实例，运行至 attempt_completion
	 */
	private async runSubAgent(agentType: string, prompt: string, workspaceRoot: string, taskToolId?: string): Promise<string> {
		if (!this.toolExecutor || !this.apiHandler) {
			return '子 Agent 启动失败：主服务未初始化';
		}

		// 根据 agentType 确定允许的工具集
		let allowedToolsArray: readonly string[];
		switch (agentType) {
			case 'explore':
				allowedToolsArray = EXPLORE_AGENT_TOOLS;
				break;
			case 'plan':
				allowedToolsArray = PLAN_AGENT_TOOLS;
				break;
			case 'execute':
			case 'build':
			default:
				allowedToolsArray = EXECUTE_AGENT_TOOLS;
				break;
		}

		const allowedTools = new Set<string>(allowedToolsArray);
		// 始终允许 attempt_completion 和 ask_followup_question
		allowedTools.add('attempt_completion');
		allowedTools.add('ask_followup_question');

		// 创建过滤工具执行器（共享底层 toolExecutor，读操作安全并发）
		const filteredExecutor = new FilteredToolExecutor(this.toolExecutor, allowedTools);

		// 过滤工具定义
		const allToolDefs = this.getAllToolDefinitions();
		const subAgentToolDefs = allToolDefs.filter(t => allowedTools.has(t.name));

		// 构建子 Agent 系统提示词
		const subAgentSystemPrompt = async (): Promise<string> => {
			const basePrompt = await this.getSystemPrompt();
			const agentRoleDesc = this.getAgentRoleDescription(agentType);
			return `${basePrompt}\n\n# 子 Agent 角色\n${agentRoleDesc}\n\n# 重要提示\n- 你是一个专门的子 Agent，任务完成后必须调用 attempt_completion 工具\n- 你的工具集已受限，只能使用当前角色对应的工具\n- 不要调用 task 工具派发更多子 Agent`;
		};

		// 创建独立的 TaskService 实例（独立消息历史）
		const subTask = new TaskService({
			task: prompt,
			apiHandler: this.apiHandler,
			toolExecutor: filteredExecutor,
			getSystemPrompt: subAgentSystemPrompt,
			getToolDefinitions: () => subAgentToolDefs,
			workspaceRoot,
			consecutiveMistakeLimit: 3,
			currentMode: 'ask'  // ask 模式：attempt_completion 时自动完成，不需用户确认
		});

		// 捕获 completion_result
		let completionResult = '';
		const completionDisposable = subTask.onMessageAdded((msg) => {
			if (msg.type === 'say' && msg.say === 'completion_result' && msg.text) {
				completionResult = msg.text;
			}
		});

		// 将子 Agent 的工具进度实时转发给主 UI
		// 使用 isPartial:true 保持状态元素可见，让用户看到子 Agent 正在做什么
		let subAgentToolCount = 0;
		const streamingDisposable = taskToolId ? subTask.onToolInputStreaming((event) => {
			subAgentToolCount++;
			const toolLabel = event.toolName === 'batch' ? 'batch(并行)' : event.toolName;
			// 提取最关键的参数信息（文件路径/搜索词等）
			let keyParam = '';
			if (event.input) {
				keyParam = event.input.path || event.input.query || event.input.pattern || event.input.command || '';
				if (typeof keyParam === 'string' && keyParam.length > 60) {
					keyParam = '...' + keyParam.slice(-60);
				}
			}
			this._onToolInputStreaming.fire({
				toolId: taskToolId,
				toolName: 'task',
				input: `[子Agent #${subAgentToolCount}] ${toolLabel}${keyParam ? ': ' + keyParam : ''}`,
				isPartial: true  // 保持元素可见，不触发自动清理
			});
		}) : { dispose: () => {} };

		console.log(`[Maxian] 子 Agent 启动: type=${agentType}, tools=${subAgentToolDefs.length}`);

		try {
			await subTask.start();
		} catch (error) {
			console.error(`[Maxian] 子 Agent 异常: ${error}`);
		} finally {
			completionDisposable.dispose();
			streamingDisposable.dispose();
			// 子 Agent 完成后，发一次 isPartial:false 触发进度元素的自动清理
			if (taskToolId && subAgentToolCount > 0) {
				this._onToolInputStreaming.fire({
					toolId: taskToolId,
					toolName: 'task',
					input: `[子Agent 完成] 共执行 ${subAgentToolCount} 个工具操作`,
					isPartial: false
				});
			}
			subTask.dispose();
		}

		return completionResult || `子 Agent (${agentType}) 已完成执行，但未提供结果摘要。`;
	}

	/**
	 * 根据 agentType 返回角色描述
	 */
	private getAgentRoleDescription(agentType: string): string {
		switch (agentType) {
			case 'explore':
				return `你是代码库探索专家。你的任务是深入分析代码库结构、找到相关文件、理解架构设计。

## 关键规则

**必须用 batch 工具并行执行多个搜索/读取操作，严禁逐个单独调用。**

正确示例（定位阶段，一次 batch 并行搜索）：
{"tool_calls": [
  {"tool": "glob", "parameters": {"pattern": "**/*Service.ts"}},
  {"tool": "codebase_search", "parameters": {"query": "核心功能关键词"}},
  {"tool": "search_files", "parameters": {"path": ".", "regex": "class.*Impl"}}
]}

正确示例（读取阶段，一次 batch 并行读多文件）：
{"tool_calls": [
  {"tool": "read_file", "parameters": {"path": "src/a/Foo.ts"}},
  {"tool": "read_file", "parameters": {"path": "src/b/Bar.ts"}}
]}

**禁止链式发现**（读A发现B再读B再读C...），应先 glob/search 定位所有相关文件，然后一次 batch 读完。完成分析后立即调用 attempt_completion 返回精简摘要。`;

			case 'plan':
				return '你是任务规划专家。你的任务是分析需求、制定详细的实施计划、识别关键文件和风险。只使用只读工具进行分析。';
			case 'execute':
			case 'build':
			default:
				return '你是代码实现专家。你的任务是根据要求完整实现功能，包括代码编写、测试和验证。使用所有必要的工具来完成任务。';
		}
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

		// 如果任务已经被取消，直接返回，不做任何处理
		if (this.currentTaskCancelled) {
			return;
		}

		// 检查是否有TaskService任务在运行（code/architect/debug等模式）
		if (this.currentTask) {
			// 立即设置取消标志，防止重复点击
			this.currentTaskCancelled = true;
			const task = this.currentTask;

			// 在清理 currentTask 前先记录日志
			const taskUsage = task.getTokenUsage();
			const inputTokens = taskUsage?.totalTokensIn || 0;
			const outputTokens = taskUsage?.totalTokensOut || 0;

			// 记录AI调用日志（用户中止）
			this.logAICall({
				inputTokens,
				outputTokens,
				status: 'aborted',
				errorMessage: '用户取消任务',
				requestSummary: '用户主动取消任务'
			}).catch(err => {
				console.error('[Maxian] 记录中止日志失败:', err);
			});

			console.log(`[Maxian] 任务中止，记录日志 - 输入Token:${inputTokens}, 输出Token:${outputTokens}`);

			this.currentTask = null;
			task.abortTask(ClineApiReqCancelReason.UserCancelled);
			this._onTaskCancelled.fire();
			return;
		}

		// 检查是否有ask模式任务在运行
		if (this.isAskModeRunning && this.askModeAbortController && this.difyHandler) {
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
	}

	/**
	 * 清空对话历史
	 */
	clearConversation(): void {

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

	}

	/**
	 * 重置ask模式的会话ID（不影响其他状态）
	 */
	resetAskConversation(): void {
		if (this.difyHandler) {
			this.difyHandler.resetConversation();
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
	 * 从存储加载自动批准规则
	 */
	/**
	 * 设置工具自动批准规则
	 */
	setToolAutoApprove(toolName: string, autoApprove: boolean): void {
		if (autoApprove) {
			this.autoApprovedTools.add(toolName);
		} else {
			this.autoApprovedTools.delete(toolName);
		}
		// 🔥 不再保存到持久化存储，"始终允许"仅针对单个任务会话
		// this.saveAutoApproveRules();
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
		} else {
			this.autoApprovedCommands.delete(command);
		}
		// 🔥 不再保存到持久化存储，"始终允许"仅针对单个任务会话
		// this.saveAutoApproveRules();
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
	}

	// ====== 快捷键触发方法 ======

	triggerSend(): void { this._onTriggerSend.fire(); }
	triggerNewLine(): void { this._onTriggerNewLine.fire(); }
	triggerOpenView(): void { this._onTriggerOpenView.fire(); }
	triggerStopGeneration(): void { this._onTriggerStopGeneration.fire(); }
	triggerClearConversation(): void { this._onTriggerClearConversation.fire(); }

	/**
	 * 启用自动诊断注入
	 */
	enableAutoDiagnostics(): void {
		if (this.autoDiagnosticInjector) {
			this.autoDiagnosticInjector.enable();
		}
	}

	/**
	 * 禁用自动诊断注入
	 */
	disableAutoDiagnostics(): void {
		if (this.autoDiagnosticInjector) {
			this.autoDiagnosticInjector.disable();
		}
	}

	/**
	 * 手动触发诊断获取（用于测试或手动触发）
	 */
	async manualFetchDiagnostics(filePath: string): Promise<boolean> {
		if (!this.autoDiagnosticInjector) {
			console.warn('[Maxian] 自动诊断注入器未初始化');
			return false;
		}
		return await this.autoDiagnosticInjector.fetchAndInjectDiagnostics(filePath);
	}

	/**
	 * 获取诊断注入器统计信息
	 */
	getDiagnosticsStats(): {
		enabled: boolean;
		cacheSize: number;
		hasPendingDiagnostics: boolean;
	} | null {
		if (!this.autoDiagnosticInjector) {
			return null;
		}
		return this.autoDiagnosticInjector.getStats();
	}

	/**
	 * 清除当前诊断信息
	 */
	clearCurrentDiagnostics(): void {
		if (this.autoDiagnosticInjector) {
			this.autoDiagnosticInjector.clearDiagnosticText();
		}
		this.currentDiagnosticText = null;
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
	 * @param mentionedIdents 从用户消息中同步提取的关键词，PageRank会给包含这些标识符的文件 ×10 权重
	 */
	private async generateRepoMap(workspaceRoot: string, mentionedIdents: string[] = []): Promise<string> {
		if (!this.repoMapService) {
			return '';
		}

		try {
			const startTime = Date.now();

			// 1. 获取工作区中的所有代码文件
			const allFiles = await this.repoMapService.getWorkspaceCodeFiles(workspaceRoot);

			// 2. 准备上下文，填充 mentionedIdents 使 PageRank 个性化排序
			// mentionedIdents 中的标识符在相关文件中会获得 ×10 权重，
			// 让 RepoMap 把当前任务最相关的文件排到前面，从而让预加载命中正确文件
			const context: IRepoMapContext = {
				chatFiles: [],
				otherFiles: allFiles,
				mentionedFiles: [],
				mentionedIdents: mentionedIdents,
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

	// ==================== 预加载代码优化 ====================

	/**
	 * 从用户消息中同步提取关键词（不调用AI，零延迟）
	 * 提取驼峰命名、英文单词、文件名、以及中文关键词（通过映射表）
	 * 用于填充 RepoMap 的 mentionedIdents，使 PageRank 能给相关文件 ×10 权重
	 */
	private extractKeywordsSync(message: string): string[] {
		const words: string[] = [];

		// 提取驼峰命名（如 LoginController, getUserInfo）
		const camelCaseMatches = message.match(/[A-Z][a-z]+[A-Z][a-zA-Z]*/g) || [];
		words.push(...camelCaseMatches);

		// 提取英文单词（至少3个字符）
		const stopWords = new Set([
			'can', 'you', 'please', 'help', 'me', 'the', 'a', 'an', 'is', 'are', 'to', 'and', 'or',
			'in', 'on', 'at', 'for', 'with', 'this', 'that', 'what', 'how', 'why', 'where', 'when'
		]);
		const englishMatches = message.match(/\b[a-zA-Z]{3,}\b/g) || [];
		words.push(...englishMatches.filter(w => !stopWords.has(w.toLowerCase())));

		// 提取文件名模式（去掉扩展名作为标识符）
		const filePatterns = message.match(/[A-Za-z][A-Za-z0-9]*\.(java|ts|tsx|js|jsx|py|go|rs)/gi) || [];
		words.push(...filePatterns.map(p => p.replace(/\.[^.]+$/, '')));

		// 中文关键词映射（无需AI调用）
		if (/[\u4e00-\u9fa5]/.test(message)) {
			words.push(...this.extractKeywordsFallback(message));
		}

		return [...new Set(words)].slice(0, 30);
	}

	/**
	 * 从用户消息中提取关键词
	 * 用于匹配相关文件
	 */
	// 关键词翻译缓存
	private keywordTranslationCache: Map<string, string[]> = new Map();

	/**
	 * 使用AI进行中文分词和翻译
	 * 将用户的中文消息提取关键词并翻译为英文
	 * 优化：先调用 extractKeywordsSync，若关键词足够则跳过AI调用
	 */
	private async extractKeywordsWithAI(message: string): Promise<string[]> {
		// 1. 复用同步提取逻辑，避免代码重复
		const words: string[] = [...this.extractKeywordsSync(message)];

		// 2. 若同步关键词已足够（≥5个），无需调用AI
		const hasChinese = /[\u4e00-\u9fa5]/.test(message);
		if (!hasChinese || words.length >= 5) {
			return words.slice(0, 30);
		}

		// 3. 检查缓存
		const cacheKey = message.substring(0, 100);
		const cached = this.keywordTranslationCache.get(cacheKey);
		if (cached) {
			words.push(...cached);
			return [...new Set(words)].slice(0, 30);
		}

		// 4. 调用AI进行分词和翻译（关键词不足时才触发）
		try {
			const translatedKeywords = await this.translateChineseKeywords(message);
			if (translatedKeywords.length > 0) {
				words.push(...translatedKeywords);
				this.keywordTranslationCache.set(cacheKey, translatedKeywords);
				if (this.keywordTranslationCache.size > 100) {
					const firstKey = this.keywordTranslationCache.keys().next().value;
					if (firstKey) {
						this.keywordTranslationCache.delete(firstKey);
					}
				}
			}
		} catch (error) {
			console.warn('[Maxian] AI关键词翻译失败，使用备用方案:', error);
			words.push(...this.extractKeywordsFallback(message));
		}

		return [...new Set(words)].slice(0, 30);
	}

	/**
	 * 调用AI翻译中文关键词
	 * 使用与代码补全相同的API接口 (IAIService.complete())
	 */
	private async translateChineseKeywords(message: string): Promise<string[]> {
		const prompt = `你是一个代码关键词提取助手。请从用户消息中提取与代码相关的关键词，并翻译为英文。

用户消息: "${message}"

请直接返回JSON数组格式的英文关键词，用于匹配代码文件名和类名。
要求：
1. 只提取与编程/代码相关的名词（如：登录→login, 用户→user, 验证码→captcha/verify）
2. 忽略动词和助词（如：请、帮我、实现、增加）
3. 每个中文词可以对应多个英文变体（如：登录→login,signin,auth）
4. 返回格式必须是JSON数组，如：["login","user","auth","sms"]

直接返回JSON数组，不要其他内容：`;

		try {
			// 使用IAIService.complete() - 与代码补全使用相同的接口
			const response = await this.aiService.complete(prompt, {
				temperature: 0.1,
				maxTokens: 200,
				businessCode: 'IDE_KEYWORD_TRANSLATE'  // 使用专门的业务代码，便于后端统计和优化
			});

			// 解析JSON数组
			const match = response.match(/\[[\s\S]*?\]/);
			if (match) {
				const keywords = JSON.parse(match[0]);
				if (Array.isArray(keywords)) {
					return keywords.filter((k: unknown) => typeof k === 'string');
				}
			}

			console.warn('[Maxian] AI返回格式不正确，无法解析JSON数组:', response);
			return [];
		} catch (error) {
			console.warn('[Maxian] 关键词翻译API调用失败:', error);
			return [];
		}
	}

	/**
	 * 备用方案：使用简单的映射表
	 */
	private extractKeywordsFallback(message: string): string[] {
		const chineseToEnglishMap: Record<string, string[]> = {
			'登录': ['login', 'signin', 'auth'],
			'注册': ['register', 'signup'],
			'用户': ['user', 'account'],
			'验证码': ['code', 'captcha', 'verify'],
			'短信': ['sms', 'message'],
			'密码': ['password'],
			'权限': ['permission', 'auth'],
			'订单': ['order'],
			'支付': ['pay', 'payment'],
			'商品': ['product', 'goods'],
			'配置': ['config', 'setting'],
			'服务': ['service'],
			'控制器': ['controller'],
			'接口': ['api', 'interface'],
			'数据库': ['database', 'mapper', 'dao'],
			'缓存': ['cache', 'redis'],
			'文件': ['file'],
			'上传': ['upload'],
			'下载': ['download'],
			'查询': ['query', 'search'],
			'添加': ['add', 'create'],
			'修改': ['update', 'edit'],
			'删除': ['delete', 'remove'],
		};

		const words: string[] = [];
		const chineseMatches = message.match(/[\u4e00-\u9fa5]{2,4}/g) || [];

		for (const chineseWord of chineseMatches) {
			for (const [chinese, english] of Object.entries(chineseToEnglishMap)) {
				if (chineseWord.includes(chinese)) {
					words.push(...english);
				}
			}
		}

		return words;
	}

	/**
	 * 从RepoMap中选择与关键词最相关的文件
	 */
	private selectRelevantFilesFromRepoMap(keywords: string[], repoMap: string, maxFiles: number = 5): string[] {
		if (!repoMap || keywords.length === 0) {
			return [];
		}

		// 解析RepoMap，提取文件路径
		const lines = repoMap.split('\n');
		const fileScores: Map<string, number> = new Map();

		for (const line of lines) {
			// RepoMap格式：文件路径在行首，以冒号结尾
			// 例如: boyo-common/src/main/java/com/boyo/common/helper/LoginHelper.java:
			const fileMatch = line.match(/^([a-zA-Z0-9_\-./]+\.(java|ts|tsx|js|jsx|py|go|rs|vue|html|css|scss|json|xml|yaml|yml)):/i);
			if (fileMatch) {
				const filePath = fileMatch[1];

				// 过滤无效路径：
				// 1. 必须包含目录分隔符（完整路径）
				// 2. 不能包含特殊字符如 ( " ' 等
				if (!filePath.includes('/') || /[("']/.test(filePath)) {
					continue;
				}

				const fileName = basename(filePath).toLowerCase();
				const lineContent = line.toLowerCase();

				// 计算与关键词的匹配分数
				let score = 0;
				for (const keyword of keywords) {
					const kw = keyword.toLowerCase();
					// 文件名匹配得分更高
					if (fileName.includes(kw)) {
						score += 10;
					}
					// 路径或定义内容匹配
					if (lineContent.includes(kw)) {
						score += 3;
					}
				}

				if (score > 0) {
					const currentScore = fileScores.get(filePath) || 0;
					fileScores.set(filePath, currentScore + score);
				}
			}
		}

		// 按分数排序，返回top N
		const sortedFiles = [...fileScores.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, maxFiles)
			.map(([filePath, _score]) => filePath);

		return sortedFiles;
	}

	/**
	 * 预加载指定文件的内容
	 */
	private async preloadFiles(filePaths: string[], workspaceRoot: string): Promise<string> {
		if (filePaths.length === 0) {
			return '';
		}

		const maxFileSize = 50000; // 单文件最大50KB
		const maxTotalSize = 150000; // 总计最大150KB

		// 并行读取所有文件
		const readResults = await Promise.all(filePaths.map(async (filePath) => {
			try {
				const absolutePath = filePath.startsWith('/') || filePath.includes(':')
					? filePath
					: `${workspaceRoot}/${filePath}`;
				const uri = URI.file(absolutePath);
				const content = await this.fileService.readFile(uri);
				return { filePath, text: content.value.toString(), error: null };
			} catch (error) {
				console.warn(`[Maxian] 预加载文件失败: ${filePath}`, error);
				return { filePath, text: '', error };
			}
		}));

		// 组合结果（限制总大小）
		const results: string[] = [];
		let totalSize = 0;
		for (const { filePath, text, error } of readResults) {
			if (error || !text) continue;
			if (totalSize >= maxTotalSize) break;
			if (text.length > maxFileSize) {
				const truncatedText = text.substring(0, maxFileSize);
				results.push(`// File: ${filePath} (截断至 ${maxFileSize} 字符)\n${truncatedText}\n// ... [文件过大，已截断]`);
				totalSize += maxFileSize;
			} else {
				results.push(`// File: ${filePath}\n${text}`);
				totalSize += text.length;
			}
		}

		if (results.length === 0) {
			return '';
		}

		return results.join('\n\n');
	}

	/**
	 * 智能预加载相关代码
	 * 基于用户消息和RepoMap选择最相关的文件并预先读取
	 */
	private async smartPreloadCode(message: string, repoMap: string, workspaceRoot: string): Promise<string> {
		// 1. 使用AI提取并翻译关键词
		const keywords = await this.extractKeywordsWithAI(message);
		if (keywords.length === 0) {
			return '';
		}

		// 使用已提取的关键词进行预加载
		return this.smartPreloadCodeWithKeywords(message, repoMap, workspaceRoot, keywords);
	}

	/**
	 * 使用已翻译的关键词进行智能预加载
	 * 🚀 性能优化：避免重复调用AI翻译
	 */
	private async smartPreloadCodeWithKeywords(
		_message: string,
		repoMap: string,
		workspaceRoot: string,
		keywords: string[]
	): Promise<string> {
		// 1. 从RepoMap选择相关文件
		const relevantFiles = this.selectRelevantFilesFromRepoMap(keywords, repoMap, 5);
		if (relevantFiles.length === 0) {
			return '';
		}

		// 2. 预加载文件内容
		const preloadedCode = await this.preloadFiles(relevantFiles, workspaceRoot);
		if (!preloadedCode) {
			return '';
		}

		// 3. 包装返回
		return `<preloaded_code>
以下是根据你的问题预先加载的相关代码，请直接分析，无需再次调用 read_file：

${preloadedCode}

💡 提示：如果这些文件不够，可以使用 batch 工具批量读取更多文件
</preloaded_code>`;
	}

	override dispose(): void {
		console.log('[Maxian] 码弦服务正在销毁');
		// 释放 SteeringService 资源
		if (this.steeringService) {
			this.steeringService.dispose();
			this.steeringService = null;
		}
		super.dispose();
	}
}

