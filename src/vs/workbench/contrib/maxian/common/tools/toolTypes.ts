/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 工具类型定义
 * 参考Kilocode的工具系统设计，用VSCode内部API重新实现
 */

export type ToolResponse = string | Array<{ type: 'text'; text: string } | { type: 'image'; source: string }>;

export type ToolProgressStatus = 'loading' | 'pending' | 'success' | 'error' | 'info';

// 所有工具参数名称
export const toolParamNames = [
	'command',
	'path',
	'content',
	'line_count',
	'regex',
	'file_pattern',
	'recursive',
	'action',
	'url',
	'coordinate',
	'text',
	'server_name',
	'tool_name',
	'arguments',
	'uri',
	'question',
	'result',
	'diff',
	'mode_slug',
	'reason',
	'line',
	'mode',
	'message',
	'cwd',
	'follow_up',
	'task',
	'size',
	'search',
	'replace',
	'use_regex',
	'ignore_case',
	'title',
	'description',
	'target_file',
	'instructions',
	'code_edit',
	'files',
	'query',
	'args',
	'start_line',
	'end_line',
	'todos',
	'prompt',
	'image',
	// P0/P1 优化新增参数
	'tool_calls',     // batch 工具参数
	'edits',          // multiedit 工具参数
	'old_string',     // edit 容错匹配参数
	'new_string',     // edit 容错匹配参数
	'replace_all',    // edit 全局替换参数
	'create_if_missing', // edit 创建文件参数
	'patches',        // patch 多文件补丁参数
	'subagent_type',  // task 子Agent类型参数
	'task_id',        // task resume 参数（恢复已有子Agent会话）
	'column',         // LSP 列号参数
	'useCache',       // webfetch 缓存参数
	'format',         // webfetch 输出格式参数
	'skill_name',     // skill 工具参数
	'requires_approval', // execute_command: 是否需要用户确认（参考Cline）
	'options',        // ask_followup_question: 备选答案数组（参考Cline）
] as const;

export type ToolParamName = (typeof toolParamNames)[number];

// 所有工具名称列表（用于AssistantMessageParser）
export const toolNames = [
	'execute_command',
	'read_file',
	'write_to_file',
	'delete_file',
	'search_files',
	'list_files',
	'list_code_definition_names',
	'codebase_search',
	'insert_content',
	'apply_diff',
	'edit_file',
	'edit',         // 独立edit工具：基于old_string/new_string的容错替换
	'glob',
	'ask_followup_question',
	'attempt_completion',
	'new_task',
	'update_todo_list',
	'batch',        // P0优化：批量并行执行工具
	'multiedit',    // P1优化：单文件多处编辑
	'webfetch',     // P0优化：网页获取工具
	'task',         // P1优化：子Agent委托
	'patch',        // P1优化：多文件批量操作
	'lsp_hover',    // LSP功能：悬停信息
	'lsp_diagnostics', // LSP功能：诊断信息
	'lsp_definition', // LSP功能：定义位置
	'lsp_references', // LSP功能：引用查找
	'lsp_type_definition', // LSP功能：类型定义
	'skill',        // Skills系统：按需加载专业知识
	'todowrite',    // P2优化：写入待办列表（同 update_todo_list 但更丰富）
	'todoread',     // P2优化：读取当前待办列表
] as const;

// 工具名称
export type ToolName = (typeof toolNames)[number];

// 文本内容块
export interface TextContent {
	type: 'text';
	content: string;
	partial: boolean;
}

// 工具使用接口
export interface ToolUse {
	type: 'tool_use';
	name: ToolName;
	params: Partial<Record<ToolParamName, string>>;
	partial: boolean;
	toolUseId?: string;
}

// 具体工具类型定义
export interface ExecuteCommandToolUse extends ToolUse {
	name: 'execute_command';
	params: Partial<Pick<Record<ToolParamName, string>, 'command' | 'cwd' | 'requires_approval'>>;
}

export interface ReadFileToolUse extends ToolUse {
	name: 'read_file';
	params: Partial<Pick<Record<ToolParamName, string>, 'args' | 'path' | 'start_line' | 'end_line'>>;
}

export interface WriteToFileToolUse extends ToolUse {
	name: 'write_to_file';
	params: Partial<Pick<Record<ToolParamName, string>, 'path' | 'content' | 'line_count'>>;
}

export interface InsertCodeBlockToolUse extends ToolUse {
	name: 'insert_content';
	params: Partial<Pick<Record<ToolParamName, string>, 'path' | 'line' | 'content'>>;
}

export interface CodebaseSearchToolUse extends ToolUse {
	name: 'codebase_search';
	params: Partial<Pick<Record<ToolParamName, string>, 'query' | 'path' | 'file_pattern'>>;
}

export interface SearchFilesToolUse extends ToolUse {
	name: 'search_files';
	params: Partial<Pick<Record<ToolParamName, string>, 'path' | 'regex' | 'file_pattern'>>;
}

export interface ListFilesToolUse extends ToolUse {
	name: 'list_files';
	params: Partial<Pick<Record<ToolParamName, string>, 'path' | 'recursive'>>;
}

export interface ListCodeDefinitionNamesToolUse extends ToolUse {
	name: 'list_code_definition_names';
	params: Partial<Pick<Record<ToolParamName, string>, 'path'>>;
}

