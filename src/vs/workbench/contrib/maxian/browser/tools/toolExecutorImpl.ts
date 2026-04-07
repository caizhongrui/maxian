/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IToolExecutor, ToolExecutionContext, ToolExecutionResult } from '../../common/tools/toolExecutor.js';
import { ToolUse, ToolResponse, ToolName, ALWAYS_AVAILABLE_TOOLS, TOOL_GROUPS } from '../../common/tools/toolTypes.js';
import { FileOperationsTool } from './fileOperations.js';
import { CommandExecutionTool } from './commandExecution.js';
import { SearchTool } from './searchTools.js';
import { TodoStore, parseTodos, formatTodoList, IRawTodoInput, shouldAutoClean, getVerificationNudge } from '../../common/tools/todoStore.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';
import { ISearchService } from '../../../../services/search/common/search.js';
import { IRipgrepService } from '../../../../services/ripgrep/common/ripgrep.js';
import { BatchToolExecutor, BatchToolCall } from '../../common/tools/batchTool.js';
import { executeMultiedit, formatMultieditResponse, EditOperation } from '../../common/tools/multieditTool.js';
import { detectDoomLoop, resetDoomLoopCount } from '../../common/agent/doomLoopDetector.js';
import { isToolEnabledForAgent, checkBashPermission } from '../../common/agent/agentConfig.js';
import { executeEdit, validateEditParams, formatEditResponse } from '../../common/tools/editTool.js';
import { skillTool } from '../../common/tools/skillTool.js';
import { ISkillService } from '../../../skills/common/skillService.js';
import { getHoverInfo } from '../../common/lsp/lspHover.js';
import { Diagnostic, captureDiagnosticsBaseline, getCurrentDiagnostics, getDiagnosticsAfterEdit } from '../../common/lsp/lspDiagnostics.js';
import { getDefinition } from '../../common/lsp/lspDefinition.js';
import { getReferences } from '../../common/lsp/lspReferences.js';
import { getTypeDefinition } from '../../common/lsp/lspTypeDefinition.js';
import { ICommandExecutionService } from '../../common/services/commandExecutionService.js';
import { consumePathSavedByDiff } from '../diffViewProvider.js';
import { prReviewTool, RunCommandFn } from '../../common/tools/prReviewTool.js';
import { generateTestsTool, FileSystemOps } from '../../common/tools/generateTestsTool.js';
import { IVectorSearchService } from '../../common/vector/IVectorSearchService.js';
import { URI } from '../../../../../base/common/uri.js';
import { McpHub } from '../../common/mcp/McpHub.js';
import { FileStateCache } from '../../common/file/fileStateCache.js';
import { HooksManager } from '../../common/hooks/hooksManager.js';

/**
 * 工具执行器实现类
 * 负责调度和执行各种工具
 */
export class ToolExecutorImpl implements IToolExecutor {
	private static readonly FILE_MUTATION_TOOLS = new Set<ToolName>([
		'write_to_file',
		'apply_diff',
		'edit',
		'edit_file',
		'insert_content',
		'multiedit',
		'patch',
		'delete_file',
		'create_directory',
	]);

	private fileOperations: FileOperationsTool;
	private commandExecution: CommandExecutionTool;
	private searchTool: SearchTool;
	private batchExecutor: BatchToolExecutor;
	private context: ToolExecutionContext;
	private skillService?: ISkillService;

	/**
	 * 文件读取计数器：记录每个文件在当前 Agent 生命周期中被 read_file 读取的次数
	 * key: 绝对路径, value: 读取次数
	 * 注：B3/D2 后重复读未变文件会返回 FILE_UNCHANGED_STUB，此计数器仅用于统计，不再 FATAL
	 */
	private fileReadCount: Map<string, number> = new Map();

	/**
	 * 记录当前任务中 direct write_to_file 的成功次数。
	 * 同一路径第二次整文件重写必须被阻断，改用精确编辑工具。
	 */
	private successfulWriteToFileCounts: Map<string, number> = new Map();

	/** D2: 文件内容内存缓存，与 FileOperationsTool 共享同一实例 */
	private readonly fileStateCache: FileStateCache = new FileStateCache();

	/** C5: Hooks 管理器 */
	private readonly hooksManager: HooksManager;

	/**
	 * 子 Agent 运行器（由 maxianService 注入）
	 * 接受 agentType 和 prompt，返回子 Agent 的完成结果
	 */
	private subAgentRunner?: (agentType: string, prompt: string, taskId?: string, taskToolId?: string) => Promise<string>;

	private vectorSearchService?: IVectorSearchService;
	private commandExecutionService?: ICommandExecutionService;
	private fileService: IFileService;
	private mcpHub?: McpHub;

	constructor(
		fileService: IFileService,
		terminalService: ITerminalService,
		searchService: ISearchService,
		ripgrepService: IRipgrepService,
		context: ToolExecutionContext,
		skillService?: ISkillService,
		commandExecutionService?: ICommandExecutionService,
		modelService?: IModelService,
		vectorSearchService?: IVectorSearchService
	) {
		this.fileService = fileService;
		this.commandExecutionService = commandExecutionService;
		this.fileOperations = new FileOperationsTool(fileService, context.workspaceRoot || '', undefined, modelService, this.fileStateCache);
		this.hooksManager = new HooksManager(context.workspaceRoot || '');
		this.commandExecution = new CommandExecutionTool(terminalService);
		if (commandExecutionService) {
			this.commandExecution.setCommandExecutionService(commandExecutionService);
		}
		this.searchTool = new SearchTool(searchService, ripgrepService, context.workspaceRoot || '', fileService);
		this.context = context;
		this.skillService = skillService;
		this.vectorSearchService = vectorSearchService;
		// P0优化：初始化批量执行器
		this.batchExecutor = new BatchToolExecutor(this);
	}

