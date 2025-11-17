/*---------------------------------------------------------------------------------------------
 *  Adapted from kilocode readFileTool.ts
 *  Original dependencies replaced with VS Code services
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
// import { VSBuffer } from '../../../../../base/common/buffer.js'; // Unused

export interface ReadFileToolParams {
	files?: Array<{
		path: string;
		line_ranges?: Array<{ start: number; end: number }>;
	}>;
	path?: string;
	start_line?: number;
	end_line?: number;
}

export interface ReadFileToolResult {
	success: boolean;
	content?: string;
	error?: string;
}

export async function readFileTool(
	params: ReadFileToolParams,
	fileService: IFileService,
	workspaceRoot: URI
): Promise<ReadFileToolResult> {
	try {
		const fileEntries: Array<{ path: string; lineRanges?: Array<{ start: number; end: number }> }> = [];

		// Handle native JSON format (from OpenAI-style tool calls)
		if (params.files && Array.isArray(params.files)) {
			params.files.forEach(file => {
				fileEntries.push({
					path: file.path,
					lineRanges: file.line_ranges
				});
			});
		} else if (params.path) {
			// Handle legacy single file path
			const entry: { path: string; lineRanges?: Array<{ start: number; end: number }> } = {
				path: params.path
			};

			if (params.start_line !== undefined && params.end_line !== undefined) {
				const start = typeof params.start_line === 'number' ? params.start_line : parseInt(String(params.start_line), 10);
				const end = typeof params.end_line === 'number' ? params.end_line : parseInt(String(params.end_line), 10);
				if (!isNaN(start) && !isNaN(end) && start > 0 && end > 0) {
					entry.lineRanges = [{ start, end }];
				}
			}
			fileEntries.push(entry);
		}

		if (fileEntries.length === 0) {
			return {
				success: false,
				error: 'No valid file paths provided'
			};
		}

		// Process all files
		const results: string[] = [];

		for (const entry of fileEntries) {
			const fileUri = URI.joinPath(workspaceRoot, entry.path);

			// Check if file exists
			const exists = await fileService.exists(fileUri);
			if (!exists) {
				results.push(`<file><path>${entry.path}</path><error>File not found</error></file>`);
				continue;
			}

			// Read file content
			const fileContent = await fileService.readFile(fileUri);
			const content = fileContent.value.toString();

			if (entry.lineRanges && entry.lineRanges.length > 0) {
				// Read specific line ranges
				const lines = content.split('\n');
				const rangeResults: string[] = [];

				for (const range of entry.lineRanges) {
					if (range.start > range.end) {
						return {
							success: false,
							error: 'Invalid line range: end line cannot be less than start line'
						};
					}

					const startIdx = Math.max(0, range.start - 1);
					const endIdx = Math.min(lines.length, range.end);
					const rangeLines = lines.slice(startIdx, endIdx);
					const numberedLines = rangeLines.map((line, idx) => `${startIdx + idx + 1}\t${line}`).join('\n');

					rangeResults.push(`<content lines="${range.start}-${range.end}">\n${numberedLines}\n</content>`);
				}

				results.push(`<file><path>${entry.path}</path>\n${rangeResults.join('\n')}\n</file>`);
			} else {
				// Read entire file
				const lines = content.split('\n');
				const totalLines = lines.length;
				const numberedContent = lines.map((line, idx) => `${idx + 1}\t${line}`).join('\n');

				results.push(`<file><path>${entry.path}</path>\n<content lines="1-${totalLines}">\n${numberedContent}\n</content>\n</file>`);
			}
		}

		return {
			success: true,
			content: `<files>\n${results.join('\n')}\n</files>`
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
