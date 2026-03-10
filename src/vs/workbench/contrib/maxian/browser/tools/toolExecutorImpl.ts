/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IToolExecutor, ToolExecutionContext } from '../../common/tools/toolExecutor.js';
import { ToolUse, ToolResponse, ToolName, ALWAYS_AVAILABLE_TOOLS, TOOL_GROUPS } from '../../common/tools/toolTypes.js';
import { FileOperationsTool } from './fileOperations.js';
import { CommandExecutionTool } from './commandExecution.js';
import { SearchTool } from './searchTools.js';
import { TodoStore, parseTodos, formatTodoList, IRawTodoInput } from '../../common/tools/todoStore.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';
import { ISearchService } from '../../../../services/search/common/search.js';
import { IRipgrepService } from '../../../../services/ripgrep/common/ripgrep.js';
import { BatchToolExecutor, BatchToolCall } from '../../common/tools/batchTool.js';
import { executeMultiedit, formatMultieditResponse, EditOperation } from '../../common/tools/multieditTool.js';
import { detectDoomLoop, resetDoomLoopCount } from '../../common/agent/doomLoopDetector.js';
import { isToolEnabledForAgent, checkBashPermission } from '../../common/agent/agentConfig.js';
import { executeEdit, validateEditParams, formatEditResponse } from '../../common/tools/editTool.js';
import { validateUrl, processResponse, formatWebFetchResponse } from '../../common/tools/webfetchTool.js';
import { IRequestService, asText } from '../../../../../platform/request/common/request.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { skillTool } from '../../common/tools/skillTool.js';
import { ISkillService } from '../../../skills/common/skillService.js';
import { getHoverInfo } from '../../common/lsp/lspHover.js';
import { getDiagnosticsAfterEdit } from '../../common/lsp/lspDiagnostics.js';
import { getDefinition } from '../../common/lsp/lspDefinition.js';
import { getReferences } from '../../common/lsp/lspReferences.js';
import { getTypeDefinition } from '../../common/lsp/lspTypeDefinition.js';
import { ICommandExecutionService } from '../../common/services/commandExecutionService.js';

/**
 * 工具执行器实现类
 * 负责调度和执行各种工具
 */
export class ToolExecutorImpl implements IToolExecutor {
	private fileOperations: FileOperationsTool;
	private commandExecution: CommandExecutionTool;
	private searchTool: SearchTool;
	private batchExecutor: BatchToolExecutor;
	private context: ToolExecutionContext;
	private skillService?: ISkillService;
	private requestService?: IRequestService;

	/**
	 * 子 Agent 运行器（由 maxianService 注入）
	 * 接受 agentType 和 prompt，返回子 Agent 的完成结果
	 */
	private subAgentRunner?: (agentType: string, prompt: string, taskId?: string, taskToolId?: string) => Promise<string>;

	constructor(
		fileService: IFileService,
		terminalService: ITerminalService,
		searchService: ISearchService,
		ripgrepService: IRipgrepService,
		context: ToolExecutionContext,
		skillService?: ISkillService,
		commandExecutionService?: ICommandExecutionService,
		requestService?: IRequestService
	) {
		this.fileOperations = new FileOperationsTool(fileService, context.workspaceRoot || '');
		this.commandExecution = new CommandExecutionTool(terminalService);
		if (commandExecutionService) {
			this.commandExecution.setCommandExecutionService(commandExecutionService);
		}
		this.searchTool = new SearchTool(searchService, ripgrepService, context.workspaceRoot || '');
		this.context = context;
		this.skillService = skillService;
		this.requestService = requestService;
		// P0优化：初始化批量执行器
		this.batchExecutor = new BatchToolExecutor(this);
	}

