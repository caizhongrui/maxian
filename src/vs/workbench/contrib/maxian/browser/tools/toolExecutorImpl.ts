/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IToolExecutor, ToolExecutionContext } from '../../common/tools/toolExecutor.js';
import { ToolUse, ToolResponse, ToolName, ALWAYS_AVAILABLE_TOOLS, TOOL_GROUPS } from '../../common/tools/toolTypes.js';
import { FileOperationsTool } from './fileOperations.js';
import { CommandExecutionTool } from './commandExecution.js';
import { SearchTool } from './searchTools.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';
import { ISearchService } from '../../../../services/search/common/search.js';
import { IRipgrepService } from '../../../../services/ripgrep/common/ripgrep.js';

/**
 * 工具执行器实现类
 * 负责调度和执行各种工具
 */
export class ToolExecutorImpl implements IToolExecutor {
	private fileOperations: FileOperationsTool;
	private commandExecution: CommandExecutionTool;
	private searchTool: SearchTool;
	private context: ToolExecutionContext;

	constructor(
		fileService: IFileService,
		terminalService: ITerminalService,
		searchService: ISearchService,
		ripgrepService: IRipgrepService,
		context: ToolExecutionContext
	) {
		this.fileOperations = new FileOperationsTool(fileService, context.workspaceRoot || '');
		this.commandExecution = new CommandExecutionTool(terminalService);
		this.searchTool = new SearchTool(searchService, ripgrepService, context.workspaceRoot || '');
		this.context = context;
	}

	/**
	 * 执行工具调用
	 */
	async executeTool(toolUse: ToolUse): Promise<ToolResponse> {
		console.log('[Maxian] 执行工具:', toolUse.name, '参数:', toolUse.params);

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

				case 'list_files':
					result = await this.fileOperations.listFiles(toolUse as any);
					break;

				case 'glob':
					result = await this.fileOperations.glob(toolUse as any);
					break;

				// 命令执行工具
				case 'execute_command':
					result = await this.commandExecution.executeCommand(toolUse as any);
					break;

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

				// 编辑工具
				case 'apply_diff':
					result = await this.fileOperations.applyDiff(toolUse as any);
					break;

				// 编辑工具（待实现）
				case 'edit_file':
				case 'insert_content':
					result = `工具 ${toolUse.name} 暂未实现`;
					break;

				default:
					result = `未知工具: ${toolUse.name}`;
					break;
			}

			console.log('[Maxian] 工具执行成功:', toolUse.name);
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
	 * 处理待办列表更新
	 */
	private handleUpdateTodoList(toolUse: ToolUse): ToolResponse {
		const { todos } = toolUse.params;
		// TODO: 实现待办列表更新
		return `更新待办列表: ${todos || '(未提供待办项)'}`;
	}

	/**
	 * 更新执行上下文
	 */
	updateContext(context: Partial<ToolExecutionContext>): void {
		this.context = { ...this.context, ...context };
	}
}
