/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TodoItem } from './updateTodoListTool.js';
import { parseMarkdownChecklist } from './updateTodoListTool.js';

export interface NewTaskParams {
	mode: string;
	message: string;
	todos?: string;
}

export interface NewTaskResult {
	success: boolean;
	taskMessage?: string;
	todoItems?: TodoItem[];
	error?: string;
}

export function validateNewTaskParams(
	params: NewTaskParams,
	requireTodos: boolean = false
): NewTaskResult {
	if (!params.mode) {
		return {
			success: false,
			error: 'Missing required parameter: mode',
		};
	}

	if (!params.message) {
		return {
			success: false,
			error: 'Missing required parameter: message',
		};
	}

	if (requireTodos && params.todos === undefined) {
		return {
			success: false,
			error: 'Missing required parameter: todos',
		};
	}

	let todoItems: TodoItem[] = [];
	if (params.todos) {
		try {
			todoItems = parseMarkdownChecklist(params.todos);
		} catch (error) {
			return {
				success: false,
				error: 'Invalid todos format: must be a markdown checklist',
			};
		}
	}

	const unescapedMessage = params.message.replace(/\\\\@/g, '\\@');

	return {
		success: true,
		taskMessage: unescapedMessage,
		todoItems,
	};
}
