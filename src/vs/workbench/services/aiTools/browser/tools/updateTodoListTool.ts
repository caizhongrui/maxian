/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';

export interface TodoItem {
	id: string;
	content: string;
	status: TodoStatus;
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export const todoStatusSchema = {
	options: ['pending', 'in_progress', 'completed'] as const
};

let approvedTodoList: TodoItem[] | undefined = undefined;

/**
 * Add a todo item to the task's todoList.
 */
export function addTodoToTask(todoList: TodoItem[] | undefined, content: string, status: TodoStatus = 'pending', id?: string): { todoList: TodoItem[]; newItem: TodoItem } {
	const todo: TodoItem = {
		id: id ?? crypto.randomUUID(),
		content,
		status,
	};
	const list = todoList ?? [];
	list.push(todo);
	return { todoList: list, newItem: todo };
}

/**
 * Update the status of a todo item by id.
 */
export function updateTodoStatus(todoList: TodoItem[] | undefined, id: string, nextStatus: TodoStatus): { success: boolean; todoList?: TodoItem[] } {
	if (!todoList) {
		return { success: false };
	}
	const idx = todoList.findIndex((t) => t.id === id);
	if (idx === -1) {
		return { success: false };
	}
	const current = todoList[idx];
	if (
		(current.status === 'pending' && nextStatus === 'in_progress') ||
		(current.status === 'in_progress' && nextStatus === 'completed') ||
		current.status === nextStatus
	) {
		const newList = [...todoList];
		newList[idx] = { ...current, status: nextStatus };
		return { success: true, todoList: newList };
	}
	return { success: false };
}

/**
 * Remove a todo item by id.
 */
export function removeTodo(todoList: TodoItem[] | undefined, id: string): { success: boolean; todoList?: TodoItem[] } {
	if (!todoList) {
		return { success: false };
	}
	const idx = todoList.findIndex((t) => t.id === id);
	if (idx === -1) {
		return { success: false };
	}
	const newList = [...todoList];
	newList.splice(idx, 1);
	return { success: true, todoList: newList };
}

/**
 * Get a copy of the todoList.
 */
export function getTodoList(todoList: TodoItem[] | undefined): TodoItem[] | undefined {
	return todoList?.slice();
}

/**
 * Convert TodoItem[] to markdown checklist string.
 */
export function todoListToMarkdown(todos: TodoItem[]): string {
	return todos
		.map((t) => {
			let box = '[ ]';
			if (t.status === 'completed') {
				box = '[x]';
			} else if (t.status === 'in_progress') {
				box = '[-]';
			}
			return `${box} ${t.content}`;
		})
		.join('\n');
}

// function normalizeStatus(status: string | undefined): TodoStatus {
// 	if (status === 'completed') {
// 		return 'completed';
// 	}
// 	if (status === 'in_progress') {
// 		return 'in_progress';
// 	}
// 	return 'pending';
// }

export function parseMarkdownChecklist(md: string): TodoItem[] {
	if (typeof md !== 'string') {
		return [];
	}
	const lines = md
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	const todos: TodoItem[] = [];
	for (const line of lines) {
		const match = line.match(/^(?:-\s*)?\[\s*([ xX\-~])\s*\]\s+(.+)$/);
		if (!match) {
			continue;
		}
		let status: TodoStatus = 'pending';
		if (match[1] === 'x' || match[1] === 'X') {
			status = 'completed';
		} else if (match[1] === '-' || match[1] === '~') {
			status = 'in_progress';
		}
		const id = crypto
			.createHash('md5')
			.update(match[2] + status)
			.digest('hex');
		todos.push({
			id,
			content: match[2],
			status,
		});
	}
	return todos;
}

export function setPendingTodoList(todos: TodoItem[]): void {
	approvedTodoList = todos;
}

export function getPendingTodoList(): TodoItem[] | undefined {
	return approvedTodoList;
}

export function clearPendingTodoList(): void {
	approvedTodoList = undefined;
}

export function validateTodos(todos: any[]): { valid: boolean; error?: string } {
	if (!Array.isArray(todos)) {
		return { valid: false, error: 'todos must be an array' };
	}
	for (const [i, t] of todos.entries()) {
		if (!t || typeof t !== 'object') {
			return { valid: false, error: `Item ${i + 1} is not an object` };
		}
		if (!t.id || typeof t.id !== 'string') {
			return { valid: false, error: `Item ${i + 1} is missing id` };
		}
		if (!t.content || typeof t.content !== 'string') {
			return { valid: false, error: `Item ${i + 1} is missing content` };
		}
		if (t.status && !todoStatusSchema.options.includes(t.status as TodoStatus)) {
			return { valid: false, error: `Item ${i + 1} has invalid status` };
		}
	}
	return { valid: true };
}