	/**
	 * 构建 RunCommandFn 适配器，供 prReviewTool 使用
	 */
	private buildRunCommandFn(): RunCommandFn {
		const svc = this.commandExecutionService;
		return async (command: string, cwd: string) => {
			if (!svc) {
				return { output: '', error: 'Command execution service not available' };
			}
			try {
				const result = await svc.execute(command, { cwd, timeout: 30000 });
				if (result.exitCode === 0 || (result.exitCode !== 0 && result.stdout)) {
					// 非零退出码也可能有有效输出（如 git rev-parse 验证命令）
					if (result.exitCode !== 0 && !result.stdout) {
						return { output: '', error: result.stderr || `exit code ${result.exitCode}` };
					}
					return { output: result.stdout, error: result.exitCode !== 0 ? (result.stderr || null) : null };
				}
				return { output: '', error: result.stderr || `exit code ${result.exitCode}` };
			} catch (err: any) {
				return { output: '', error: err.message || String(err) };
			}
		};
	}

	/**
	 * 构建 FileSystemOps 适配器，供 generateTestsTool 使用
	 */
	private buildFileSystemOps(): FileSystemOps {
		const fs = this.fileService;
		return {
			exists: async (filePath: string) => {
				try {
					await fs.stat(URI.file(filePath));
					return true;
				} catch {
					return false;
				}
			},
			stat: async (filePath: string) => {
				const s = await fs.stat(URI.file(filePath));
				return { size: s.size, isDirectory: s.isDirectory };
			},
			readText: async (filePath: string) => {
				const content = await fs.readFile(URI.file(filePath));
				return content.value.toString();
			},
			readdir: async (dirPath: string) => {
				const resolved = await fs.resolve(URI.file(dirPath));
				return resolved.children?.map(c => c.name) ?? [];
			},
		};
	}

	/**
	 * 执行工具调用
	 */
	async executeTool(toolUse: ToolUse): Promise<ToolResponse> {
		const execution = await this.executeToolWithResult(toolUse);
		if (execution.result !== undefined) {
			return execution.result;
		}
		return execution.error || '';
	}

	async preflightToolUse(toolUse: ToolUse): Promise<ToolExecutionResult | null> {
		switch (toolUse.name) {
			case 'write_to_file':
				return this.preflightWriteToFileToolUse(toolUse);
			case 'edit':
				return this.preflightEditToolUse(toolUse);
			case 'multiedit':
				return this.preflightMultieditToolUse(toolUse);
			default:
				return null;
		}
	}

