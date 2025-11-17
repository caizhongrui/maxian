/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';

import type { Task } from '../task/Task.js';
import type { ToolResponse } from './toolTypes.js';

export async function listFilesTool(
	task: Task,
	params: any,
): Promise<ToolResponse> {
	const dirPath = params.path || '.';
	const recursive = params.recursive === 'true' || params.recursive === true;

	try {
		// Resolve absolute path
		const absolutePath = path.isAbsolute(dirPath)
			? dirPath
			: path.resolve(task.workspacePath, dirPath);

		// Check if directory exists
		const exists = fs.existsSync(absolutePath);
		if (!exists) {
			return `Error: Directory not found: ${dirPath}`;
		}

		const stat = fs.statSync(absolutePath);
		if (!stat.isDirectory()) {
			return `Error: Path is not a directory: ${dirPath}`;
		}

		// List files
		const files: string[] = [];

		const listDir = (dir: string, prefix: string = '') => {
			const entries = fs.readdirSync(dir, { withFileTypes: true });

			for (const entry of entries) {
				const relativePath = path.join(prefix, entry.name);
				const fullPath = path.join(dir, entry.name);

				// Skip hidden files and node_modules
				if (entry.name.startsWith('.') || entry.name === 'node_modules') {
					continue;
				}

				if (entry.isDirectory()) {
					files.push(`${relativePath}/`);
					if (recursive) {
						listDir(fullPath, relativePath);
					}
				} else {
					files.push(relativePath);
				}
			}
		};

		listDir(absolutePath);

		const result = [
			`Directory: ${dirPath}`,
			`Mode: ${recursive ? 'Recursive' : 'Non-recursive'}`,
			`Total items: ${files.length}`,
			'',
			'Files and directories:',
			...files.sort(),
		].join('\n');

		return result;
	} catch (error) {
		return `Error listing directory: ${(error as Error).message}`;
	}
}