export interface AskFollowupQuestionToolUse extends ToolUse {
	name: 'ask_followup_question';
	params: Partial<Pick<Record<ToolParamName, string>, 'question' | 'follow_up' | 'options'>>;
}

export interface AttemptCompletionToolUse extends ToolUse {
	name: 'attempt_completion';
	params: Partial<Pick<Record<ToolParamName, string>, 'result'>>;
}

export interface NewTaskToolUse extends ToolUse {
	name: 'new_task';
	params: Partial<Pick<Record<ToolParamName, string>, 'mode' | 'message' | 'todos'>>;
}

export interface ApplyDiffToolUse extends ToolUse {
	name: 'apply_diff';
	params: Partial<Pick<Record<ToolParamName, string>, 'path' | 'diff' | 'start_line'>>;
}

export interface EditFileToolUse extends ToolUse {
	name: 'edit_file';
	params: Required<Pick<Record<ToolParamName, string>, 'target_file' | 'instructions' | 'code_edit'>>;
}

export interface GlobToolUse extends ToolUse {
	name: 'glob';
	params: Partial<Pick<Record<ToolParamName, string>, 'path' | 'file_pattern'>>;
}

export interface LspHoverToolUse extends ToolUse {
	name: 'lsp_hover';
	params: Partial<Pick<Record<ToolParamName, string>, 'path' | 'line' | 'column'>>;
}

export interface LspDiagnosticsToolUse extends ToolUse {
	name: 'lsp_diagnostics';
	params: Partial<Pick<Record<ToolParamName, string>, 'path'>>;
}

export interface LspDefinitionToolUse extends ToolUse {
	name: 'lsp_definition';
	params: Partial<Pick<Record<ToolParamName, string>, 'path' | 'line' | 'column'>>;
}

export interface LspReferencesToolUse extends ToolUse {
	name: 'lsp_references';
	params: Partial<Pick<Record<ToolParamName, string>, 'path' | 'line' | 'column'>>;
}

export interface LspTypeDefinitionToolUse extends ToolUse {
	name: 'lsp_type_definition';
	params: Partial<Pick<Record<ToolParamName, string>, 'path' | 'line' | 'column'>>;
}

// 工具显示名称
export const TOOL_DISPLAY_NAMES: Record<ToolName, string> = {
	execute_command: '执行命令',
	read_file: '读取文件',
	write_to_file: '写入文件',
	delete_file: '删除文件',
	search_files: '搜索文件',
	list_files: '列出文件',
	list_code_definition_names: '列出代码定义',
	codebase_search: '代码库搜索',
	insert_content: '插入内容',
	apply_diff: '应用差异',
	edit_file: '编辑文件',
	edit: '编辑(容错)',          // 独立edit工具
	glob: 'Glob模式匹配',
	ask_followup_question: '提问',
	attempt_completion: '完成任务',
	new_task: '创建新任务',
	update_todo_list: '更新待办列表',
	batch: '批量执行',           // P0优化
	multiedit: '多处编辑',        // P1优化
	webfetch: '获取网页',         // P0优化
	task: '子任务委托',           // P1优化
	patch: '多文件补丁',          // P1优化
	lsp_hover: 'LSP悬停',        // LSP功能
	lsp_diagnostics: 'LSP诊断',  // LSP功能
	lsp_definition: 'LSP定义',   // LSP功能
	lsp_references: 'LSP引用',   // LSP功能
	lsp_type_definition: 'LSP类型定义', // LSP功能
	skill: '加载专业知识',        // Skills系统
	todowrite: '写入待办列表',    // P2优化
	todoread: '读取待办列表',     // P2优化
} as const;

// 工具分组
export type ToolGroup = 'read' | 'edit' | 'command' | 'web' | 'lsp' | 'agent' | 'skills';

export type ToolGroupConfig = {
	tools: readonly string[];
	alwaysAvailable?: boolean;
};

export const TOOL_GROUPS: Record<ToolGroup, ToolGroupConfig> = {
	read: {
		tools: [
			'read_file',
			'search_files',
			'list_files',
			'list_code_definition_names',
			'codebase_search',
			'glob',
		],
	},
	edit: {
		tools: [
			'apply_diff',
			'edit_file',
			'edit',           // 独立edit工具
			'write_to_file',
			'delete_file',    // 删除文件
			'insert_content',
			'multiedit',      // 多处编辑
			'patch',          // 多文件补丁
		],
	},
	command: {
		tools: ['execute_command'],
	},
	web: {
		tools: ['webfetch'],  // 网页获取
	},
	lsp: {
		tools: [
			'lsp_hover',
			'lsp_diagnostics',
			'lsp_definition',
			'lsp_references',
			'lsp_type_definition',
		],
	},
	agent: {
		tools: [
			'task',           // 子Agent委托
			'batch',          // 批量执行
		],
	},
	skills: {
		tools: [
			'skill',          // 按需加载Skills
		],
		alwaysAvailable: true,  // Skills始终可用
	},
};

// 始终可用的工具
export const ALWAYS_AVAILABLE_TOOLS: ToolName[] = [
	'ask_followup_question',
	'attempt_completion',
	'new_task',
	'update_todo_list',
	'todowrite',       // 待办写入始终可用
	'todoread',        // 待办读取始终可用
	'skill',           // Skills始终可用
] as const;
