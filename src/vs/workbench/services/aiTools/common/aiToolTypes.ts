/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * AI Tool System Types - Based on Kilocode
 */

// Tool parameter names (from Kilocode tools.ts)
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

export type ToolParamName = typeof toolParamNames[number];

// Tool names (core tools from Kilocode)
export type ToolName =
	| 'read_file'
	| 'write_to_file'
	| 'edit_file'
	| 'apply_diff'
	| 'list_files'
	| 'search_files'
	| 'list_code_definition_names'
	| 'execute_command'
	| 'attempt_completion'
	| 'ask_followup_question'
	| 'update_todo_list'
	| 'switch_mode'
	| 'browser_action'
	| 'codebase_search';

// Tool use structure
export interface ToolUse {
	type: 'tool_use';
	name: ToolName;
	params: Partial<Record<ToolParamName, string>>;
	partial: boolean;
	toolUseId?: string;
}

// Specific tool use types
export interface ReadFileToolUse extends ToolUse {
	name: 'read_file';
	params: Partial<Pick<Record<ToolParamName, string>, 'path' | 'start_line' | 'end_line'>>;
}

export interface WriteFileToolUse extends ToolUse {
	name: 'write_to_file';
	params: Partial<Pick<Record<ToolParamName, string>, 'path' | 'content'>>;
}

export interface EditFileToolUse extends ToolUse {
	name: 'edit_file';
	params: Partial<Pick<Record<ToolParamName, string>, 'path' | 'diff' | 'search' | 'replace'>>;
}

export interface ExecuteCommandToolUse extends ToolUse {
	name: 'execute_command';
	params: Partial<Pick<Record<ToolParamName, string>, 'command' | 'cwd'>>;
}

export interface ListFilesToolUse extends ToolUse {
	name: 'list_files';
	params: Partial<Pick<Record<ToolParamName, string>, 'path' | 'recursive'>>;
}

export interface SearchFilesToolUse extends ToolUse {
	name: 'search_files';
	params: Partial<Pick<Record<ToolParamName, string>, 'path' | 'regex' | 'file_pattern'>>;
}

// Tool response type
export type ToolResponse = string;

// Tool execution context
export interface ToolExecutionContext {
	cwd: string;
	askApproval: (type: string, message?: string) => Promise<boolean>;
	updateProgress: (message: string) => void;
}

// Tool definition (for Function Calling)
export interface ToolDefinition {
	type: 'function';
	function: {
		name: string;
		description: string;
		parameters: {
			type: 'object';
			properties: Record<string, any>;
			required?: string[];
		};
	};
}

// Tool result
export interface ToolResult {
	tool_call_id: string;
	role: 'tool';
	name: string;
	content: string;
}
