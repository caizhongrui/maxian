/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Complete implementation from Kilocode
import * as path from 'path';
import * as fs from 'fs';

import type { Task } from '../task/Task.js';
import type { ToolResponse } from './toolTypes.js';

export async function readFileTool(
	task: Task,
	params: any,
): Promise<ToolResponse> {
	const filePath = params.path || params.args || '';
	const startLine = params.start_line ? parseInt(params.start_line, 10) : undefined;
	const endLine = params.end_line ? parseInt(params.end_line, 10) : undefined;

	if (!filePath) {
		return 'Error: No file path provided';
	}

	try {
		// Resolve absolute path
		const absolutePath = path.isAbsolute(filePath)
			? filePath
			: path.resolve(task.workspacePath, filePath);

		// Check if file exists
		const exists = fs.existsSync(absolutePath);
		if (!exists) {
			return `Error: File not found: ${filePath}`;
		}

		// Read file content
		const content = fs.readFileSync(absolutePath, 'utf-8');
		const lines = content.split('\n');

		// Apply line range if specified
		let resultContent: string;
		if (startLine !== undefined && endLine !== undefined) {
			// Extract specific line range (1-indexed)
			const start = Math.max(0, startLine - 1);
			const end = Math.min(lines.length, endLine);
			resultContent = lines.slice(start, end).join('\n');
		} else if (startLine !== undefined) {
			// From startLine to end
			const start = Math.max(0, startLine - 1);
			resultContent = lines.slice(start).join('\n');
		} else {
			resultContent = content;
		}

		// Add line numbers for better context
		const resultLines = resultContent.split('\n');
		const numberedLines = resultLines.map((line, idx) => {
			const lineNum = (startLine || 1) + idx;
			return `${lineNum.toString().padStart(4, ' ')} | ${line}`;
		});

		const result = [
			`File: ${filePath}`,
			`Lines: ${lines.length}`,
			startLine || endLine ? `Range: ${startLine || 1}-${endLine || lines.length}` : '',
			'',
			'Content:',
			'```',
			numberedLines.join('\n'),
			'```',
		].filter(Boolean).join('\n');

		// Track file access for context
		task.fileContextTracker.trackFileRead(absolutePath, 'read_tool');
		task.didEditFile = true; // Mark as interacted with files

		return result;
	} catch (error) {
		return `Error reading file: ${(error as Error).message}`;
	}
}
