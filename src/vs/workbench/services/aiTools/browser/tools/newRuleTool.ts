/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * New Rule Tool - Creates or modifies files with validation
 */

export interface NewRuleParams {
	path: string;
	content: string;
}

export interface NewRuleResult {
	success: boolean;
	path?: string;
	isNewFile?: boolean;
	error?: string;
	userEdits?: string;
	finalContent?: string;
}

/**
 * Validate new rule parameters
 */
export function validateNewRuleParams(params: NewRuleParams): { valid: boolean; error?: string } {
	if (!params.path) {
		return { valid: false, error: 'Missing required parameter: path' };
	}

	if (!params.content) {
		return { valid: false, error: 'Missing required parameter: content' };
	}

	return { valid: true };
}

/**
 * Pre-process content to remove common artifacts
 */
export function preprocessContent(content: string, isClaudeModel: boolean): string {
	let processed = content;

	// Remove markdown codeblock markers
	if (processed.startsWith('```')) {
		processed = processed.split('\n').slice(1).join('\n').trim();
	}

	if (processed.endsWith('```')) {
		processed = processed.split('\n').slice(0, -1).join('\n').trim();
	}

	// Unescape HTML entities for non-Claude models
	if (!isClaudeModel) {
		processed = unescapeHtmlEntities(processed);
	}

	return processed;
}

/**
 * Unescape HTML entities
 */
export function unescapeHtmlEntities(text: string): string {
	const entities: Record<string, string> = {
		'&lt;': '<',
		'&gt;': '>',
		'&amp;': '&',
		'&quot;': '"',
		'&#39;': "'",
	};

	return text.replace(/&[a-z]+;|&#\d+;/gi, match => entities[match] || match);
}

/**
 * Check if content has line numbers
 */
export function hasLineNumbers(content: string): boolean {
	const lines = content.split('\n');
	return lines.every(line => /^\d+:\s/.test(line) || line.trim() === '');
}

/**
 * Strip line numbers from content
 */
export function stripLineNumbers(content: string): string {
	return content.replace(/^\d+:\s*/gm, '');
}

/**
 * Add line numbers to content
 */
export function addLineNumbers(content: string): string {
	const lines = content.split('\n');
	return lines.map((line, index) => `${index + 1}: ${line}`).join('\n');
}

/**
 * Create pretty patch diff
 */
export function createPrettyPatch(
	filePath: string,
	originalContent: string,
	newContent: string
): string {
	// Simplified diff creation - real implementation would use a diff library
	const originalLines = originalContent.split('\n');
	const newLines = newContent.split('\n');

	const diff: string[] = [`--- ${filePath}`, `+++ ${filePath}`, ''];

	let i = 0;
	let j = 0;

	while (i < originalLines.length || j < newLines.length) {
		if (i < originalLines.length && j < newLines.length) {
			if (originalLines[i] === newLines[j]) {
				diff.push(` ${originalLines[i]}`);
				i++;
				j++;
			} else {
				diff.push(`-${originalLines[i]}`);
				diff.push(`+${newLines[j]}`);
				i++;
				j++;
			}
		} else if (i < originalLines.length) {
			diff.push(`-${originalLines[i]}`);
			i++;
		} else {
			diff.push(`+${newLines[j]}`);
			j++;
		}
	}

	return diff.join('\n');
}
