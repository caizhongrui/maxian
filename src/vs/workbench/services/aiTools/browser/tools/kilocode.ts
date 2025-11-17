/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Kilocode Utility Functions - Helper functions for various tool operations
 */

const SIZE_LIMIT_AS_CONTEXT_WINDOW_FRACTION = 0.8;

export interface TokenCountResult {
	tokens: number;
	exceedsLimit: boolean;
	limit: number;
}

export interface FileReadBlockResult {
	status: 'blocked';
	error: string;
	xmlContent: string;
}

export interface FileEntry {
	path?: string;
	lineRanges?: {
		start: number;
		end: number;
	}[];
}

/**
 * Check if very large reads are allowed
 */
export function allowVeryLargeReads(settings: { allowVeryLargeReads?: boolean }): boolean {
	return settings?.allowVeryLargeReads ?? false;
}

/**
 * Get token limit based on context window
 */
export function getTokenLimit(contextWindow: number): number {
	return SIZE_LIMIT_AS_CONTEXT_WINDOW_FRACTION * contextWindow;
}

/**
 * Estimate token count (rough approximation: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Check if content exceeds token limit
 */
export function checkTokenLimit(
	content: string,
	contextWindow: number,
	allowLargeReads: boolean = false
): TokenCountResult {
	if (allowLargeReads) {
		return {
			tokens: estimateTokens(content),
			exceedsLimit: false,
			limit: getTokenLimit(contextWindow),
		};
	}

	const tokenLimit = getTokenLimit(contextWindow);
	const tokenEstimate = estimateTokens(content);

	return {
		tokens: tokenEstimate,
		exceedsLimit: tokenEstimate >= tokenLimit,
		limit: tokenLimit,
	};
}

/**
 * Summarize successful MCP output when too long
 */
export function summarizeSuccessfulMcpOutputWhenTooLong(
	outputText: string,
	contextWindow: number,
	allowLargeReads: boolean = false
): string {
	if (allowLargeReads) {
		return outputText;
	}

	const result = checkTokenLimit(outputText, contextWindow, allowLargeReads);

	if (!result.exceedsLimit) {
		return outputText;
	}

	return (
		`The MCP tool executed successfully, but the output is unavailable, ` +
		`because it is too long (${result.tokens} estimated tokens, limit is ${result.limit} tokens). ` +
		`If you need the output, find an alternative way to get it in manageable chunks.`
	);
}

/**
 * Block file read when too large
 */
export function blockFileReadWhenTooLarge(
	relPath: string,
	content: string,
	contextWindow: number,
	settings: { allowVeryLargeReads?: boolean; maxReadFileLine?: number }
): FileReadBlockResult | undefined {
	if (allowVeryLargeReads(settings)) {
		return undefined;
	}

	const result = checkTokenLimit(content, contextWindow, false);

	if (!result.exceedsLimit) {
		return undefined;
	}

	const linesRangesAreAllowed = (settings?.maxReadFileLine ?? 0) >= 0;
	const errorMsg =
		`File content exceeds token limit (${result.tokens} estimated tokens, limit is ${result.limit} tokens).` +
		(linesRangesAreAllowed ? ` Please use line_range to read smaller sections.` : ``);

	return {
		status: 'blocked' as const,
		error: errorMsg,
		xmlContent: `<file><path>${relPath}</path><error>${errorMsg}</error></file>`,
	};
}

/**
 * Parse native files format
 */
export function parseNativeFiles(nativeFiles: { path?: string; line_ranges?: string[] }[]): FileEntry[] {
	const fileEntries = new Array<FileEntry>();

	for (const file of nativeFiles) {
		if (!file.path) {
			continue;
		}

		const fileEntry: FileEntry = {
			path: file.path,
			lineRanges: [],
		};

		// Handle line_ranges array from native format
		if (file.line_ranges && Array.isArray(file.line_ranges)) {
			for (const range of file.line_ranges) {
				const match = String(range).match(/(\d+)-(\d+)/);
				if (match) {
					const [, start, end] = match.map(Number);
					if (!isNaN(start) && !isNaN(end)) {
						fileEntry.lineRanges?.push({ start, end });
					}
				}
			}
		}

		fileEntries.push(fileEntry);
	}

	return fileEntries;
}

/**
 * Get description for native read file tool
 */
export function getNativeReadFileToolDescription(blockName: string, files: FileEntry[]): string {
	const paths = files.map((file) => file.path);

	if (paths.length === 0) {
		return `[${blockName} with no valid paths]`;
	} else if (paths.length === 1) {
		// Modified part for single file
		return `[${blockName} for '${paths[0]}'. Reading multiple files at once is more efficient for the LLM. If other files are relevant to your current task, please read them simultaneously.]`;
	} else if (paths.length <= 3) {
		const pathList = paths.map((p) => `'${p}'`).join(', ');
		return `[${blockName} for ${pathList}]`;
	} else {
		return `[${blockName} for ${paths.length} files]`;
	}
}
