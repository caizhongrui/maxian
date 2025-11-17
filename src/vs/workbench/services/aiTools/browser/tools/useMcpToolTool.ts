/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Use MCP Tool - Executes tools from Model Context Protocol servers
 */

export interface McpToolParams {
	server_name: string;
	tool_name: string;
	arguments?: string;
}

export interface McpToolResult {
	success: boolean;
	content?: any[];
	isError?: boolean;
	error?: string;
}

export interface McpServer {
	name: string;
	tools?: McpTool[];
}

export interface McpTool {
	name: string;
	description?: string;
	enabledForPrompt?: boolean;
}

export type McpExecutionStatus = 'started' | 'output' | 'completed' | 'error';

/**
 * Validate MCP tool parameters
 */
export function validateMcpToolParams(params: McpToolParams): { valid: boolean; error?: string } {
	if (!params.server_name) {
		return { valid: false, error: 'Missing required parameter: server_name' };
	}

	if (!params.tool_name) {
		return { valid: false, error: 'Missing required parameter: tool_name' };
	}

	if (params.arguments) {
		try {
			JSON.parse(params.arguments);
		} catch (error) {
			return { valid: false, error: 'Invalid JSON in arguments parameter' };
		}
	}

	return { valid: true };
}

/**
 * Validate that a tool exists on the server
 */
export function validateToolExists(
	serverName: string,
	toolName: string,
	servers: McpServer[]
): { valid: boolean; availableTools?: string[]; error?: string } {
	const server = servers.find(s => s.name === serverName);

	if (!server) {
		const availableServers = servers.map(s => s.name);
		return {
			valid: false,
			error: `Server not found: ${serverName}. Available servers: ${availableServers.join(', ')}`,
		};
	}

	if (!server.tools || server.tools.length === 0) {
		return {
			valid: false,
			availableTools: [],
			error: `No tools available on server: ${serverName}`,
		};
	}

	const tool = server.tools.find(t => t.name === toolName);

	if (!tool) {
		const availableTools = server.tools.map(t => t.name);
		return {
			valid: false,
			availableTools,
			error: `Tool not found: ${toolName}. Available tools: ${availableTools.join(', ')}`,
		};
	}

	if (tool.enabledForPrompt === false) {
		const enabledTools = server.tools.filter(t => t.enabledForPrompt !== false).map(t => t.name);
		return {
			valid: false,
			availableTools: enabledTools,
			error: `Tool is disabled: ${toolName}`,
		};
	}

	return { valid: true };
}

/**
 * Process tool result content
 */
export function processToolContent(toolResult: McpToolResult): string {
	if (!toolResult.content || toolResult.content.length === 0) {
		return '';
	}

	const outputText = toolResult.content
		.map((item: any) => {
			if (item.type === 'text') {
				return item.text;
			}
			if (item.type === 'resource') {
				const { blob: _, ...rest } = item.resource;
				return JSON.stringify(rest, null, 2);
			}
			if (item.type === 'resource_link') {
				const { uri, name, description, mimeType } = item;
				return `Resource Link: ${name || uri}${description ? ` - ${description}` : ''}${mimeType ? ` (${mimeType})` : ''}`;
			}
			if (item.type === 'image') {
				return `[Image: ${item.mimeType}]`;
			}
			if (item.type === 'audio') {
				return `[Audio: ${item.mimeType}]`;
			}
			return '';
		})
		.filter(Boolean)
		.join('\n\n');

	return outputText;
}

/**
 * Reverse property renaming applied in schema generation (native tool calling)
 * Properties named `renamed_*` are converted back to their original names
 */
export function reversePropertyRenaming(
	args: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
	if (!args) {
		return args;
	}
	const reversed: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(args)) {
		if (key.startsWith('renamed_')) {
			reversed[key.substring('renamed_'.length)] = value;
		} else {
			reversed[key] = value;
		}
	}
	return reversed;
}
