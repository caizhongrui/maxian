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
] as const;

export type ToolParamName = (typeof toolParamNames)[number];

// 所有工具名称列表（用于AssistantMessageParser）
export const toolNames = [
	'execute_command',
	'read_file',
	'write_to_file',
	'search_files',
	'list_files',
	'list_code_definition_names',
	'codebase_search',
	'insert_content',
	'apply_diff',
	'edit_file',
	'glob',
	'ask_followup_question',
	'attempt_completion',
	'new_task',
	'update_todo_list',
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
	params: Partial<Pick<Record<ToolParamName, string>, 'command' | 'cwd'>>;
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
	params: Partial<Pick<Record<ToolParamName, string>, 'question' | 'follow_up'>>;
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

// 工具显示名称
export const TOOL_DISPLAY_NAMES: Record<ToolName, string> = {
	execute_command: '执行命令',
	read_file: '读取文件',
	write_to_file: '写入文件',
	search_files: '搜索文件',
	list_files: '列出文件',
	list_code_definition_names: '列出代码定义',
	codebase_search: '代码库搜索',
	insert_content: '插入内容',
	apply_diff: '应用差异',
	edit_file: '编辑文件',
	glob: 'Glob模式匹配',
	ask_followup_question: '提问',
	attempt_completion: '完成任务',
	new_task: '创建新任务',
	update_todo_list: '更新待办列表',
} as const;

// 工具分组
export type ToolGroup = 'read' | 'edit' | 'command';

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
			'write_to_file',
			'insert_content',
		],
	},
	command: {
		tools: ['execute_command'],
	},
};

// 始终可用的工具
export const ALWAYS_AVAILABLE_TOOLS: ToolName[] = [
	'ask_followup_question',
	'attempt_completion',
	'new_task',
	'update_todo_list',
] as const;
