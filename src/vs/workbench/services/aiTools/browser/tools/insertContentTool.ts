/*---------------------------------------------------------------------------------------------
 *  Adapted from kilocode insertContentTool.ts
 *  Original dependencies replaced with VS Code services
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';

export interface InsertContentToolParams {
	path: string;
	line: number;
	content: string;
}

export interface InsertContentToolResult {
	success: boolean;
	message?: string;
	error?: string;
	isNewFile?: boolean;
}

/**
 * Insert content at a specific line in a file
 */
export async function insertContentTool(
	params: InsertContentToolParams,
	fileService: IFileService,
	workspaceRoot: URI
): Promise<InsertContentToolResult> {
	try {
		if (!params.path) {
			return {
				success: false,
				error: 'Missing required parameter: path'
			};
		}

		if (params.line === undefined) {
			return {
				success: false,
				error: 'Missing required parameter: line'
			};
		}

		if (params.content === undefined) {
			return {
				success: false,
				error: 'Missing required parameter: content'
			};
		}

		const lineNumber = typeof params.line === 'number' ? params.line : parseInt(String(params.line), 10);

		if (isNaN(lineNumber) || lineNumber < 0) {
			return {
				success: false,
				error: 'Invalid line number. Must be a non-negative integer.'
			};
		}

		const fileUri = URI.joinPath(workspaceRoot, params.path);
		const fileExists = await fileService.exists(fileUri);

		let fileContent = '';
		if (fileExists) {
			const content = await fileService.readFile(fileUri);
			fileContent = content.value.toString();
		} else {
			// For new files, line must be 0 or 1
			if (lineNumber > 1) {
				return {
					success: false,
					error: `Cannot insert content at line ${lineNumber} into a non-existent file. For new files, 'line' must be 0 (to append) or 1 (to insert at the beginning).`
				};
			}
		}

		const lines = fileExists ? fileContent.split('\n') : [];
		const contentLines = params.content.split('\n');

		// Insert content at specified line (1-based indexing)
		// lineNumber 0 means append at the end
		// lineNumber 1 means insert at the beginning
		if (lineNumber === 0) {
			lines.push(...contentLines);
		} else {
			const insertIndex = lineNumber - 1;
			lines.splice(insertIndex, 0, ...contentLines);
		}

		const updatedContent = lines.join('\n');

		// Write the updated content
		const buffer = VSBuffer.fromString(updatedContent);
		await fileService.writeFile(fileUri, buffer, {
			unlock: false
		});

		return {
			success: true,
			message: fileExists
				? `Content inserted at line ${lineNumber} in '${params.path}'`
				: `File '${params.path}' created with content at line ${lineNumber}`,
			isNewFile: !fileExists
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