	async executeToolWithResult(toolUse: ToolUse): Promise<ToolExecutionResult> {
		// P2-9: Agent 工具过滤检查
		const agentName = this.context.agentName || 'build';
		if (!isToolEnabledForAgent(agentName, toolUse.name as ToolName)) {
			console.warn(`[Maxian] 工具 ${toolUse.name} 对 Agent ${agentName} 不可用`);
			return this.createExecutionResult(toolUse, false, 'error', `工具 ${toolUse.name} 对当前 Agent (${agentName}) 不可用。\n\n该 Agent 的权限配置不允许使用此工具。`, '当前 Agent 无权使用该工具');
		}

		// P2-10: Bash 命令权限检查
		if (toolUse.name === 'execute_command' && toolUse.params.command) {
			const bashPermission = checkBashPermission(agentName, toolUse.params.command);
			if (bashPermission === 'deny') {
				console.warn(`[Maxian] 命令 "${toolUse.params.command}" 对 Agent ${agentName} 被拒绝`);
				return this.createExecutionResult(toolUse, false, 'error', `命令 "${toolUse.params.command}" 被拒绝执行。\n\n当前 Agent (${agentName}) 没有执行此命令的权限。`, '当前 Agent 无权执行该命令');
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
			return this.createExecutionResult(
				toolUse,
				false,
				'blocked_loop',
				`⚠️ Doom Loop 检测警告\n\n${doomLoopResult.message}\n\n请分析问题原因并尝试不同的方法。`,
				doomLoopResult.message || '检测到重复工具调用'
			);
		}

		try {
			// C5: PreToolUse Hooks — 在工具执行前运行，非0退出码可阻止执行
			const preHookResult = await this.hooksManager.runPreToolUseHooks(toolUse.name, toolUse.params || {});
			if (preHookResult.blocked) {
				console.warn(`[Maxian] C5 PreToolUse hook 阻止工具执行: ${toolUse.name}`);
				return this.createExecutionResult(toolUse, false, 'error', `<error>[Hook 阻止] 工具 "${toolUse.name}" 被 PreToolUse hook 阻止：\n${preHookResult.blockReason}</error>`, preHookResult.blockReason);
			}

			let result: ToolResponse = '';
			let executionToolUse: ToolUse = toolUse;

			// 埋点：工具使用事件（在分发前统一上报，使用可选链静默处理）
			this.context.behaviorReporter?.reportToolUse(toolUse.name);

			switch (toolUse.name) {
				// 文件操作工具
				case 'read_file': {
					// D2/B3: readFile 内部已实现缓存检测，文件未变时返回 FILE_UNCHANGED_STUB（~20 tokens）
					// 不再需要 DUPLICATE_READ FATAL——STUB 本身就告知 AI 文件未变，自然终止重读循环
					const readFilePath = toolUse.params?.path as string || '';
					const resolvedReadPath = readFilePath ? this.fileOperations.resolveFilePath(readFilePath) : readFilePath;
					const prevCount = this.fileReadCount.get(resolvedReadPath) || 0;
					const newCount = prevCount + 1;
					this.fileReadCount.set(resolvedReadPath, newCount);

					result = await this.fileOperations.readFile(toolUse as any);

					// 仅在第2次读取且非 STUB 时（说明文件已被修改）附加一次提示
					if (newCount === 2 && typeof result === 'string' && !result.includes('<file_unchanged>')) {
						result = result + `\n\n⚠️ [重复读取] 这是第 ${newCount} 次读取 "${readFilePath}"（文件已变动，本次返回最新内容）。`;
					}
					break;
				}

				case 'write_to_file': {
					const writePath = toolUse.params?.path as string || '';
					const resolvedWritePath = writePath ? this.fileOperations.resolveFilePath(writePath) : writePath;
					const mutationGuard = await this.ensureExplicitReadBeforeMutation(resolvedWritePath, {
						allowCreate: true,
					});
					if (mutationGuard) {
						result = mutationGuard;
						break;
					}
					const baseline = resolvedWritePath ? await this.captureDiagnosticBaseline(resolvedWritePath) : [];
					this.fileReadCount.delete(resolvedWritePath);
					result = await this.fileOperations.writeToFile(toolUse as any);
					if (resolvedWritePath && !this.isFailureText(this.toTextResult(result))) {
						this.successfulWriteToFileCounts.set(
							resolvedWritePath,
							(this.successfulWriteToFileCounts.get(resolvedWritePath) || 0) + 1
						);
						result = await this.appendDiagnosticDelta(resolvedWritePath, result, baseline);
					}
					break;
				}

				case 'delete_file':
					result = await this.fileOperations.deleteFile(toolUse);
					break;

				case 'create_directory':
					result = await this.fileOperations.createDirectory(toolUse);
					break;

				case 'list_files':
					result = await this.fileOperations.listFiles(toolUse as any);
					break;

				case 'glob':
					result = await this.fileOperations.glob(toolUse as any);
					break;

				// 命令执行工具（requires_approval机制参考Cline）
				case 'execute_command': {
					const deleteCommandIntent = this.inspectDeleteCommandIntent(toolUse.params.command || '');
					if (deleteCommandIntent) {
						if (deleteCommandIntent.kind === 'block') {
							result = `错误: 检测到删除命令，请勿使用 execute_command 删除文件。\n${deleteCommandIntent.reason}\n请改用 delete_file 工具。`;
							break;
						}

						executionToolUse = {
							...toolUse,
							name: 'delete_file',
							params: {
								path: deleteCommandIntent.path,
								recursive: deleteCommandIntent.recursive ? 'true' : 'false',
							} as any,
						};
						const deleteResult = await this.fileOperations.deleteFile(executionToolUse);
						const deleteText = typeof deleteResult === 'string' ? deleteResult : JSON.stringify(deleteResult);
						if (deleteText.startsWith('错误:') || deleteText.startsWith('删除失败:')) {
							result = deleteText;
						} else {
							result = `已将删除命令重定向为 delete_file 工具执行（避免 shell 删除后 VS Code 文件系统状态不同步）。\n${deleteText}`;
						}
						break;
					}

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

				case 'codebase_search': {
					const semanticQuery: string = toolUse.params.query || '';
					const semanticPath: string = toolUse.params.path || '';
					const workspaceRoot = this.context.workspaceRoot || '';
					// 向量索引始终以工作区根目录为 key，子路径不能作为 cwd（否则找不到索引）
					const semanticCwd = workspaceRoot;
					// 如果 AI 传了子路径，解析为绝对路径用于过滤搜索结果
					const subPathFilter = semanticPath
						? (semanticPath.startsWith('/') ? semanticPath : workspaceRoot.replace(/\/$/, '') + '/' + semanticPath)
						: null;
					// 优先尝试语义向量搜索，失败时 fallback 到 ripgrep 关键字搜索
					let semanticUsed = false;
					if (semanticQuery && semanticCwd && this.vectorSearchService) {
						try {
							// 语义搜索超时：10秒（等待模型加载 + 索引检查）
							// 若超时则静默 fallback 到关键字搜索
							const semanticTimeoutPromise = new Promise<never>((_, reject) =>
								setTimeout(() => reject(new Error('semantic_search_timeout')), 10000)
							);
							let semanticResults = await Promise.race([
								this.vectorSearchService.semanticSearch(semanticQuery, semanticCwd, 10),
								semanticTimeoutPromise
							]);
							// 若 AI 传了子路径，过滤结果只保留该路径下的文件
							if (subPathFilter && semanticResults.length > 0) {
								semanticResults = semanticResults.filter(r => r.filePath.startsWith(subPathFilter));
							}
							if (semanticResults.length > 0) {
								result = this.vectorSearchService.formatResults(semanticResults, semanticQuery);
								semanticUsed = true;
							}
						} catch (semanticError: any) {
							if (semanticError?.message === 'semantic_search_timeout') {
								console.warn('[ToolExecutor] 语义搜索超时，fallback到关键字搜索');
							} else {
								console.warn('[ToolExecutor] 语义搜索失败，fallback到关键字搜索:', semanticError);
							}
						}
					}
					if (!semanticUsed) {
						result = await this.searchTool.codebaseSearch(toolUse as any);
					}
					break;
				}

				case 'list_code_definition_names':
					result = await this.searchTool.listCodeDefinitionNames(toolUse.params.path || '');
					break;

				// Agent控制工具
				case 'ask_followup_question':
					result = this.handleFollowupQuestion(toolUse);
					break;

				case 'attempt_completion':
					// 由 TaskService.handleAttemptCompletion 处理，此分支不应被到达
					result = `[attempt_completion] 已由主循环处理`;
					break;

				case 'new_task':
					// 由 TaskService 主循环处理，此分支不应被到达
					result = `[new_task] 已由主循环处理`;
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
				case 'apply_diff': {
					const diffPath = toolUse.params?.path as string || '';
					const resolvedDiffPath = diffPath ? this.fileOperations.resolveFilePath(diffPath) : diffPath;
					const mutationGuard = await this.ensureExplicitReadBeforeMutation(resolvedDiffPath);
					if (mutationGuard) {
						result = mutationGuard;
						break;
					}
					const baseline = resolvedDiffPath ? await this.captureDiagnosticBaseline(resolvedDiffPath) : [];
					if (diffPath) { this.fileReadCount.delete(this.fileOperations.resolveFilePath(diffPath)); }
					result = await this.fileOperations.applyDiff(toolUse as any);
					if (resolvedDiffPath && !this.isFailureText(this.toTextResult(result))) {
						result = await this.appendDiagnosticDelta(resolvedDiffPath, result, baseline);
					}
					break;
				}

				// 独立 edit 工具（P0优化：基于 fuzzyMatch 的容错替换）
				case 'edit': {
					const editPath = toolUse.params?.path as string || '';
					if (editPath) { this.fileReadCount.delete(this.fileOperations.resolveFilePath(editPath)); }
					result = await this.executeEdit(toolUse);
					break;
				}

				// P0优化：批量执行工具
				case 'batch':
					result = await this.executeBatch(toolUse);
					break;

				// P1优化：多处编辑工具
				case 'multiedit': {
					const multieditPath = toolUse.params?.path as string || '';
					if (multieditPath) { this.fileReadCount.delete(this.fileOperations.resolveFilePath(multieditPath)); }
					result = await this.executeMultiedit(toolUse);
					break;
				}

				// P1优化：多文件补丁
				case 'patch':
					result = await this.executePatch(toolUse);
					break;

				// P1优化：统一LSP工具（推荐入口）
				case 'lsp':
					result = await this.executeLsp(toolUse);
					break;

				// 兼容旧 LSP 工具名
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

				// PR代码审查工具
				case 'pr_review':
					result = await prReviewTool(
						this.context.workspaceRoot || '.',
						{
							base_branch: toolUse.params.base_branch,
							focus: toolUse.params.focus,
						},
						this.buildRunCommandFn()
					);
					break;

				// 测试代码生成工具
				case 'generate_tests':
					result = await generateTestsTool(
						this.context.workspaceRoot || '.',
						{
							target_file: toolUse.params.target_file || '',
							test_framework: toolUse.params.test_framework,
							output_path: toolUse.params.output_path,
						},
						this.buildFileSystemOps()
					);
					break;

				// MCP 工具调用
				case 'use_mcp_tool': {
					const serverName = toolUse.params.server_name;
					const mcpToolName = toolUse.params.tool_name;
					const mcpArgs = toolUse.params.arguments;

					if (!serverName) { result = '错误: use_mcp_tool 需要 server_name 参数'; break; }
					if (!mcpToolName) { result = '错误: use_mcp_tool 需要 tool_name 参数'; break; }
					if (!this.mcpHub) { result = '错误: MCP Hub 未初始化，请先在设置中配置 MCP 服务器'; break; }

					let parsedArgs: Record<string, unknown> | undefined;
					if (mcpArgs) {
						try { parsedArgs = JSON.parse(mcpArgs); }
						catch { result = `错误: arguments 参数不是有效 JSON: ${mcpArgs}`; break; }
					}

					const mcpResult = await this.mcpHub.callTool(serverName, mcpToolName, parsedArgs);
					if (mcpResult.isError) {
						result = `MCP 工具调用失败:\n${mcpResult.content.map((c: any) => c.text || '').join('\n')}`;
					} else {
						result = mcpResult.content.map((c: any) => {
							if (c.type === 'text') return c.text || '';
							if (c.type === 'image') return `[图片: ${c.mimeType}]`;
							if (c.type === 'resource' && c.resource) return c.resource.text || JSON.stringify(c.resource);
							if (c.type === 'resource_link') return `资源链接: ${c.name || c.uri}${c.description ? ' - ' + c.description : ''}`;
							return '';
						}).filter(Boolean).join('\n\n') || '(无返回内容)';
					}
					break;
				}

				// MCP 资源访问
				case 'access_mcp_resource': {
					const resourceServer = toolUse.params.server_name;
					const resourceUri = toolUse.params.uri;

					if (!resourceServer) { result = '错误: access_mcp_resource 需要 server_name 参数'; break; }
					if (!resourceUri) { result = '错误: access_mcp_resource 需要 uri 参数'; break; }
					if (!this.mcpHub) { result = '错误: MCP Hub 未初始化，请先在设置中配置 MCP 服务器'; break; }

					const resourceResult = await this.mcpHub.readResource(resourceServer, resourceUri);
					result = resourceResult.contents.map((item: any) => {
						if (item.text) return item.text;
						if (item.blob) return `[二进制内容: ${item.mimeType}]`;
						return '';
					}).filter(Boolean).join('\n\n') || '(空响应)';
					break;
				}

				default:
					result = `未知工具: ${toolUse.name}`;
					break;
			}

			// C5: PostToolUse Hooks — 在工具执行后运行，stdout 非空则替换输出
			const postHookResult = await this.hooksManager.runPostToolUseHooks(
				executionToolUse.name,
				executionToolUse.params || {},
				typeof result === 'string' ? result : JSON.stringify(result)
			);
			if (postHookResult.replacedOutput !== undefined) {
				console.log(`[Maxian] C5 PostToolUse hook 替换输出: ${executionToolUse.name}`);
				result = postHookResult.replacedOutput;
			}

			const execution = this.classifyExecutionResult(executionToolUse, result);
			if (execution.success) {
				resetDoomLoopCount(sessionId, executionToolUse.name);
			}
			return execution;
		} catch (error) {
			const errorMsg = `工具 ${toolUse.name} 执行失败: ${error instanceof Error ? error.message : String(error)}`;
			console.error('[Maxian]', errorMsg);
			return this.createExecutionResult(toolUse, false, 'error', errorMsg, errorMsg);
		}
	}

	clearCommittedStateForPaths(paths: string[]): void {
		if (paths.length === 0) {
			return;
		}

		this.searchTool.invalidatePaths(paths);
		for (const filePath of paths) {
			this.fileReadCount.delete(filePath);
		}
	}

	private inspectDeleteCommandIntent(commandRaw: string): { kind: 'rewrite'; path: string; recursive: boolean } | { kind: 'block'; reason: string } | null {
		const command = (commandRaw || '').trim();
		if (!command) {
			return null;
		}

		const lower = command.toLowerCase();
		const commandHead = lower.split(/\s+/, 1)[0];
		const isDeleteCommand = commandHead === 'rm' || commandHead === 'del' || commandHead === 'rmdir' || commandHead === 'rd';
		if (!isDeleteCommand) {
			return null;
		}

		if (command.includes('&&') || command.includes('||') || command.includes('|') || command.includes(';')) {
			return { kind: 'block', reason: '删除命令包含管道或多段命令，无法安全改写。' };
		}

		let optionPart = '';
		let pathPart = '';
		let recursive = false;

		if (commandHead === 'rm') {
			const match = command.match(/^rm\s+((?:-\S+\s+)*)?(.+)$/i);
			if (!match) {
				return { kind: 'block', reason: 'rm 命令格式不正确。' };
			}
			optionPart = (match[1] || '').trim();
			pathPart = (match[2] || '').trim();
			recursive = /(^|\s)--recursive(\s|$)/i.test(optionPart) || /(^|\s)-[^\s]*r[^\s]*/i.test(optionPart);
		} else if (commandHead === 'del') {
			const match = command.match(/^del\s+((?:\/\S+\s+)*)?(.+)$/i);
			if (!match) {
				return { kind: 'block', reason: 'del 命令格式不正确。' };
			}
			optionPart = (match[1] || '').trim();
			pathPart = (match[2] || '').trim();
			recursive = /(^|\s)\/s(\s|$)/i.test(optionPart);
		} else {
			const match = command.match(/^(?:rmdir|rd)\s+((?:\/\S+\s+)*)?(.+)$/i);
			if (!match) {
				return { kind: 'block', reason: 'rmdir/rd 命令格式不正确。' };
			}
			optionPart = (match[1] || '').trim();
			pathPart = (match[2] || '').trim();
			recursive = /(^|\s)\/s(\s|$)/i.test(optionPart);
		}

		const normalizedPath = this.extractSinglePathToken(pathPart);
		if (!normalizedPath) {
			return { kind: 'block', reason: '删除命令必须只包含一个明确路径（含空格时需用引号包裹）。' };
		}
		if (normalizedPath.includes('*') || normalizedPath.includes('?')) {
			return { kind: 'block', reason: '删除命令包含通配符，无法安全改写。' };
		}

		return {
			kind: 'rewrite',
			path: normalizedPath,
			recursive
		};
	}

	private extractSinglePathToken(rawPathPart: string): string | null {
		const raw = rawPathPart.trim();
		if (!raw) {
			return null;
		}

		const doubleQuotedMatch = raw.match(/^"([^"]+)"$/);
		if (doubleQuotedMatch) {
			return doubleQuotedMatch[1];
		}

		const singleQuotedMatch = raw.match(/^'([^']+)'$/);
		if (singleQuotedMatch) {
			return singleQuotedMatch[1];
		}

		if (/\s/.test(raw)) {
			return null;
		}

		return raw;
	}

