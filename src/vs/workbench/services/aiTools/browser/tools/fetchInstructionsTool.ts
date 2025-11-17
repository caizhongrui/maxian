/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Fetch Instructions Tool - Fetches predefined instructions and guidelines
 */

export interface FetchInstructionsParams {
	task: string;
}

export interface InstructionsContext {
	diffStrategy?: string;
	mcpHub?: any;
	context?: any;
}

export const INSTRUCTION_CATEGORIES = {
	DIFF: 'diff',
	SEARCH_REPLACE: 'search-replace',
	TOOLS: 'tools',
	MODES: 'modes',
	BEST_PRACTICES: 'best-practices',
} as const;

/**
 * Validate fetch instructions parameters
 */
export function validateFetchInstructionsParams(
	params: FetchInstructionsParams
): { valid: boolean; error?: string } {
	if (!params.task) {
		return { valid: false, error: 'Missing required parameter: task' };
	}

	return { valid: true };
}

/**
 * Get instruction category from task string
 */
export function getInstructionCategory(task: string): string | undefined {
	const taskLower = task.toLowerCase();

	if (taskLower.includes('diff') || taskLower.includes('patch')) {
		return INSTRUCTION_CATEGORIES.DIFF;
	}

	if (taskLower.includes('search') || taskLower.includes('replace')) {
		return INSTRUCTION_CATEGORIES.SEARCH_REPLACE;
	}

	if (taskLower.includes('tool') || taskLower.includes('command')) {
		return INSTRUCTION_CATEGORIES.TOOLS;
	}

	if (taskLower.includes('mode')) {
		return INSTRUCTION_CATEGORIES.MODES;
	}

	return INSTRUCTION_CATEGORIES.BEST_PRACTICES;
}

/**
 * Fetch instructions based on task
 */
export function fetchInstructionsForTask(task: string, context?: InstructionsContext): string {
	const category = getInstructionCategory(task);

	switch (category) {
		case INSTRUCTION_CATEGORIES.DIFF:
			return getDiffInstructions(context?.diffStrategy);

		case INSTRUCTION_CATEGORIES.SEARCH_REPLACE:
			return getSearchReplaceInstructions();

		case INSTRUCTION_CATEGORIES.TOOLS:
			return getToolsInstructions();

		case INSTRUCTION_CATEGORIES.MODES:
			return getModesInstructions();

		case INSTRUCTION_CATEGORIES.BEST_PRACTICES:
		default:
			return getBestPracticesInstructions();
	}
}

function getDiffInstructions(strategy?: string): string {
	return `# Diff Instructions

When using apply_diff to modify files:

1. Always read the file first to understand its current content
2. Use precise SEARCH/REPLACE blocks that exactly match the file content
3. Include enough context to make the match unique
4. Pay attention to indentation and whitespace
5. Consider using start_line parameter for clarity

Current diff strategy: ${strategy || 'default'}
`;
}

function getSearchReplaceInstructions(): string {
	return `# Search/Replace Instructions

When performing search and replace operations:

1. Use read_file to verify the current content
2. Ensure search patterns are exact and unique
3. Consider using regex for complex patterns
4. Test changes incrementally
5. Use multiple smaller replacements instead of one large one
`;
}

function getToolsInstructions(): string {
	return `# Tool Usage Instructions

Available tools and their best practices:

1. read_file - Read file contents
2. write_to_file - Create or overwrite files
3. edit_file - Modify existing files
4. apply_diff - Apply precise changes
5. list_files - List directory contents
6. search_files - Search for patterns in files
7. execute_command - Run shell commands

Always use the most appropriate tool for the task.
`;
}

function getModesInstructions(): string {
	return `# Mode Instructions

Available modes:

1. code - Full coding capabilities
2. architect - Design and architecture (read-only)
3. ask - Question answering (limited tools)

Switch modes using switch_mode tool when appropriate.
`;
}

function getBestPracticesInstructions(): string {
	return `# Best Practices

General guidelines for effective tool usage:

1. Always read files before modifying them
2. Use precise, incremental changes
3. Verify changes after applying them
4. Use todo lists to track progress
5. Switch modes when appropriate
6. Handle errors gracefully
7. Provide clear feedback to users
`;
}
