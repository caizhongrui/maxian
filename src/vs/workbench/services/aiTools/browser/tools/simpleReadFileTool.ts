/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Simple Read File Tool - Simplified file reading for models with limited capabilities
 */

export interface SimpleReadFileParams {
	path: string;
}

export interface FileReadResult {
	success: boolean;
	path: string;
	content?: string;
	lines?: string;
	notice?: string;
	error?: string;
	isBinary?: boolean;
	isEmpty?: boolean;
}

export const DEFAULT_MAX_IMAGE_FILE_SIZE_MB = 5;
export const DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB = 20;

export const SUPPORTED_IMAGE_FORMATS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'] as const;
export const SUPPORTED_BINARY_FORMATS = ['.pdf', '.docx', '.ipynb'] as const;

/**
 * Validate simple read file parameters
 */
export function validateSimpleReadFileParams(
	params: SimpleReadFileParams
): { valid: boolean; error?: string } {
	if (!params.path) {
		return { valid: false, error: 'Missing required parameter: path' };
	}

	return { valid: true };
}

/**
 * Check if file format is supported image
 */
export function isSupportedImageFormat(extension: string): boolean {
	return SUPPORTED_IMAGE_FORMATS.includes(extension.toLowerCase() as any);
}

/**
 * Check if file format is supported binary
 */
export function isSupportedBinaryFormat(extension: string): boolean {
	return SUPPORTED_BINARY_FORMATS.includes(extension.toLowerCase() as any);
}

/**
 * Add line numbers to content
 */
export function addLineNumbers(content: string): string {
	const lines = content.split('\n');
	return lines.map((line, index) => `${index + 1}: ${line}`).join('\n');
}

/**
 * Strip line numbers from content
 */
export function stripLineNumbers(content: string): string {
	return content.replace(/^\d+:\s*/gm, '');
}

/**
 * Check if every line has line numbers
 */
export function everyLineHasLineNumbers(content: string): boolean {
	const lines = content.split('\n');
	return lines.every(line => /^\d+:\s/.test(line));
}

/**
 * Format file read result as XML
 */
export function formatAsXml(result: FileReadResult): string {
	let xml = `<file><path>${result.path}</path>\n`;

	if (result.error) {
		xml += `<error>${result.error}</error>`;
	} else if (result.isBinary) {
		const format = result.path.split('.').pop() || 'bin';
		xml += `<binary_file format="${format}">Binary file - content not displayed</binary_file>`;
	} else if (result.isEmpty) {
		xml += `<content/>\n<notice>File is empty</notice>`;
	} else if (result.content) {
		xml += `<content${result.lines ? ` lines="${result.lines}"` : ''}>\n${result.content}</content>`;
		if (result.notice) {
			xml += `\n<notice>${result.notice}</notice>`;
		}
	}

	xml += '\n</file>';
	return xml;
}

/**
 * Get file description for tool
 */
export function getSimpleReadFileToolDescription(blockName: string, blockParams: any): string {
	if (blockParams.path) {
		return `[${blockName} for '${blockParams.path}']`;
	} else {
		return `[${blockName} with missing path]`;
	}
}