	private classifyExecutionResult(toolUse: ToolUse, result: ToolResponse): ToolExecutionResult {
		const text = this.toTextResult(result);
		const normalized = text.trim();

		if (typeof result === 'string' && normalized.startsWith('__APPROVAL_REQUIRED__:')) {
			return this.createExecutionResult(toolUse, true, 'approval_required', result);
		}

		if (typeof result === 'string' && normalized.startsWith('__USER_INPUT_REQUIRED__:')) {
			return this.createExecutionResult(toolUse, true, 'input_required', result);
		}

		const explicitProtocolStatus = this.parseProtocolStatus(normalized);
		if (explicitProtocolStatus) {
			return this.createExecutionResult(
				toolUse,
				explicitProtocolStatus.success,
				explicitProtocolStatus.status,
				result,
				explicitProtocolStatus.error,
				{
					code: explicitProtocolStatus.code,
					retryable: explicitProtocolStatus.retryable,
					nextAction: explicitProtocolStatus.nextAction,
				}
			);
		}

		if (this.isFailureText(normalized)) {
			return this.createExecutionResult(toolUse, false, 'error', result, this.stripXmlTags(normalized), {
				code: 'TOOL_EXECUTION_ERROR',
				retryable: false,
				nextAction: 'refocus',
			});
		}

		return this.createExecutionResult(toolUse, true, 'success', result);
	}

