/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ITreeSitterService, IParseResult, ICodeDefinition } from './treeSitter.js';

/**
 * Format code definitions as a human-readable string
 * This is useful for the list_code_definitions tool
 */
export function formatCodeDefinitions(result: IParseResult): string {
	if (result.error) {
		return `Error parsing ${result.uri.fsPath}: ${result.error}`;
	}

	if (result.definitions.length === 0) {
		return `No code definitions found in ${result.uri.fsPath}`;
	}

	const lines: string[] = [];
	lines.push(`# ${result.uri.fsPath}`);
	lines.push('');

	// Group definitions by type
	const grouped = new Map<string, ICodeDefinition[]>();
	for (const def of result.definitions) {
		if (!grouped.has(def.type)) {
			grouped.set(def.type, []);
		}
		grouped.get(def.type)!.push(def);
	}

	// Output each type group
	for (const [type, defs] of grouped) {
		lines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}s`);
		for (const def of defs) {
			lines.push(`${def.startLine}--${def.endLine} | ${def.text}`);
		}
		lines.push('');
	}

	return lines.join('\n');
}

/**
 * Format multiple parse results
 */
export function formatMultipleResults(results: IParseResult[]): string {
	return results.map(result => formatCodeDefinitions(result)).join('\n\n');
}

/**
 * Extract definitions from a directory (given a list of file URIs)
 */
export async function extractDefinitionsFromFiles(
	treeSitterService: ITreeSitterService,
	fileUris: URI[]
): Promise<string> {
	// Filter to only supported files
	const supportedFiles = fileUris.filter(uri => treeSitterService.isSupported(uri));

	if (supportedFiles.length === 0) {
		return 'No supported files found';
	}

	// Parse all files
	const results = await treeSitterService.parseFiles(supportedFiles);

	// Format and return
	return formatMultipleResults(results);
}

/**
 * Get a summary of definitions found in multiple files
 */
export function getDefinitionsSummary(results: IParseResult[]): string {
	const summary = {
		totalFiles: results.length,
		successfulParsed: 0,
		errors: 0,
		totalDefinitions: 0,
		byType: new Map<string, number>()
	};

	for (const result of results) {
		if (result.error) {
			summary.errors++;
		} else {
			summary.successfulParsed++;
			summary.totalDefinitions += result.definitions.length;

			for (const def of result.definitions) {
				summary.byType.set(def.type, (summary.byType.get(def.type) || 0) + 1);
			}
		}
	}

	const lines: string[] = [];
	lines.push(`Total files: ${summary.totalFiles}`);
	lines.push(`Successfully parsed: ${summary.successfulParsed}`);
	lines.push(`Errors: ${summary.errors}`);
	lines.push(`Total definitions: ${summary.totalDefinitions}`);
	lines.push('');
	lines.push('Definitions by type:');
	for (const [type, count] of summary.byType) {
		lines.push(`  ${type}: ${count}`);
	}

	return lines.join('\n');
}