	/**
	 * 执行工具调用
	 */
	async executeTool(toolUse: ToolUse): Promise<ToolResponse> {

		// P2-9: Agent 工具过滤检查
		const agentName = this.context.agentName || 'build';
		if (!isToolEnabledForAgent(agentName, toolUse.name as ToolName)) {
			console.warn(`[Maxian] 工具 ${toolUse.name} 对 Agent ${agentName} 不可用`);
			return `工具 ${toolUse.name} 对当前 Agent (${agentName}) 不可用。\n\n该 Agent 的权限配置不允许使用此工具。`;
		}

		// P2-10: Bash 命令权限检查
		if (toolUse.name === 'execute_command' && toolUse.params.command) {
			const bashPermission = checkBashPermission(agentName, toolUse.params.command);
			if (bashPermission === 'deny') {
				console.warn(`[Maxian] 命令 "${toolUse.params.command}" 对 Agent ${agentName} 被拒绝`);
				return `命令 "${toolUse.params.command}" 被拒绝执行。\n\n当前 Agent (${agentName}) 没有执行此命令的权限。`;
			}
			// 如果是 'ask'，这里可以触发用户确认（暂时先允许执行）
			if (bashPermission === 'ask') {
			}
		}

		// P1-7: Doom Loop 检测
		const sessionId = this.context.sessionId || 'default';
		const doomLoopResult = detectDoomLoop(sessionId, toolUse);

		if (doomLoopResult.detected) {
			console.warn(`[Maxian] 检测到 Doom Loop: ${toolUse.name} 连续 ${doomLoopResult.count} 次相同调用`);
			// 返回警告消息，提示 AI 改变策略
			return `⚠️ Doom Loop 检测警告\n\n${doomLoopResult.message}\n\n请分析问题原因并尝试不同的方法。`;
		}

		try {
			let result: ToolResponse;

			switch (toolUse.name) {
				// 文件操作工具
				case 'read_file':
					result = await this.fileOperations.readFile(toolUse as any);
					break;

				case 'write_to_file':
					result = await this.fileOperations.writeToFile(toolUse as any);
					break;

				case 'delete_file':
					result = await this.fileOperations.deleteFile(toolUse);
					break;

				case 'list_files':
					result = await this.fileOperations.listFiles(toolUse as any);
					break;

				case 'glob':
					result = await this.fileOperations.glob(toolUse as any);
					break;

				// 命令执行工具（requires_approval机制参考Cline）
				case 'execute_command': {
					// AI自声明命令是否需要用户确认：true=有副作用，false=只读操作
					const requiresApproval = toolUse.params.requires_approval;
					if (requiresApproval === 'true') {
						// 返回特殊前缀，TaskService检测后弹出用户确认
						result = '__APPROVAL_REQUIRED__:' + JSON.stringify({
							command: toolUse.params.command || '',
							cwd: toolUse.params.cwd || '',
							toolUseId: toolUse.toolUseId
						});
					} else {
						result = await this.commandExecution.executeCommand(toolUse as any);
					}
					break;
				}

				// 搜索工具
				case 'search_files':
					result = await this.searchTool.searchFiles(toolUse as any);
					break;

				case 'codebase_search':
					result = await this.searchTool.codebaseSearch(toolUse as any);
					break;

				case 'list_code_definition_names':
					result = await this.searchTool.listCodeDefinitionNames(toolUse.params.path || '');
					break;

				// Agent控制工具
				case 'ask_followup_question':
					result = this.handleFollowupQuestion(toolUse);
					break;

				case 'attempt_completion':
					result = this.handleAttemptCompletion(toolUse);
					break;

				case 'new_task':
					result = this.handleNewTask(toolUse);
					break;

				case 'update_todo_list':
					result = this.handleUpdateTodoList(toolUse);
					break;

				// P2优化：todowrite / todoread
				case 'todowrite':
					result = this.handleUpdateTodoList(toolUse);
					break;

				case 'todoread':
					result = this.handleTodoRead();
					break;

				// P2优化：task 子 Agent 委托
				case 'task':
					result = await this.executeTask(toolUse);
					break;

				// 编辑工具
				case 'apply_diff':
					result = await this.fileOperations.applyDiff(toolUse as any);
					break;

				// 独立 edit 工具（P0优化：基于 fuzzyMatch 的容错替换）
				case 'edit':
					result = await this.executeEdit(toolUse);
					break;

				// P0优化：批量执行工具
				case 'batch':
					result = await this.executeBatch(toolUse);
					break;

				// P1优化：多处编辑工具
				case 'multiedit':
					result = await this.executeMultiedit(toolUse);
					break;

				// P0优化：网页获取工具
				case 'webfetch':
					result = await this.executeWebFetch(toolUse);
					break;

				// P1优化：多文件补丁
				case 'patch':
					result = await this.executePatch(toolUse);
					break;

				// P1优化：LSP工具
				case 'lsp_hover':
					result = await this.executeLspHover(toolUse);
					break;

				case 'lsp_diagnostics':
					result = await this.executeLspDiagnostics(toolUse);
					break;

					// LSP功能：定义位置
				case 'lsp_definition':
					result = await this.executeLspDefinition(toolUse);
					break;

				// LSP功能：引用查找
				case 'lsp_references':
					result = await this.executeLspReferences(toolUse);
					break;

				// LSP功能：类型定义
				case 'lsp_type_definition':
					result = await this.executeLspTypeDefinition(toolUse);
					break;

				// Skills系统：按需加载专业知识
				case 'skill':
					result = await skillTool(
						{ workspacePath: this.context.workspaceRoot || '', didEditFile: false, fileContextTracker: {} as any } as any,
						toolUse.params,
						this.skillService
					);
					break;

				default:
					result = `未知工具: ${toolUse.name}`;
					break;
			}

				// P1-7: 工具执行成功，重置 Doom Loop 计数
			resetDoomLoopCount(sessionId, toolUse.name);
			return result;
		} catch (error) {
			const errorMsg = `工具 ${toolUse.name} 执行失败: ${error instanceof Error ? error.message : String(error)}`;
			console.error('[Maxian]', errorMsg);
			return errorMsg;
		}
	}