	private createExecutionResult(
		toolUse: ToolUse,
		success: boolean,
		status: ToolExecutionResult['status'],
		result?: ToolResponse,
		error?: string,
		options?: {
			code?: string;
			retryable?: boolean;
			nextAction?: ToolExecutionResult['nextAction'];
		}
	): ToolExecutionResult {
		const affectedPaths = this.getAffectedPaths(toolUse);
		const didWrite = success && ToolExecutorImpl.FILE_MUTATION_TOOLS.has(toolUse.name);
		return {
			success,
			status,
			code: options?.code,
			retryable: options?.retryable,
			nextAction: options?.nextAction,
			result,
			error,
			metadata: {
				toolName: toolUse.name,
				affectedPaths,
				didWrite,
				shouldInvalidateSearchCache: didWrite,
				shouldResetReadTracking: didWrite,
				shouldCacheResult: success && !didWrite,
			}
		};
	}

	private getAffectedPaths(toolUse: ToolUse): string[] {
		const path = toolUse.params.path || toolUse.params.target_file;
		if (path) {
			return [this.fileOperations.resolveFilePath(path)];
		}

		if (toolUse.name === 'patch' && toolUse.params.patches) {
			try {
				const patches = typeof toolUse.params.patches === 'string'
					? JSON.parse(toolUse.params.patches)
					: toolUse.params.patches;
				if (Array.isArray(patches)) {
					return patches
						.map((patch: any) => patch?.path)
						.filter((patchPath: string | undefined): patchPath is string => typeof patchPath === 'string' && patchPath.length > 0)
						.map((patchPath: string) => this.fileOperations.resolveFilePath(patchPath));
				}
			} catch {
				return [];
			}
		}

		return [];
	}

	private toTextResult(result: ToolResponse): string {
		return typeof result === 'string' ? result : JSON.stringify(result);
	}

	private stripXmlTags(text: string): string {
		return text.replace(/<[^>]+>/g, '').trim();
	}

	private parseProtocolStatus(text: string): {
		success: boolean;
		status: ToolExecutionResult['status'];
		error?: string;
		code?: string;
		retryable?: boolean;
		nextAction?: ToolExecutionResult['nextAction'];
	} | null {
		if (!text) {
			return null;
		}

		if (text.includes('<fatal_error>')) {
			return {
				success: false,
				status: 'fatal_error',
				error: this.stripXmlTags(text),
				code: 'FATAL_TOOL_ERROR',
				retryable: false,
				nextAction: 'ask_user',
			};
		}

		if (text.includes('<error>')) {
			const normalized = this.stripXmlTags(text);
			return {
				success: false,
				status: 'error',
				error: normalized,
				code: 'TOOL_ERROR',
				retryable: false,
				nextAction: this.inferNextActionFromError(normalized),
			};
		}

		return null;
	}

	private inferNextActionFromError(errorText: string): ToolExecutionResult['nextAction'] {
		if (
			errorText.includes('must be read') ||
			errorText.includes('先读取') ||
			errorText.includes('modified since read') ||
			errorText.includes('预检查失败')
		) {
			return 'read_before_write';
		}
		return 'refocus';
	}

