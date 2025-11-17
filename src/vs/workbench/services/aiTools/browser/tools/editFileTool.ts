/*---------------------------------------------------------------------------------------------
 *  Adapted from kilocode editFileTool.ts (Fast Apply feature)
 *  Original dependencies replaced with VS Code services
 *  Note: Fast Apply feature simplified - OpenAI API calls removed
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';

export interface EditFileToolParams {
	target_file: string;
	instructions: string;
	code_edit: string;
}

export interface EditFileToolResult {
	success: boolean;
	message?: string;
	error?: string;
	isNewFile?: boolean;
}

/**
 * Edit or create a file with given content
 * Note: The original Fast Apply feature using Morph API has been removed for simplicity
 * This version directly applies the code_edit content to the file
 */
export async function editFileTool(
	params: EditFileToolParams,
	fileService: IFileService,
	workspaceRoot: URI
): Promise<EditFileToolResult> {
	try {
		if (!params.target_file) {
			return {
				success: false,
				error: 'Missing required parameter: target_file'
			};
		}

		if (!params.instructions) {
			return {
				success: false,
				error: 'Missing required parameter: instructions'
			};
		}

		if (params.code_edit === undefined) {
			return {
				success: false,
				error: 'Missing required parameter: code_edit'
			};
		}

		const fileUri = URI.joinPath(workspaceRoot, params.target_file);
		const fileExists = await fileService.exists(fileUri);

		// Write the new content directly
		const buffer = VSBuffer.fromString(params.code_edit);
		await fileService.writeFile(fileUri, buffer, {
			unlock: false
		});

		return {
			success: true,
			message: fileExists
				? `File '${params.target_file}' edited successfully`
				: `File '${params.target_file}' created successfully`,
			isNewFile: !fileExists
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
