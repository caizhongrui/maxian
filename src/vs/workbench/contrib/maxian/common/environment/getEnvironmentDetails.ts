/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Complete implementation from Kilocode
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

import type { Task } from '../task/Task.js';

/**
 * Get environment details for system prompt
 * Provides information about the workspace, OS, and tools
 */
export async function getEnvironmentDetails(
	task: Task,
	includeFileDetails: boolean = false
): Promise<string> {
	const details: string[] = [];

	// Operating System
	const platform = os.platform();
	const platformNames: Record<string, string> = {
		'darwin': 'macOS',
		'win32': 'Windows',
		'linux': 'Linux',
	};
	const platformName = platformNames[platform] || platform;

	details.push(`# Environment`);
	details.push(`Operating System: ${platformName} ${os.release()}`);
	details.push(`Architecture: ${os.arch()}`);
	details.push(`Node.js: ${process.version}`);
	details.push('');

	// Working Directory
	details.push(`# Working Directory`);
	details.push(`Path: ${task.workspacePath}`);
	details.push('');

	// File Context (if requested and available)
	if (includeFileDetails) {
		const recentFiles = await task.fileContextTracker.getRecentFiles(10);
		if (recentFiles.length > 0) {
			details.push(`# Recently Accessed Files`);
			recentFiles.forEach((file: string) => {
				const relativePath = path.relative(task.workspacePath, file);
				details.push(`- ${relativePath}`);
			});
			details.push('');
		}
	}

	// Available Tools
	details.push(`# Available Tools`);
	details.push(`- read_file: Read file contents with optional line ranges`);
	details.push(`- write_to_file: Create or update file contents`);
	details.push(`- list_files: List files and directories`);
	details.push(`- search_files: Search for text in files using regex`);
	details.push(`- execute_command: Execute shell commands`);
	details.push(`- attempt_completion: Mark the task as complete`);
	details.push(`- ask_followup_question: Ask the user for clarification`);
	details.push('');

	// Project Structure (basic overview)
	try {
		const entries = fs.readdirSync(task.workspacePath, { withFileTypes: true });
		const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
		const files = entries.filter(e => e.isFile() && !e.name.startsWith('.')).map(e => e.name);

		if (dirs.length > 0 || files.length > 0) {
			details.push(`# Project Structure`);
			if (dirs.length > 0) {
				details.push(`Directories: ${dirs.slice(0, 10).join(', ')}${dirs.length > 10 ? '...' : ''}`);
			}
			if (files.length > 0) {
				details.push(`Files: ${files.slice(0, 10).join(', ')}${files.length > 10 ? '...' : ''}`);
			}
			details.push('');
		}
	} catch (error) {
		// Ignore errors reading directory
	}

	// Capabilities
	details.push(`# Capabilities`);
	details.push(`- File Operations: Read, write, search, list`);
	details.push(`- Command Execution: Shell commands with output capture`);
	details.push(`- Git Checkpoints: ${task.enableCheckpoints ? 'Enabled' : 'Disabled'}`);
	details.push('');

	return details.join('\n');
}
