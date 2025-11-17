/*---------------------------------------------------------------------------------------------
 *  Adapted from kilocode writeToFileTool.ts
 *  Original dependencies replaced with VS Code services
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ITextFileService } from '../../../textfile/common/textfiles.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';

export interface WriteToFileToolParams {
	path: string;
	content: string;
	line_count?: number;
}

export interface WriteToFileToolResult {
	success: boolean;
	message?: string;
	error?: string;
	isNewFile?: boolean;
}

export async function writeToFileTool(
	params: WriteToFileToolParams,
	fileService: IFileService,
	textFileService: ITextFileService,
	workspaceRoot: URI
): Promise<WriteToFileToolResult> {
	try {
		if (!params.path) {
			return {
				success: false,
				error: 'Missing required parameter: path'
			};
		}

		if (params.content === undefined) {
			return {
				success: false,
				error: 'Missing required parameter: content'
			};
		}

		let content = params.content;

		// Pre-processing: remove markdown code block markers if present
		if (content.startsWith('```')) {
			content = content.split('\n').slice(1).join('\n');
		}
		if (content.endsWith('```')) {
			content = content.split('\n').slice(0, -1).join('\n');
		}

		const fileUri = URI.joinPath(workspaceRoot, params.path);
		const fileExists = await fileService.exists(fileUri);

		// Write file content
		const buffer = VSBuffer.fromString(content);
		await fileService.writeFile(fileUri, buffer, {
			unlock: false
		});

		return {
			success: true,
			message: fileExists
				? `File '${params.path}' updated successfully`
				: `File '${params.path}' created successfully`,
			isNewFile: !fileExists
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
