/*---------------------------------------------------------------------------------------------
 *  Adapted from kilocode listFilesTool.ts
 *  Original dependencies replaced with VS Code services
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';

export interface ListFilesToolParams {
	path: string;
	recursive?: boolean | string;
}

export interface ListFilesToolResult {
	success: boolean;
	content?: string;
	error?: string;
	didHitLimit?: boolean;
}

async function listFilesRecursive(
	fileService: IFileService,
	uri: URI,
	maxFiles: number,
	currentCount: { value: number }
): Promise<string[]> {
	const results: string[] = [];

	try {
		const stat = await fileService.resolve(uri);
		if (!stat.children) {
			return results;
		}

		for (const child of stat.children) {
			if (currentCount.value >= maxFiles) {
				break;
			}

			const relativeName = child.name;

			if (child.isDirectory) {
				results.push(`${relativeName}/`);
				currentCount.value++;

				// Recursively list directory contents
				const childUri = URI.joinPath(uri, child.name);
				const childResults = await listFilesRecursive(fileService, childUri, maxFiles, currentCount);
				childResults.forEach(item => {
					results.push(`${relativeName}/${item}`);
				});
			} else {
				results.push(relativeName);
				currentCount.value++;
			}
		}
	} catch (error) {
		// Silently ignore errors for individual directories
	}

	return results;
}

export async function listFilesTool(
	params: ListFilesToolParams,
	fileService: IFileService,
	workspaceRoot: URI
): Promise<ListFilesToolResult> {
	try {
		if (!params.path) {
			return {
				success: false,
				error: 'Missing required parameter: path'
			};
		}

		const recursive = typeof params.recursive === 'boolean'
			? params.recursive
			: params.recursive?.toLowerCase() === 'true';

		const dirUri = URI.joinPath(workspaceRoot, params.path);

		// Check if directory exists
		const exists = await fileService.exists(dirUri);
		if (!exists) {
			return {
				success: false,
				error: `Directory not found: ${params.path}`
			};
		}

		// Check if it's a directory
		const statResult = await fileService.resolve(dirUri);
		if (!statResult.isDirectory) {
			return {
				success: false,
				error: `Path is not a directory: ${params.path}`
			};
		}

		const maxFiles = 200;
		let files: string[] = [];
		let didHitLimit = false;

		if (recursive) {
			const currentCount = { value: 0 };
			files = await listFilesRecursive(fileService, dirUri, maxFiles, currentCount);
			didHitLimit = currentCount.value >= maxFiles;
		} else {
			// List only top-level files
			const resolved = await fileService.resolve(dirUri);
			if (resolved.children) {
				files = resolved.children.map(child =>
					child.isDirectory ? `${child.name}/` : child.name
				).slice(0, maxFiles);
				didHitLimit = resolved.children.length > maxFiles;
			}
		}

		// Format output
		let content = files.join('\n');
		if (didHitLimit) {
			content += `\n\n(Results truncated - showing first ${maxFiles} items)`;
		}

		return {
			success: true,
			content,
			didHitLimit
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
