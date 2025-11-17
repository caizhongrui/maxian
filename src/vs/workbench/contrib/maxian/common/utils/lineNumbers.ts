/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Ported from Kilocode: src/integrations/misc/extract-text.ts
// Adapted for tianhe-zhikai-ide: Line number utilities for file content

/**
 * Adds line numbers to content with proper formatting
 *
 * @param content The content to add line numbers to
 * @param startLine The starting line number (default: 1)
 * @returns The content with line numbers added
 */
export function addLineNumbers(content: string, startLine: number = 1): string {
	// If content is empty, return empty string - empty files should not have line numbers
	// If content is empty but startLine > 1, return "startLine | " because we know the file is not empty
	// but the content is empty at that line offset
	if (content === '') {
		return startLine === 1 ? '' : `${startLine} | \n`;
	}

	// Split into lines and handle trailing line feeds (\n)
	const lines = content.split('\n');
	const lastLineEmpty = lines[lines.length - 1] === '';
	if (lastLineEmpty) {
		lines.pop();
	}

	const maxLineNumberWidth = String(startLine + lines.length - 1).length;
	const numberedContent = lines
		.map((line, index) => {
			const lineNumber = String(startLine + index).padStart(maxLineNumberWidth, ' ');
			return `${lineNumber} | ${line}`;
		})
		.join('\n');

	return numberedContent + '\n';
}

/**
 * Checks if every line in the content has line numbers prefixed (e.g., "1 | content" or "123 | content")
 * Line numbers must be followed by a single pipe character (not double pipes)
 *
 * @param content The content to check
 * @returns True if every line has line numbers, false otherwise
 */
export function everyLineHasLineNumbers(content: string): boolean {
	const lines = content.split(/\r?\n/); // Handles both CRLF and LF line endings
	return lines.length > 0 && lines.every((line) => /^\s*\d+\s+\|(?!\|)/.test(line));
}

/**
 * Strips line numbers from content while preserving the actual content.
 *
 * @param content The content to process
 * @param aggressive When false (default): Only strips lines with clear number patterns like "123 | content"
 *                   When true: Uses a more lenient pattern that also matches lines with just a pipe character,
 *                   which can be useful when LLMs don't perfectly format the line numbers in diffs
 * @returns The content with line numbers removed
 */
export function stripLineNumbers(content: string, aggressive: boolean = false): string {
	// Split into lines to handle each line individually
	const lines = content.split(/\r?\n/);

	// Process each line
	const processedLines = lines.map((line) => {
		// Match line number pattern and capture everything after the pipe
		const match = aggressive ? line.match(/^\s*(?:\d+\s)?\|\s(.*)$/) : line.match(/^\s*\d+\s+\|(?!\|)\s?(.*)$/);
		return match ? match[1] : line;
	});

	// Join back with original line endings (carriage return + line feed or just line feed)
	const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
	let result = processedLines.join(lineEnding);

	// Preserve trailing newline if present in original content
	if (content.endsWith(lineEnding)) {
		if (!result.endsWith(lineEnding)) {
			result += lineEnding;
		}
	}

	return result;
}
