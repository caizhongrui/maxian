/*---------------------------------------------------------------------------------------------
 *  Adapted from kilocode applyDiffTool.ts
 *  Original dependencies replaced with VS Code services
 *  Note: Diff strategy implementation simplified
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';

export interface ApplyDiffToolParams {
	path: string;
	diff: string;
	start_line?: number;
}

export interface ApplyDiffToolResult {
	success: boolean;
	message?: string;
	error?: string;
	details?: any;
}

/**
 * Simple diff application using SEARCH/REPLACE blocks
 * Format:
 * <<<<<<< SEARCH
 * old content
 * =======
 * new content
 * >>>>>>> REPLACE
 */
function parseDiffBlocks(diff: string): Array<{ search: string; replace: string }> {
	const blocks: Array<{ search: string; replace: string }> = [];
	const regex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

	let match;
	while ((match = regex.exec(diff)) !== null) {
		blocks.push({
			search: match[1],
			replace: match[2]
		});
	}

	return blocks;
}

function applyDiffBlocks(originalContent: string, blocks: Array<{ search: string; replace: string }>): { success: boolean; content?: string; error?: string } {
	let result = originalContent;
	const failedBlocks: number[] = [];

	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];

		// Try to find and replace the search block
		const searchIndex = result.indexOf(block.search);
		if (searchIndex === -1) {
			failedBlocks.push(i);
			continue;
		}

		// Replace the search block with the replace block
		result = result.substring(0, searchIndex) + block.replace + result.substring(searchIndex + block.search.length);
	}

	if (failedBlocks.length > 0) {
		return {
			success: false,
			error: `Failed to apply ${failedBlocks.length} diff block(s). Search content not found in file.`,
			content: result
		};
	}

	return {
		success: true,
		content: result
	};
}

export async function applyDiffTool(
	params: ApplyDiffToolParams,
	fileService: IFileService,
	workspaceRoot: URI
): Promise<ApplyDiffToolResult> {
	try {
		if (!params.path) {
			return {
				success: false,
				error: 'Missing required parameter: path'
			};
		}

		if (!params.diff) {
			return {
				success: false,
				error: 'Missing required parameter: diff'
			};
		}

		const fileUri = URI.joinPath(workspaceRoot, params.path);

		// Check if file exists
		const exists = await fileService.exists(fileUri);
		if (!exists) {
			return {
				success: false,
				error: `File does not exist: ${params.path}`
			};
		}

		// Read original content
		const fileContent = await fileService.readFile(fileUri);
		const originalContent = fileContent.value.toString();

		// Parse and apply diff blocks
		const diffBlocks = parseDiffBlocks(params.diff);

		if (diffBlocks.length === 0) {
			return {
				success: false,
				error: 'No valid SEARCH/REPLACE blocks found in diff. Expected format:\n<<<<<<< SEARCH\nold content\n=======\nnew content\n>>>>>>> REPLACE'
			};
		}

		const result = applyDiffBlocks(originalContent, diffBlocks);

		if (!result.success || !result.content) {
			return {
				success: false,
				error: result.error || 'Failed to apply diff',
				details: {
					blocksFound: diffBlocks.length
				}
			};
		}

		// Write the updated content
		const buffer = VSBuffer.fromString(result.content);
		await fileService.writeFile(fileUri, buffer, {
			unlock: false
		});

		return {
			success: true,
			message: `Successfully applied ${diffBlocks.length} diff block(s) to '${params.path}'`
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