	/**
	 * 检查工具是否可用
	 */
	isToolAvailable(toolName: ToolName): boolean {
		// 始终可用的工具
		if (ALWAYS_AVAILABLE_TOOLS.includes(toolName)) {
			return true;
		}

		// 检查工具组
		for (const group of Object.values(TOOL_GROUPS)) {
			if (group.tools.includes(toolName)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * 获取可用工具列表
	 */
	getAvailableTools(): ToolName[] {
		const tools: ToolName[] = [...ALWAYS_AVAILABLE_TOOLS];

		for (const group of Object.values(TOOL_GROUPS)) {
			for (const tool of group.tools) {
				if (!tools.includes(tool as ToolName)) {
					tools.push(tool as ToolName);
				}
			}
		}

		return tools;
	}

	/**
	 * 处理跟进问题
	 * 返回特殊格式的响应，TaskService会检测并触发用户输入请求
	 */
	private handleFollowupQuestion(toolUse: ToolUse): ToolResponse {
		const { question } = toolUse.params;
		if (!question) {
			return '错误: 未提供问题';
		}
		// 返回特殊格式，TaskService会检测这个前缀并触发用户输入请求
		return `__USER_INPUT_REQUIRED__:${JSON.stringify({ question, toolUseId: toolUse.toolUseId })}`;
	}

	/**
	 * 处理任务完成
	 */
	private handleAttemptCompletion(toolUse: ToolUse): ToolResponse {
		const { result } = toolUse.params;
		// TODO: 实现任务完成逻辑
		return `任务完成: ${result || '(未提供结果)'}`;
	}

	/**
	 * 处理新任务
	 */
	private handleNewTask(toolUse: ToolUse): ToolResponse {
		const { message } = toolUse.params;
		// TODO: 实现新任务创建
		return `创建新任务: ${message || '(未提供消息)'}`;
	}

	/**
	 * 处理待办列表更新（update_todo_list / todowrite）
	 * 完整实现：解析、验证、持久化、返回确认
	 */
	private handleUpdateTodoList(toolUse: ToolUse): ToolResponse {
		const { todos } = toolUse.params;

		if (!todos) {
			return '错误: todos 参数缺失，请提供待办事项数组';
		}

		let rawTodos: IRawTodoInput[];
		try {
			rawTodos = typeof todos === 'string' ? JSON.parse(todos) : todos;
			if (!Array.isArray(rawTodos)) {
				return '错误: todos 必须是数组';
			}
		} catch (e) {
			return `错误: todos 参数解析失败: ${e}`;
		}

		let parsedTodos;
		try {
			parsedTodos = parseTodos(rawTodos);
		} catch (e) {
			return `错误: 待办事项格式无效: ${e instanceof Error ? e.message : String(e)}`;
		}

		const sessionId = this.context.sessionId || 'default';
		TodoStore.update(sessionId, parsedTodos);


		// 触发上下文回调（由 maxianService 注入）
		if (this.context.onTodoListUpdate) {
			this.context.onTodoListUpdate(parsedTodos);
		}

		return formatTodoList(parsedTodos);
	}

	/**
	 * 读取当前 Session 的待办列表（todoread）
	 */
	private handleTodoRead(): ToolResponse {
		const sessionId = this.context.sessionId || 'default';
		const todos = TodoStore.get(sessionId);

		if (todos.length === 0) {
			return '当前没有待办事项。使用 todowrite 工具创建待办列表。';
		}

		return `当前待办列表（共 ${todos.length} 项）:

${formatTodoList(todos)}`;
	}

	/**
	 * 更新执行上下文
	 */
	updateContext(context: Partial<ToolExecutionContext>): void {
		this.context = { ...this.context, ...context };
	}

	/**
	 * 注入子 Agent 运行器（由 maxianService 在 initialize 后调用）
	 */
	setSubAgentRunner(runner: (agentType: string, prompt: string, taskId?: string, taskToolId?: string) => Promise<string>): void {
		this.subAgentRunner = runner;
	}


	/**
	 * P2优化：执行子 Agent 委托（task 工具）
	 * 参考 OpenCode sub-agent 系统设计
	 */
	private async executeTask(toolUse: ToolUse): Promise<ToolResponse> {
		const { subagent_type, prompt, task: taskParam, task_id } = toolUse.params;
		const agentType = subagent_type || 'execute';
		const taskPrompt = prompt || taskParam || '';

		if (!taskPrompt) {
			return '错误: task 工具需要 prompt 参数（任务描述）';
		}

		const validTypes = ['explore', 'plan', 'execute', 'build'];
		if (!validTypes.includes(agentType)) {
			return `错误: 无效的 subagent_type "${agentType}"。有效类型: ${validTypes.join(', ')}`;
		}

		if (!this.subAgentRunner) {
			return '错误: 子 Agent 运行器未初始化。请确保在 maxianService 中调用了 setSubAgentRunner()。';
		}

		const resumeInfo = task_id ? `（恢复 task_id: ${task_id}）` : '（新建）';
		console.log(`[Maxian] 启动子 Agent: type=${agentType}${resumeInfo}, prompt=${taskPrompt.substring(0, 80)}...`);

		try {
			// 传入 task_id 支持 session resume（恢复已有子 Agent 上下文）
			// 传入 toolUse.id 让 runSubAgent 可以更新该 task 工具的 UI 状态
			const result = await this.subAgentRunner(agentType, taskPrompt, task_id, toolUse.toolUseId);
			console.log(`[Maxian] 子 Agent 完成: type=${agentType}`);

			// 在结果中包含 task_id，供主 Agent 后续恢复使用
			const sessionId = task_id || `task_${Date.now()}_${agentType}`;
			return [
				`task_id: ${sessionId} (可用此 ID 通过 task_id 参数恢复本次子 Agent 会话)`,
				'',
				'<task_result>',
				result,
				'</task_result>'
			].join('\n');
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error(`[Maxian] 子 Agent 失败: ${errorMsg}`);
			return `子 Agent 执行失败: ${errorMsg}`;
		}
	}

	/**
	 * P0优化：执行批量工具调用
	 * 参考 OpenCode batch.ts 实现
	 */
	private async executeBatch(toolUse: ToolUse): Promise<ToolResponse> {
		const toolCallsParam = toolUse.params.tool_calls;


		if (!toolCallsParam) {
			console.error('[Maxian] ❌ 错误: tool_calls 参数为空');
			return '错误: batch 工具需要 tool_calls 参数';
		}

		let toolCalls: BatchToolCall[];
		try {
			if (typeof toolCallsParam === 'string') {
				toolCalls = JSON.parse(toolCallsParam);
			} else {
				toolCalls = toolCallsParam;
			}

			if (!Array.isArray(toolCalls)) {
				console.error('[Maxian] ❌ tool_calls 不是数组，类型:', typeof toolCalls);
				return '错误: tool_calls 必须是数组';
			}
		} catch (e) {
			console.error('[Maxian] ❌ tool_calls 解析失败:', e);
			return `错误: tool_calls 参数解析失败: ${e}`;
		}

		if (toolCalls.length === 0) {
			console.error('[Maxian] ❌ tool_calls 数组为空');
			return '错误: tool_calls 不能为空';
		}

		const { results, summary } = await this.batchExecutor.executeBatch(toolCalls);

		// 格式化输出
		const output = this.batchExecutor.formatBatchResponse(results);

		return `${summary}\n\n${output}`;
	}

	/**
	 * P0优化：执行 edit 工具
	 * 基于 fuzzyMatch 的容错字符串替换
	 */
	private async executeEdit(toolUse: ToolUse): Promise<ToolResponse> {
		const params = toolUse.params;

		// 验证参数
		const validation = validateEditParams({
			path: params.path,
			old_string: params.old_string,
			new_string: params.new_string,
			replace_all: params.replace_all === 'true',
			create_if_missing: params.create_if_missing === 'true',
		});

		if (!validation.valid) {
			return `错误: ${validation.error}`;
		}

		const editParams = validation.params!;

		// 早期检测：old_string === new_string 是无效操作（对齐 OpenCode）
		if (editParams.old_string !== undefined && editParams.old_string === editParams.new_string) {
			return `<error>
old_string 和 new_string 完全相同，这是一个无效操作。
请检查您的修改内容，确保 new_string 与 old_string 不同。
</error>`;
		}

		try {
			// 读取文件原始内容（不带行号和XML包装，避免字符串替换失败）
			const content = await this.fileOperations.readRawFileContent(editParams.path);

			// 执行编辑
			const result = executeEdit(content, editParams);

			if (!result.success) {
				return formatEditResponse(result);
			}

			// 写入修改后的内容
			await this.fileOperations.writeToFile({
				type: 'tool_use',
				name: 'write_to_file',
				params: { path: editParams.path, content: result.newContent },
				partial: false,
			} as any);

			return formatEditResponse(result);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			return `编辑失败: ${errorMsg}`;
		}
	}

	/**
	 * P1优化：执行多处编辑
	 * 参考 OpenCode multiedit.ts 实现
	 */
	private async executeMultiedit(toolUse: ToolUse): Promise<ToolResponse> {
		const { path, edits } = toolUse.params;

		if (!path) {
			return '错误: multiedit 工具需要 path 参数';
		}

		if (!edits) {
			return '错误: multiedit 工具需要 edits 参数';
		}

		let editOperations: EditOperation[];
		try {
			editOperations = typeof edits === 'string'
				? JSON.parse(edits)
				: edits;

			if (!Array.isArray(editOperations)) {
				return '错误: edits 必须是数组';
			}
		} catch (e) {
			return `错误: edits 参数解析失败: ${e}`;
		}

		if (editOperations.length === 0) {
			return '错误: edits 不能为空';
		}


		try {
			// 读取文件原始内容（不带行号和XML包装，避免字符串替换失败）
			const rawContent = await this.fileOperations.readRawFileContent(path);

			if (rawContent === null) {
				return `错误: 无法读取文件 ${path}`;
			}

			// 执行多处编辑
			const result = executeMultiedit(rawContent, editOperations);

			if (!result.success) {
				return formatMultieditResponse(result, path);
			}

			// 写入修改后的内容
			await this.fileOperations.writeToFile({
				type: 'tool_use',
				name: 'write_to_file',
				params: { path, content: result.finalContent },
				partial: false,
			} as any);


			return formatMultieditResponse(result, path);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			return `多处编辑失败: ${errorMsg}`;
		}
	}

	/**
	 * P0优化：执行网页获取
	 */
	private async executeWebFetch(toolUse: ToolUse): Promise<ToolResponse> {
		const { url, prompt, format } = toolUse.params;

		if (!url) {
			return '错误: webfetch 工具需要 url 参数';
		}

		// 验证 URL
		const validation = validateUrl(url);
		if (!validation.valid) {
			return `错误: ${validation.error}`;
		}

		console.log(`[Maxian] 获取网页: ${url}`);

		try {
			let html: string;
			let contentType: string = 'text/html';

			if (this.requestService) {
				// 使用 VS Code IRequestService（主进程发请求，无 CORS 限制）
				const context = await this.requestService.request({
					type: 'GET',
					url,
					headers: {
						'User-Agent': 'Mozilla/5.0 (compatible; MaxianIDE/1.0)',
						'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
					},
				}, CancellationToken.None);

				if (!context.res.statusCode || context.res.statusCode < 200 || context.res.statusCode >= 300) {
					return `网页获取失败: HTTP ${context.res.statusCode}`;
				}

				contentType = (context.res.headers as any)['content-type'] || 'text/html';
				html = await asText(context) || '';
			} else {
				// 降级：直接 fetch（可能有 CORS 限制）
				const response = await fetch(url, {
					headers: {
						'User-Agent': 'Mozilla/5.0 (compatible; MaxianIDE/1.0)',
					},
				});

				if (!response.ok) {
					return `网页获取失败: HTTP ${response.status} ${response.statusText}`;
				}

				contentType = response.headers.get('content-type') || 'text/html';
				html = await response.text();
			}

			const result = processResponse(url, html, contentType, {
				url,
				prompt,
				format: format as 'markdown' | 'text' | 'json',
			});

			return formatWebFetchResponse(result);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			return `网页获取失败: ${errorMsg}`;
		}
	}

	/**
	 * P1优化：执行多文件补丁
	 */
	private async executePatch(toolUse: ToolUse): Promise<ToolResponse> {
		const { patches } = toolUse.params;

		if (!patches) {
			return '错误: patch 工具需要 patches 参数';
		}

		let patchList: Array<{ path: string; operations: Array<{ old_string: string; new_string: string }> }>;
		try {
			patchList = typeof patches === 'string' ? JSON.parse(patches) : patches;

			if (!Array.isArray(patchList)) {
				return '错误: patches 必须是数组';
			}
		} catch (e) {
			return `错误: patches 参数解析失败: ${e}`;
		}


		const results: string[] = [];
		let successCount = 0;
		let failCount = 0;

		for (const patch of patchList) {
			try {
				// 读取文件原始内容（不带行号和XML包装）
				const rawContent = await this.fileOperations.readRawFileContent(patch.path);

				if (rawContent === null) {
					results.push(`❌ ${patch.path}: 读取失败`);
					failCount++;
					continue;
				}

				// 执行编辑
				let content = rawContent;
				let patchSuccess = true;

				for (const op of patch.operations) {
					const validation = validateEditParams({
						path: patch.path,
						old_string: op.old_string,
						new_string: op.new_string,
					});

					if (validation.valid) {
						const editResult = executeEdit(content, validation.params!);
						if (editResult.success && editResult.newContent) {
							content = editResult.newContent;
						} else {
							patchSuccess = false;
							break;
						}
					}
				}

				if (patchSuccess) {
					// 写入文件
					await this.fileOperations.writeToFile({
						type: 'tool_use',
						name: 'write_to_file',
						params: { path: patch.path, content },
						partial: false,
					} as any);
					results.push(`✅ ${patch.path}: ${patch.operations.length} 处修改`);
					successCount++;
				} else {
					results.push(`❌ ${patch.path}: 部分操作失败`);
					failCount++;
				}
			} catch (error) {
				results.push(`❌ ${patch.path}: ${error instanceof Error ? error.message : String(error)}`);
				failCount++;
			}
		}

		return `多文件补丁完成: ${successCount}/${patchList.length} 成功\n\n${results.join('\n')}`;
	}

	/**
	 * LSP功能：执行 Hover 查询
	 */
	private async executeLspHover(toolUse: ToolUse): Promise<ToolResponse> {
		const { path, line, column } = toolUse.params;

		if (!path) {
			return '<error>lsp_hover 工具需要 path 参数</error>';
		}

		if (!line) {
			return '<error>lsp_hover 工具需要 line 参数（行号，从1开始）</error>';
		}

		if (!column) {
			return '<error>lsp_hover 工具需要 column 参数（列号，从1开始）</error>';
		}

		const lineNum = parseInt(line, 10);
		const colNum = parseInt(column, 10);

		if (isNaN(lineNum) || lineNum < 1) {
			return '<error>无效的行号，必须是大于0的整数</error>';
		}

		if (isNaN(colNum) || colNum < 1) {
			return '<error>无效的列号，必须是大于0的整数</error>';
		}

		// 解析为绝对路径
		const absolutePath = this.fileOperations.resolveFilePath(path);


		// 调用全局 LSP Hover 处理器
		return await getHoverInfo(absolutePath, lineNum, colNum);
	}

	/**
	 * LSP功能：执行诊断查询
	 */
	private async executeLspDiagnostics(toolUse: ToolUse): Promise<ToolResponse> {
		const { path } = toolUse.params;

		if (!path) {
			return '<error>lsp_diagnostics 工具需要 path 参数</error>';
		}

		// 解析为绝对路径
		const absolutePath = this.fileOperations.resolveFilePath(path);


		// 调用全局 LSP 诊断处理器
		const diagnosticsResult = await getDiagnosticsAfterEdit(absolutePath);

		if (!diagnosticsResult) {
			return `<success>
文件: ${absolutePath}

✅ 此文件没有诊断信息（无错误、无警告）
</success>`;
		}

		return diagnosticsResult;
	}

	/**
	 * LSP功能：执行定义查询
	 */
	private async executeLspDefinition(toolUse: ToolUse): Promise<ToolResponse> {
		const { path, line, column } = toolUse.params;

		if (!path) {
			return '<error>lsp_definition 工具需要 path 参数</error>';
		}

		if (!line) {
			return '<error>lsp_definition 工具需要 line 参数（行号，从1开始）</error>';
		}

		if (!column) {
			return '<error>lsp_definition 工具需要 column 参数（列号，从1开始）</error>';
		}

		const lineNum = parseInt(line, 10);
		const colNum = parseInt(column, 10);

		if (isNaN(lineNum) || lineNum < 1) {
			return '<error>无效的行号，必须是大于0的整数</error>';
		}

		if (isNaN(colNum) || colNum < 1) {
			return '<error>无效的列号，必须是大于0的整数</error>';
		}

		// 解析为绝对路径
		const absolutePath = this.fileOperations.resolveFilePath(path);


		// 调用全局 LSP Definition 处理器
		return await getDefinition(absolutePath, lineNum, colNum);
	}

	/**
	 * LSP功能：执行引用查询
	 */
	private async executeLspReferences(toolUse: ToolUse): Promise<ToolResponse> {
		const { path, line, column } = toolUse.params;

		if (!path) {
			return '<error>lsp_references 工具需要 path 参数</error>';
		}

		if (!line) {
			return '<error>lsp_references 工具需要 line 参数（行号，从1开始）</error>';
		}

		if (!column) {
			return '<error>lsp_references 工具需要 column 参数（列号，从1开始）</error>';
		}

		const lineNum = parseInt(line, 10);
		const colNum = parseInt(column, 10);

		if (isNaN(lineNum) || lineNum < 1) {
			return '<error>无效的行号，必须是大于0的整数</error>';
		}

		if (isNaN(colNum) || colNum < 1) {
			return '<error>无效的列号，必须是大于0的整数</error>';
		}

		// 解析为绝对路径
		const absolutePath = this.fileOperations.resolveFilePath(path);


		// 调用全局 LSP References 处理器
		return await getReferences(absolutePath, lineNum, colNum, true);
	}

	/**
	 * LSP功能：执行类型定义查询
	 */
	private async executeLspTypeDefinition(toolUse: ToolUse): Promise<ToolResponse> {
		const { path, line, column } = toolUse.params;

		if (!path) {
			return '<error>lsp_type_definition 工具需要 path 参数</error>';
		}

		if (!line) {
			return '<error>lsp_type_definition 工具需要 line 参数（行号，从1开始）</error>';
		}

		if (!column) {
			return '<error>lsp_type_definition 工具需要 column 参数（列号，从1开始）</error>';
		}

		const lineNum = parseInt(line, 10);
		const colNum = parseInt(column, 10);

		if (isNaN(lineNum) || lineNum < 1) {
			return '<error>无效的行号，必须是大于0的整数</error>';
		}

		if (isNaN(colNum) || colNum < 1) {
			return '<error>无效的列号，必须是大于0的整数</error>';
		}

		// 解析为绝对路径
		const absolutePath = this.fileOperations.resolveFilePath(path);


		// 调用全局 LSP TypeDefinition 处理器
		return await getTypeDefinition(absolutePath, lineNum, colNum);
	}
}
