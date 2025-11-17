/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * List Code Definition Names Tool - Extracts code definitions from source files
 */

export interface CodeDefinition {
	name: string;
	kind: string; // function, class, method, etc.
	line: number;
	file?: string;
}

export interface ListCodeDefinitionsParams {
	path: string;
}

export interface ListCodeDefinitionsResult {
	success: boolean;
	definitions?: CodeDefinition[];
	message?: string;
	error?: string;
}

/**
 * Truncate definitions to a specified line limit
 */
export function truncateDefinitionsToLineLimit(
	definitions: string,
	maxLines: number
): string {
	if (maxLines <= 0) {
		return definitions;
	}

	const lines = definitions.split('\n');
	if (lines.length <= maxLines) {
		return definitions;
	}

	const truncated = lines.slice(0, maxLines).join('\n');
	const remaining = lines.length - maxLines;
	return `${truncated}\n... (${remaining} more lines truncated)`;
}

/**
 * Format code definitions as a string
 */
export function formatCodeDefinitions(definitions: CodeDefinition[]): string {
	if (definitions.length === 0) {
		return 'No source code definitions found.';
	}

	const grouped = new Map<string, CodeDefinition[]>();

	for (const def of definitions) {
		const key = def.file || 'current_file';
		if (!grouped.has(key)) {
			grouped.set(key, []);
		}
		grouped.get(key)!.push(def);
	}

	const parts: string[] = [];

	for (const [file, defs] of grouped.entries()) {
		if (file !== 'current_file') {
			parts.push(`\n${file}:`);
		}
		for (const def of defs) {
			parts.push(`  ${def.kind} ${def.name} (line ${def.line})`);
		}
	}

	return parts.join('\n');
}

/**
 * Parse source code definitions from text
 * This is a simplified placeholder - real implementation would use tree-sitter
 */
export function parseCodeDefinitions(content: string): CodeDefinition[] {
	const definitions: CodeDefinition[] = [];
	const lines = content.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// Simple regex-based parsing (placeholder for tree-sitter)
		// Match function declarations
		const funcMatch = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
		if (funcMatch) {
			definitions.push({
				name: funcMatch[1],
				kind: 'function',
				line: i + 1,
			});
		}

		// Match class declarations
		const classMatch = line.match(/^\s*(?:export\s+)?class\s+(\w+)/);
		if (classMatch) {
			definitions.push({
				name: classMatch[1],
				kind: 'class',
				line: i + 1,
			});
		}

		// Match interface declarations
		const interfaceMatch = line.match(/^\s*(?:export\s+)?interface\s+(\w+)/);
		if (interfaceMatch) {
			definitions.push({
				name: interfaceMatch[1],
				kind: 'interface',
				line: i + 1,
			});
		}
	}

	return definitions;
}
