/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tool Use Validation - Validates tool usage based on mode and requirements
 */

export type ToolName =
	| 'read_file'
	| 'write_to_file'
	| 'edit_file'
	| 'list_files'
	| 'search_files'
	| 'execute_command'
	| 'apply_diff'
	| 'update_todo_list'
	| 'switch_mode'
	| 'new_task'
	| 'codebase_search'
	| 'list_code_definition_names'
	| 'browser_action'
	| 'use_mcp_tool'
	| 'access_mcp_resource'
	| 'condense'
	| 'fetch_instructions'
	| 'generate_image'
	| 'report_bug'
	| 'run_slash_command'
	| 'simple_read_file'
	| 'new_rule';

export type Mode = 'code' | 'architect' | 'ask' | string;

export interface ModeConfig {
	slug: string;
	name: string;
	allowedTools?: ToolName[];
	deniedTools?: ToolName[];
}

/**
 * Check if a tool is allowed for the current mode
 */
export function isToolAllowedForMode(
	toolName: ToolName,
	mode: Mode,
	customModes: ModeConfig[] = [],
	toolRequirements?: Record<string, boolean>,
	toolParams?: Record<string, unknown>
): boolean {
	// Find custom mode configuration
	const customMode = customModes.find(m => m.slug === mode);

	if (customMode) {
		// If deniedTools is defined, check if tool is denied
		if (customMode.deniedTools && customMode.deniedTools.includes(toolName)) {
			return false;
		}

		// If allowedTools is defined, check if tool is allowed
		if (customMode.allowedTools) {
			return customMode.allowedTools.includes(toolName);
		}
	}

	// Default built-in mode rules
	const modeRules: Record<Mode, ToolName[]> = {
		code: [
			'read_file',
			'write_to_file',
			'edit_file',
			'list_files',
			'search_files',
			'execute_command',
			'apply_diff',
			'update_todo_list',
			'codebase_search',
			'list_code_definition_names',
			'simple_read_file',
			'new_rule',
		],
		architect: [
			'read_file',
			'list_files',
			'search_files',
			'codebase_search',
			'list_code_definition_names',
			'simple_read_file',
		],
		ask: [
			'read_file',
			'list_files',
			'search_files',
			'simple_read_file',
		],
	};

	const allowedTools = modeRules[mode];
	if (allowedTools) {
		return allowedTools.includes(toolName);
	}

	// Allow all tools for unknown modes
	return true;
}

/**
 * Validate tool use
 */
export function validateToolUse(
	toolName: ToolName,
	mode: Mode,
	customModes?: ModeConfig[],
	toolRequirements?: Record<string, boolean>,
	toolParams?: Record<string, unknown>
): void {
	if (!isToolAllowedForMode(toolName, mode, customModes, toolRequirements, toolParams)) {
		throw new Error(`Tool "${toolName}" is not allowed in ${mode} mode.`);
	}
}
