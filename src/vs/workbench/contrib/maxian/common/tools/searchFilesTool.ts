/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';

import type { Task } from '../task/Task.js';
import type { ToolResponse } from './toolTypes.js';

export async function searchFilesTool(
	task: Task,
	params: any,
): Promise<ToolResponse> {
	const searchPath = params.path || '.';
	const regex = params.regex;
	const filePattern = params.file_pattern;

	if (!regex) {
		return 'Error: No search regex provided';
	}

	try {
		// Resolve absolute path
		const absolutePath = path.isAbsolute(searchPath)
			? searchPath
			: path.resolve(task.workspacePath, searchPath);

		// Check if path exists
		const exists = fs.existsSync(absolutePath);
		if (!exists) {
			return `Error: Path not found: ${searchPath}`;
		}

		// Create regex pattern
		const searchRegex = new RegExp(regex, 'i');
		const fileRegex = filePattern ? new RegExp(filePattern) : null;

		const results: Array<{ file: string; line: number; content: string }> = [];

		const searchDir = (dir: string) => {
			const entries = fs.readdirSync(dir, { withFileTypes: true });

			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);

				// Skip hidden files and node_modules
				if (entry.name.startsWith('.') || entry.name === 'node_modules') {
					continue;
				}

				if (entry.isDirectory()) {
					searchDir(fullPath);
				} else if (entry.isFile()) {
					// Check file pattern if specified
					if (fileRegex && !fileRegex.test(entry.name)) {
						continue;
					}

					try {
						const content = fs.readFileSync(fullPath, 'utf-8');
						const lines = content.split('\n');

						lines.forEach((line, idx) => {
							if (searchRegex.test(line)) {
								const relativePath = path.relative(task.workspacePath, fullPath);
								results.push({
									file: relativePath,
									line: idx + 1,
									content: line.trim(),
								});
							}
						});
					} catch (err) {
						// Skip binary or unreadable files
					}
				}
			}
		};

		searchDir(absolutePath);

		// Limit results to avoid overwhelming the AI
		const maxResults = 100;
		const truncated = results.length > maxResults;
		const displayResults = results.slice(0, maxResults);

		const result = [
			`Search: ${regex}`,
			filePattern ? `File pattern: ${filePattern}` : '',
			`Path: ${searchPath}`,
			`Matches found: ${results.length}${truncated ? ` (showing first ${maxResults})` : ''}`,
			'',
			'Results:',
			...displayResults.map(r => `${r.file}:${r.line}: ${r.content}`),
		].filter(Boolean).join('\n');

		return result;
	} catch (error) {
		return `Error searching files: ${(error as Error).message}`;
	}
}
