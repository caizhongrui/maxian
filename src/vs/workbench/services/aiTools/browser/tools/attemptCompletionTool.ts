/*---------------------------------------------------------------------------------------------
 *  Adapted from kilocode attemptCompletionTool.ts
 *  Task class dependency removed - now a standalone function
 *--------------------------------------------------------------------------------------------*/

export interface AttemptCompletionToolParams {
	result: string;
	command?: string;
}

export interface AttemptCompletionToolResult {
	success: boolean;
	result: string;
	command?: string;
	hasIncompleteTodos?: boolean;
}

export interface TodoItem {
	status: string;
	content: string;
}

/**
 * Attempt to complete the current task
 * This is a simplified version that returns completion status
 * The actual UI interaction should be handled by the caller
 */
export async function attemptCompletionTool(
	params: AttemptCompletionToolParams,
	options?: {
		preventCompletionWithOpenTodos?: boolean;
		todoList?: TodoItem[];
	}
): Promise<AttemptCompletionToolResult> {
	try {
		if (!params.result) {
			return {
				success: false,
				result: '',
				hasIncompleteTodos: false
			};
		}

		// Check if there are incomplete todos (only if the setting is enabled)
		const preventCompletionWithOpenTodos = options?.preventCompletionWithOpenTodos ?? false;
		const todoList = options?.todoList ?? [];
		const hasIncompleteTodos = todoList.some((todo) => todo.status !== 'completed');

		if (preventCompletionWithOpenTodos && hasIncompleteTodos) {
			return {
				success: false,
				result: '',
				hasIncompleteTodos: true
			};
		}

		// Return the completion result
		return {
			success: true,
			result: params.result,
			command: params.command,
			hasIncompleteTodos: false
		};
	} catch (error) {
		return {
			success: false,
			result: '',
			hasIncompleteTodos: false
		};
	}
}
