/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Run Slash Command Tool - Executes custom slash commands
 */

export interface RunSlashCommandParams {
	command: string;
	args?: string;
}

export interface SlashCommand {
	name: string;
	description?: string;
	argumentHint?: string;
	content: string;
	source: 'built-in' | 'workspace' | 'user';
}

/**
 * Validate run slash command parameters
 */
export function validateRunSlashCommandParams(
	params: RunSlashCommandParams
): { valid: boolean; error?: string } {
	if (!params.command) {
		return { valid: false, error: 'Missing required parameter: command' };
	}

	return { valid: true };
}

/**
 * Format command result
 */
export function formatCommandResult(command: SlashCommand, args?: string): string {
	let result = `Command: /${command.name}`;

	if (command.description) {
		result += `\nDescription: ${command.description}`;
	}

	if (command.argumentHint) {
		result += `\nArgument hint: ${command.argumentHint}`;
	}

	if (args) {
		result += `\nProvided arguments: ${args}`;
	}

	result += `\nSource: ${command.source}`;
	result += `\n\n--- Command Content ---\n\n${command.content}`;

	return result;
}

/**
 * Create error message for command not found
 */
export function createCommandNotFoundError(
	commandName: string,
	availableCommands: string[]
): string {
	return `Command '${commandName}' not found. Available commands: ${availableCommands.join(', ') || '(none)'}`;
}
