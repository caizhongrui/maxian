/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Access MCP Resource Tool - Accesses resources from Model Context Protocol servers
 */

export interface AccessMcpResourceParams {
	server_name: string;
	uri: string;
}

export interface McpResourceContent {
	text?: string;
	mimeType?: string;
	blob?: string;
}

export interface McpResourceResult {
	success: boolean;
	contents?: McpResourceContent[];
	error?: string;
}

/**
 * Validate access MCP resource parameters
 */
export function validateAccessMcpResourceParams(
	params: AccessMcpResourceParams
): { valid: boolean; error?: string } {
	if (!params.server_name) {
		return { valid: false, error: 'Missing required parameter: server_name' };
	}

	if (!params.uri) {
		return { valid: false, error: 'Missing required parameter: uri' };
	}

	return { valid: true };
}

/**
 * Process resource result content
 */
export function processResourceContent(resourceResult: McpResourceResult): {
	text: string;
	images: string[];
} {
	const textParts: string[] = [];
	const images: string[] = [];

	if (!resourceResult.contents) {
		return { text: '(Empty response)', images: [] };
	}

	resourceResult.contents.forEach((item) => {
		if (item.text) {
			textParts.push(item.text);
		}

		// Handle images (image must contain mimetype and blob)
		if (item.mimeType?.startsWith('image') && item.blob) {
			if (item.blob.startsWith('data:')) {
				images.push(item.blob);
			} else {
				images.push(`data:${item.mimeType};base64,${item.blob}`);
			}
		}
	});

	return {
		text: textParts.length > 0 ? textParts.join('\n\n') : '(Empty response)',
		images,
	};
}
