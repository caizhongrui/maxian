/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Ported from Kilocode: src/integrations/misc/extract-text.ts
// Adapted for tianhe-zhikai-ide: Line number utilities for file content
// P2优化：对齐 OpenCode read.ts 行号格式 "N: content"（去除填充空格）

/**
 * Adds line numbers to content with proper formatting
 * P2优化：对齐 OpenCode 格式 `{lineNum}: {line}`（无填充，冒号分隔）
 *
 * @param content The content to add line numbers to
 * @param startLine The starting line number (default: 1)
 * @returns The content with line numbers added
 */
export function addLineNumbers(content: string, startLine: number = 1): string {
	// If content is empty, return empty string - empty files should not have line numbers
	// If content is empty but startLine > 1, return "startLine: " because we know the file is not empty
	// but the content is empty at that line offset
	if (content === '') {
		return startLine === 1 ? '' : `${startLine}: \n`;
	}

	// Split into lines and handle trailing line feeds (\n)
	const lines = content.split('\n');
	const lastLineEmpty = lines[lines.length - 1] === '';
	if (lastLineEmpty) {
		lines.pop();
	}

	// P2优化：使用 "N: content" 格式（对齐 OpenCode，无填充空格）
	const numberedContent = lines
		.map((line, index) => `${startLine + index}: ${line}`)
		.join('\n');

	return numberedContent + '\n';
}

/**
 * Checks if every line in the content has line numbers prefixed
 * P2优化：对齐新格式 "N: content"
 *
 * @param content The content to check
 * @returns True if every line has line numbers, false otherwise
 */
export function everyLineHasLineNumbers(content: string): boolean {
	const lines = content.split(/\r?\n/);
	// 兼容新格式 "N: " 和旧格式 "N | "（避免 AI 输出旧格式时剥离失败）
	return lines.length > 0 && lines.every((line) =>
		/^\d+: /.test(line) || /^\s*\d+\s+\|(?!\|)/.test(line)
	);
}

/**
 * Strips line numbers from content while preserving the actual content.
 * P2优化：对齐新格式 "N: content"，同时保留旧格式 "N | content" 兼容
 *
 * @param content The content to process
 * @param aggressive When false (default): Only strips lines with clear number patterns
 *                   When true: Uses a more lenient pattern
 * @returns The content with line numbers removed
 */
export function stripLineNumbers(content: string, aggressive: boolean = false): string {
	// Split into lines to handle each line individually
	const lines = content.split(/\r?\n/);

	// Process each line
	const processedLines = lines.map((line) => {
		// 优先匹配新格式 "N: content"
		const newFmtMatch = line.match(/^(\d+): (.*)$/);
		if (newFmtMatch) {
			return newFmtMatch[2];
		}
		// 兼容旧格式 "N | content"
		const oldFmtMatch = aggressive
			? line.match(/^\s*(?:\d+\s)?\|\s(.*)$/)
			: line.match(/^\s*\d+\s+\|(?!\|)\s?(.*)$/);
		return oldFmtMatch ? oldFmtMatch[1] : line;
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
