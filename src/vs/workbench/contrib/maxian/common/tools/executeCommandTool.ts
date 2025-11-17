/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Complete implementation from Kilocode
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

import type { Task } from '../task/Task.js';
import type { ToolResponse } from './toolTypes.js';

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const MAX_OUTPUT_LENGTH = 10000; // Max characters in output

export async function executeCommandTool(
	task: Task,
	params: any,
): Promise<ToolResponse> {
	const command = params.command;
	const customCwd = params.cwd;

	if (!command) {
		return 'Error: No command provided';
	}

	try {
		// Determine working directory
		let workingDir: string;
		if (!customCwd) {
			workingDir = task.workspacePath;
		} else if (path.isAbsolute(customCwd)) {
			workingDir = customCwd;
		} else {
			workingDir = path.resolve(task.workspacePath, customCwd);
		}

		// Check if directory exists
		if (!fs.existsSync(workingDir)) {
			return `Error: Working directory does not exist: ${workingDir}`;
		}

		// Execute command with timeout
		const result = await Promise.race([
			execAsync(command, {
				cwd: workingDir,
				maxBuffer: MAX_OUTPUT_LENGTH,
			}),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Command timed out')), DEFAULT_TIMEOUT)
			),
		]);

		const stdout = result.stdout || '';
		const stderr = result.stderr || '';

		// Truncate output if too long
		const truncateOutput = (text: string, maxLen: number) => {
			if (text.length <= maxLen) {
				return text;
			}
			const half = Math.floor(maxLen / 2);
			return text.slice(0, half) + '\n\n... (output truncated) ...\n\n' + text.slice(-half);
		};

		const output = [
			`Command: ${command}`,
			`Working directory: ${workingDir}`,
			'',
			'Output:',
			truncateOutput(stdout, MAX_OUTPUT_LENGTH),
		];

		if (stderr) {
			output.push('');
			output.push('Error output:');
			output.push(truncateOutput(stderr, MAX_OUTPUT_LENGTH));
		}

		// Track that command was executed
		task.didEditFile = true; // Mark as potentially modified environment

		return output.join('\n');
	} catch (error: any) {
		const errorMessage = error.message || String(error);
		const stdout = error.stdout || '';
		const stderr = error.stderr || '';

		const output = [
			`Command: ${command}`,
			`Error: ${errorMessage}`,
		];

		if (stdout) {
			output.push('');
			output.push('Output before error:');
			output.push(stdout.toString());
		}

		if (stderr) {
			output.push('');
			output.push('Error output:');
			output.push(stderr.toString());
		}

		return output.join('\n');
	}
}
