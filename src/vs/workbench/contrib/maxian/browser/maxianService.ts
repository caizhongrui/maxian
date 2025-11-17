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
	 */
	sendMessage(message: string, mode?: Mode): Promise<void>;

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
	 * 取消当前正在执行的任务
	 */
	cancelTask(): void;

	/**
	 * 清空对话历史
	 */
	clearConversation(): void;

	/**
	 * 任务取消事件
	 */
	readonly onTaskCancelled: Event<void>;

	/**
	 * 对话清空事件
	 */
	readonly onConversationCleared: Event<void>;
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

	private _initialized = false;
	private toolExecutor: IToolExecutor | null = null;
	private apiHandler: IApiHandler | null = null;
	private apiFactory: ApiFactory;
	private currentMode: Mode = DEFAULT_MODE;
	private currentTask: TaskService | null = null;
	private diffViewProvider: DiffViewProvider | null = null;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@ISearchService private readonly searchService: ISearchService,
		@IRipgrepService private readonly ripgrepService: IRipgrepService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorService _editorService: IEditorService,
		@IModelService _modelService: IModelService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
		this.apiFactory = new ApiFactory(this.configurationService);
		// 使用IInstantiationService创建DiffViewProvider实例，确保依赖注入正确工作
		this.diffViewProvider = this.instantiationService.createInstance(DiffViewProvider);
		this._register(this.diffViewProvider);
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

		// 初始化千问API Handler
		const validation = this.apiFactory.validateConfiguration();
		if (!validation.valid) {
			console.warn('[Maxian] API配置验证失败:', validation.error);
		}

		this.apiHandler = this.apiFactory.createHandler();
		const modelInfo = this.apiHandler.getModel();
		console.log('[Maxian] API Handler已初始化，模型:', modelInfo.name);

		this._initialized = true;
		console.log('[Maxian] 码弦服务初始化完成');
	}

	async sendMessage(message: string, mode: Mode = DEFAULT_MODE): Promise<void> {
		console.log('[Maxian] 发送消息:', message, '模式:', mode);

		// 更新当前模式
		this.currentMode = mode;

		// 确保已初始化
		if (!this._initialized) {
			await this.initialize();
		}

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

		// 触发用户消息事件
		this._onMessage.fire({
			type: 'user',
			content: message
		});

		try {
			// 创建新的TaskService实例
			this.currentTask = new TaskService({
				task: message,
				apiHandler: this.apiHandler,
				toolExecutor: this.toolExecutor,
				getSystemPrompt: () => this.getSystemPrompt(),
				getToolDefinitions: () => this.getToolDefinitions(),
				workspaceRoot,
				consecutiveMistakeLimit: 3,
				currentMode: this.currentMode
			});

			// 连接TaskService事件
			this._register(this.currentTask.onStatusChanged(status => {
				console.log('[Maxian] Task状态变更:', status);
				if (status === TaskStatus.COMPLETED) {
					this._onMessage.fire({
						type: 'assistant',
						content: '',
						isPartial: false
					});
				} else if (status === TaskStatus.ERROR) {
					// 仅对真正的错误显示错误提示，中止时静默处理
					this._onMessage.fire({
						type: 'error',
						content: '任务错误'
					});
				}
				// ABORTED状态静默处理，不显示任何提示
			}));

			this._register(this.currentTask.onMessageAdded(clineMessage => {
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
			}));

			// 监听流式chunks，实时发送文本到UI
			this._register(this.currentTask.onStreamChunk(chunk => {
				if (chunk.text) {
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
			}));

			// 监听用户输入请求
			this._register(this.currentTask.onUserInputRequired(({ question, toolUseId }) => {
				console.log('[Maxian] 转发用户输入请求到UI:', question);
				this._onQuestionAsked.fire({ question, toolUseId });
			}));

			// 启动任务
			await this.currentTask.start();

		} catch (error) {
			console.error('[Maxian] 任务执行错误:', error);
			this._onMessage.fire({
				type: 'error',
				content: `错误: ${error instanceof Error ? error.message : String(error)}`
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
	 * 获取系统提示词
	 */
	private getSystemPrompt(): string {
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		const workspaceRoot = workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : '';
		const availableTools = this.getAvailableTools();
		const systemInfo = this.getSystemInfo();

		// 传递当前模式和系统信息给系统提示词生成器
		return SystemPromptGenerator.generate(workspaceRoot, availableTools, systemInfo, this.currentMode);
	}

	/**
	 * 获取所有工具定义
	 * 包含所有15个工具的完整定义
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
	 * 取消当前正在执行的任务
	 */
	cancelTask(): void {
		if (this.currentTask) {
			console.log('[Maxian] 取消当前任务');
			this.currentTask.abortTask(ClineApiReqCancelReason.UserCancelled);
			this._onTaskCancelled.fire();
		} else {
			console.log('[Maxian] 没有正在执行的任务');
		}
	}

	/**
	 * 清空对话历史
	 */
	clearConversation(): void {
		console.log('[Maxian] 清空对话历史');

		// 如果有正在执行的任务，先中止它
		if (this.currentTask) {
			this.currentTask.abortTask(ClineApiReqCancelReason.UserCancelled);
		}

		// 重置当前任务
		this.currentTask = null;

		// 触发对话清空事件
		this._onConversationCleared.fire();

		console.log('[Maxian] 对话历史已清空');
	}

	override dispose(): void {
		console.log('[Maxian] 码弦服务正在销毁');
		super.dispose();
	}
}