	private isFailureText(text: string): boolean {
		const normalized = text.trim();
		if (!normalized) {
			return false;
		}

		if (normalized.includes('<error>') || normalized.includes('<fatal_error>')) {
			return true;
		}

		const prefixes = [
			'错误:',
			'编辑失败:',
			'多处编辑失败:',
			'搜索文件失败:',
			'代码库搜索失败:',
			'未知工具:',
			'⚠️ Doom Loop 检测警告',
			'[BLOCK]',
			'[FATAL]',
		];

		if (prefixes.some(prefix => normalized.startsWith(prefix))) {
			return true;
		}

		return normalized.startsWith('❌') || normalized.startsWith('[FATAL]');
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
		let options: string[] = [];
		const rawOptions = toolUse.params.options;
		if (Array.isArray(rawOptions)) {
			options = rawOptions.map(v => String(v).trim()).filter(Boolean);
		} else if (typeof rawOptions === 'string' && rawOptions.trim().length > 0) {
			try {
				const parsed = JSON.parse(rawOptions);
				if (Array.isArray(parsed)) {
					options = parsed.map(v => String(v).trim()).filter(Boolean);
				}
			} catch {
				// 非 JSON 时降级按分号/换行切分
				options = rawOptions
					.split(/\r?\n|;/)
					.map(v => v.trim())
					.filter(Boolean);
			}
		}
		options = options.slice(0, 6);
		// 返回特殊格式，TaskService会检测这个前缀并触发用户输入请求
		return `__USER_INPUT_REQUIRED__:${JSON.stringify({ question, options, toolUseId: toolUse.toolUseId })}`;
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

		// A8优化: 所有 todo 均 completed/failed 时自动清空列表（对齐 Claude Code）
		if (shouldAutoClean(parsedTodos)) {
			TodoStore.clear(sessionId);
			if (this.context.onTodoListUpdate) {
				this.context.onTodoListUpdate([]);
			}
			return '所有待办任务已完成，列表已清空。';
		}

		TodoStore.update(sessionId, parsedTodos);

		// 触发上下文回调（由 maxianService 注入）
		if (this.context.onTodoListUpdate) {
			this.context.onTodoListUpdate(parsedTodos);
		}

		let response = formatTodoList(parsedTodos);
		// A8优化: 3+ completed 时注入验证 nudge（对齐 Claude Code）
		const nudge = getVerificationNudge(parsedTodos);
		if (nudge) { response += nudge; }
		return response;
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
	 * 注入 MCP Hub（由 maxianService 注入）
	 */
	setMcpHub(hub: McpHub): void {
		this.mcpHub = hub;
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

		const sessionId = task_id || `task_${Date.now()}_${agentType}`;
		const sessionInfo = task_id ? `（task_id: ${task_id}）` : `（新建委托: ${sessionId}）`;
		console.log(`[Maxian] 启动子 Agent: type=${agentType}${sessionInfo}, prompt=${taskPrompt.substring(0, 80)}...`);

		try {
			// 传入稳定的 sessionId，确保后续能继续同一个子任务，而不是反复新建
			// 传入 toolUse.id 让 runSubAgent 可以更新该 task 工具的 UI 状态
			const result = await this.subAgentRunner(agentType, taskPrompt, sessionId, toolUse.toolUseId);
			console.log(`[Maxian] 子 Agent 完成: type=${agentType}`);

			// 在结果中包含 task_id，供主 Agent 后续继续同一个子任务
			return [
				`task_id: ${sessionId}`,
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

		// 检查是否已由 diff confirm 直接保存（跳过重复写入）
		const resolvedEditPath = this.fileOperations.resolveFilePath(editParams.path);
		const mutationGuard = await this.ensureExplicitReadBeforeMutation(resolvedEditPath, {
			allowCreate: !!editParams.create_if_missing,
		});
		if (mutationGuard) {
			return mutationGuard;
		}
		const baseline = await this.captureDiagnosticBaseline(resolvedEditPath);
		if (consumePathSavedByDiff(resolvedEditPath)) {
			let output = '✅ 文件已通过 diff 确认保存';
			try {
				const diagnostics = await getCurrentDiagnostics(resolvedEditPath);
				if (diagnostics) { output += diagnostics; }
			} catch { /* LSP 失败不影响主流程 */ }
			return output;
		}

		try {
			// B4: 编辑前检查是否基于局部视图
			const resolvedEditPath = this.fileOperations.resolveFilePath(editParams.path);
			const cachedStateForEdit = this.fileStateCache.get(resolvedEditPath);
			let partialViewWarning = '';
			if (cachedStateForEdit?.isPartialView) {
				const s = cachedStateForEdit.startLine ?? '?';
				const e = cachedStateForEdit.endLine ?? '?';
				partialViewWarning = `\n\n⚠️ [B4 局部视图] 上次读取该文件时仅查看了第 ${s}-${e} 行。本次编辑已基于完整文件内容执行，建议先完整读取文件（不带 start_line/end_line 参数）以确认修改上下文。`;
			}

			// 读取文件原始内容（不带行号和XML包装，避免字符串替换失败）
			const content = await this.fileOperations.readRawFileContent(editParams.path);

			// 执行编辑
			const result = executeEdit(content, editParams);

			if (!result.success) {
				return formatEditResponse(result) + partialViewWarning;
			}

			// 写入修改后的内容
			const writeResult = await this.fileOperations.writeToFile({
				type: 'tool_use',
				name: 'write_to_file',
				params: { path: editParams.path, content: result.newContent, write_visibility: 'derived' },
				partial: false,
			} as any);
			if (this.isFailureText(this.toTextResult(writeResult))) {
				return writeResult;
			}

			return this.appendDiagnosticDelta(
				resolvedEditPath,
				formatEditResponse(result) + partialViewWarning,
				baseline
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			return `编辑失败: ${errorMsg}`;
		}
	}

	private async preflightEditToolUse(toolUse: ToolUse): Promise<ToolExecutionResult | null> {
		const params = toolUse.params;
		const validation = validateEditParams({
			path: params.path,
			old_string: params.old_string,
			new_string: params.new_string,
			replace_all: params.replace_all === 'true',
			create_if_missing: params.create_if_missing === 'true',
		});

		if (!validation.valid) {
			return this.createExecutionResult(toolUse, false, 'error', `错误: ${validation.error}`, validation.error);
		}

		const editParams = validation.params!;
		const resolvedEditPath = this.fileOperations.resolveFilePath(editParams.path);
		const mutationGuard = await this.ensureExplicitReadBeforeMutation(resolvedEditPath, {
			allowCreate: !!editParams.create_if_missing,
		});
		if (mutationGuard) {
			return this.createExecutionResult(toolUse, false, 'error', mutationGuard, this.stripXmlTags(mutationGuard));
		}

		const content = await this.fileOperations.readRawFileContent(editParams.path);
		const result = executeEdit(content, editParams);
		if (result.success) {
			return null;
		}

		const message = `edit 预检查失败: ${result.message}。这表示当前 old_string 已不匹配目标文件内容，必须先重新读取目标文件全文或重新定位待修改代码块，不能继续批准这次修改。`;
		return this.createExecutionResult(toolUse, false, 'error', `<error>${message}</error>`, message);
	}

	private async preflightWriteToFileToolUse(toolUse: ToolUse): Promise<ToolExecutionResult | null> {
		const writePath = toolUse.params?.path as string || '';
		if (!writePath) {
			return this.createExecutionResult(toolUse, false, 'error', '错误: 未提供文件路径', '未提供文件路径');
		}

		const resolvedWritePath = this.fileOperations.resolveFilePath(writePath);
		const fileInfo = await this.fileOperations.getFileInfo(resolvedWritePath);
		if (fileInfo) {
			const mutationGuard = await this.ensureExplicitReadBeforeMutation(resolvedWritePath, { allowCreate: true });
			if (mutationGuard) {
				return this.createExecutionResult(toolUse, false, 'error', mutationGuard, this.stripXmlTags(mutationGuard));
			}

			const previousSuccessfulWrites = this.successfulWriteToFileCounts.get(resolvedWritePath) || 0;
			if (previousSuccessfulWrites >= 1) {
				const message = `write_to_file 预检查失败: 文件 ${resolvedWritePath} 在当前任务中已经通过 write_to_file 成功写入过一次。后续修改必须先重新 read_file 当前全文，再改用 edit 或 multiedit，不能继续整文件重写。`;
				return this.createExecutionResult(toolUse, false, 'error', `<error>${message}</error>`, message);
			}
		}

		const preflight = await this.fileOperations.preflightWriteToFile(toolUse as any);
		if (preflight.ok) {
			return null;
		}

		return this.createExecutionResult(toolUse, false, 'error', preflight.error, this.stripXmlTags(preflight.error));
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

		// 检查是否已由 diff confirm 直接保存（跳过重复写入）
		const resolvedMultieditPath = this.fileOperations.resolveFilePath(path);
		const mutationGuard = await this.ensureExplicitReadBeforeMutation(resolvedMultieditPath);
		if (mutationGuard) {
			return mutationGuard;
		}
		const baseline = await this.captureDiagnosticBaseline(resolvedMultieditPath);
		if (consumePathSavedByDiff(resolvedMultieditPath)) {
			let output = '✅ 文件已通过 diff 确认保存';
			try {
				const diagnostics = await getCurrentDiagnostics(resolvedMultieditPath);
				if (diagnostics) { output += diagnostics; }
			} catch { /* LSP 失败不影响主流程 */ }
			return output;
		}

		let editOperations: EditOperation[];
		try {
			const rawEdits = typeof edits === 'string' ? JSON.parse(edits) : edits;

			if (!Array.isArray(rawEdits)) {
				return '错误: edits 必须是数组';
			}

			// 兼容 schema 下划线命名（old_string/new_string）和驼峰命名（oldString/newString）
			editOperations = rawEdits.map((e: any) => ({
				oldString: e.oldString ?? e.old_string ?? '',
				newString: e.newString ?? e.new_string ?? '',
				replaceAll: e.replaceAll ?? e.replace_all ?? false,
			}));
		} catch (e) {
			return `错误: edits 参数解析失败: ${e}`;
		}

		if (editOperations.length === 0) {
			return '错误: edits 不能为空';
		}


		try {
			// B4: 编辑前检查是否基于局部视图
			const cachedStateForMultiedit = this.fileStateCache.get(resolvedMultieditPath);
			let partialViewWarningMulti = '';
			if (cachedStateForMultiedit?.isPartialView) {
				const s = cachedStateForMultiedit.startLine ?? '?';
				const e = cachedStateForMultiedit.endLine ?? '?';
				partialViewWarningMulti = `\n\n⚠️ [B4 局部视图] 上次读取该文件时仅查看了第 ${s}-${e} 行。本次编辑已基于完整文件内容执行，建议先完整读取文件（不带 start_line/end_line 参数）以确认修改上下文。`;
			}

			// 读取文件原始内容（不带行号和XML包装，避免字符串替换失败）
			const rawContent = await this.fileOperations.readRawFileContent(path);

			if (rawContent === null) {
				return `错误: 无法读取文件 ${path}`;
			}

			// 执行多处编辑
			const result = executeMultiedit(rawContent, editOperations);

			if (!result.success) {
				return formatMultieditResponse(result, path) + partialViewWarningMulti;
			}

			// 写入修改后的内容
			const writeResult = await this.fileOperations.writeToFile({
				type: 'tool_use',
				name: 'write_to_file',
				params: { path, content: result.finalContent, write_visibility: 'derived' },
				partial: false,
			} as any);
			if (this.isFailureText(this.toTextResult(writeResult))) {
				return writeResult;
			}

			return this.appendDiagnosticDelta(
				resolvedMultieditPath,
				formatMultieditResponse(result, path) + partialViewWarningMulti,
				baseline
			);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			return `多处编辑失败: ${errorMsg}`;
		}
	}

	private async preflightMultieditToolUse(toolUse: ToolUse): Promise<ToolExecutionResult | null> {
		const { path, edits } = toolUse.params;
		if (!path) {
			return this.createExecutionResult(toolUse, false, 'error', '错误: multiedit 工具需要 path 参数', 'multiedit 工具需要 path 参数');
		}
		if (!edits) {
			return this.createExecutionResult(toolUse, false, 'error', '错误: multiedit 工具需要 edits 参数', 'multiedit 工具需要 edits 参数');
		}

		const resolvedMultieditPath = this.fileOperations.resolveFilePath(path);
		const mutationGuard = await this.ensureExplicitReadBeforeMutation(resolvedMultieditPath);
		if (mutationGuard) {
			return this.createExecutionResult(toolUse, false, 'error', mutationGuard, this.stripXmlTags(mutationGuard));
		}

		let editOperations: EditOperation[];
		try {
			const rawEdits = typeof edits === 'string' ? JSON.parse(edits) : edits;
			if (!Array.isArray(rawEdits)) {
				return this.createExecutionResult(toolUse, false, 'error', '错误: edits 必须是数组', 'edits 必须是数组');
			}

			editOperations = rawEdits.map((e: any) => ({
				oldString: e.oldString ?? e.old_string ?? '',
				newString: e.newString ?? e.new_string ?? '',
				replaceAll: e.replaceAll ?? e.replace_all ?? false,
			}));
		} catch (error) {
			const message = `edits 参数解析失败: ${error}`;
			return this.createExecutionResult(toolUse, false, 'error', `错误: ${message}`, message);
		}

		if (editOperations.length === 0) {
			return this.createExecutionResult(toolUse, false, 'error', '错误: edits 不能为空', 'edits 不能为空');
		}

		const rawContent = await this.fileOperations.readRawFileContent(path);
		if (rawContent === null) {
			return this.createExecutionResult(toolUse, false, 'error', `错误: 无法读取文件 ${path}`, `无法读取文件 ${path}`);
		}

		const result = executeMultiedit(rawContent, editOperations);
		if (result.success) {
			return null;
		}

		const message = `multiedit 预检查失败: ${result.error}。这表示当前编辑计划已不能安全应用，必须先重新读取目标文件全文或拆分后重新定位修改点，不能继续批准这次修改。`;
		return this.createExecutionResult(toolUse, false, 'error', `<error>${message}</error>`, message);
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
				const resolvedPatchPath = this.fileOperations.resolveFilePath(patch.path);
				const mutationGuard = await this.ensureExplicitReadBeforeMutation(resolvedPatchPath);
				if (mutationGuard) {
					results.push(`❌ ${patch.path}: ${this.stripXmlTags(mutationGuard)}`);
					failCount++;
					continue;
				}
				const baseline = await this.captureDiagnosticBaseline(resolvedPatchPath);
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
					const writeResult = await this.fileOperations.writeToFile({
						type: 'tool_use',
						name: 'write_to_file',
						params: { path: patch.path, content, write_visibility: 'derived' },
						partial: false,
					} as any);
					if (this.isFailureText(this.toTextResult(writeResult))) {
						results.push(`❌ ${patch.path}: ${this.stripXmlTags(this.toTextResult(writeResult))}`);
						failCount++;
						continue;
					}
					const successMessage = await this.appendDiagnosticDelta(
						resolvedPatchPath,
						`✅ ${patch.path}: ${patch.operations.length} 处修改`,
						baseline
					);
					results.push(typeof successMessage === 'string' ? successMessage : this.toTextResult(successMessage));
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
	 * LSP功能：统一查询入口（对齐 Claude Code / OpenCode 单工具风格）
	 */
	private async executeLsp(toolUse: ToolUse): Promise<ToolResponse> {
		const operationRaw = (toolUse.params.operation || '').toString().trim().toLowerCase();
		const operation = operationRaw || 'hover';

		switch (operation) {
			case 'hover':
				return this.executeLspHover(toolUse);
			case 'diagnostics':
				return this.executeLspDiagnostics(toolUse);
			case 'definition':
				return this.executeLspDefinition(toolUse);
			case 'references':
				return this.executeLspReferences(toolUse);
			case 'type_definition':
			case 'type-definition':
			case 'typedefinition':
				return this.executeLspTypeDefinition(toolUse);
			default:
				return `<error>lsp 工具的 operation 无效: "${operationRaw || '(empty)'}"。可选值: hover | diagnostics | definition | references | type_definition</error>`;
		}
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
		const diagnosticsResult = await getCurrentDiagnostics(absolutePath);

		if (!diagnosticsResult) {
			return `<success>
文件: ${absolutePath}

✅ 此文件没有诊断信息（无错误、无警告）
</success>`;
		}

		return diagnosticsResult;
	}

	private async captureDiagnosticBaseline(filePath: string): Promise<Diagnostic[]> {
		try {
			return await captureDiagnosticsBaseline(filePath);
		} catch {
			return [];
		}
	}

	private async appendDiagnosticDelta(filePath: string, baseResult: ToolResponse, baseline: Diagnostic[]): Promise<ToolResponse> {
		const baseText = this.toTextResult(baseResult);
		if (this.isFailureText(baseText)) {
			return baseResult;
		}

		try {
			const diagnostics = await getDiagnosticsAfterEdit(filePath, baseline);
			if (!diagnostics) {
				return baseResult;
			}
			return `${baseText}${diagnostics}`;
		} catch {
			return baseResult;
		}
	}

	private async ensureExplicitReadBeforeMutation(
		filePath: string,
		options: { allowCreate?: boolean } = {}
	): Promise<string | null> {
		if (!filePath) {
			return '错误: 未提供文件路径';
		}

		const fileInfo = await this.fileOperations.getFileInfo(filePath);
		if (!fileInfo) {
			return options.allowCreate
				? null
				: `错误: 文件不存在\n路径: ${filePath}\n\n请先确认正确路径，若要创建新文件请显式使用新文件创建流程。`;
		}

		if (fileInfo.isDirectory) {
			return `错误: 目标路径是目录而不是文件\n路径: ${filePath}`;
		}

		const readiness = this.fileStateCache.getMutationReadiness(filePath, fileInfo.mtime, fileInfo.size);
		switch (readiness.reason) {
			case 'ok':
				return null;
			case 'not_read':
				return `<error>
File has not been read yet. Read it first before writing to it.
路径: ${filePath}
</error>`;
			case 'partial_view':
				return `<error>
File has only been partially read. Read the full file before attempting to write it.
路径: ${filePath}
</error>`;
			case 'modified_since_read':
				return `<error>
File has been modified since read, either by the user or by a previous tool write. Read it again before attempting to write it.
路径: ${filePath}
</error>`;
			default:
				return `<error>
File is not ready for mutation. Read it again before attempting to write it.
路径: ${filePath}
</error>`;
		}
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
