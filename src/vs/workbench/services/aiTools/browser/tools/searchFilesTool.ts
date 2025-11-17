/*---------------------------------------------------------------------------------------------
 *  Adapted from kilocode searchFilesTool.ts
 *  Original dependencies replaced with VS Code services
 *  Note: Simplified version - ripgrep integration would require additional setup
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';

export interface SearchFilesToolParams {
	path: string;
	regex: string;
	file_pattern?: string;
}

export interface SearchFilesToolResult {
	success: boolean;
	content?: string;
	error?: string;
}

/**
 * Simple regex search implementation
 * Note: The original kilocode version used ripgrep for better performance
 * This is a simplified version using basic file reading and regex matching
 */
async function searchInFile(
	fileService: IFileService,
	fileUri: URI,
	regex: RegExp
): Promise<string[]> {
	try {
		const content = await fileService.readFile(fileUri);
		const text = content.value.toString();
		const lines = text.split('\n');
		const matches: string[] = [];

		lines.forEach((line, index) => {
			if (regex.test(line)) {
				matches.push(`${index + 1}:${line}`);
			}
		});

		return matches;
	} catch (error) {
		return [];
	}
}

async function searchDirectory(
	fileService: IFileService,
	dirUri: URI,
	regex: RegExp,
	filePattern?: string,
	maxResults: number = 1000,
	currentResults: { count: number; results: Map<string, string[]> } = { count: 0, results: new Map() }
): Promise<Map<string, string[]>> {
	if (currentResults.count >= maxResults) {
		return currentResults.results;
	}

	try {
		const stat = await fileService.resolve(dirUri);
		if (!stat.children) {
			return currentResults.results;
		}

		for (const child of stat.children) {
			if (currentResults.count >= maxResults) {
				break;
			}

			const childUri = URI.joinPath(dirUri, child.name);

			if (child.isDirectory) {
				// Recursively search subdirectories
				await searchDirectory(fileService, childUri, regex, filePattern, maxResults, currentResults);
			} else {
				// Check if file matches the pattern (if provided)
				if (filePattern) {
					const pattern = new RegExp(filePattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
					if (!pattern.test(child.name)) {
						continue;
					}
				}

				// Search in file
				const matches = await searchInFile(fileService, childUri, regex);
				if (matches.length > 0) {
					currentResults.results.set(childUri.path, matches);
					currentResults.count++;
				}
			}
		}
	} catch (error) {
		// Silently ignore errors for individual files/directories
	}

	return currentResults.results;
}

export async function searchFilesTool(
	params: SearchFilesToolParams,
	fileService: IFileService,
	workspaceRoot: URI
): Promise<SearchFilesToolResult> {
	try {
		if (!params.path) {
			return {
				success: false,
				error: 'Missing required parameter: path'
			};
		}

		if (!params.regex) {
			return {
				success: false,
				error: 'Missing required parameter: regex'
			};
		}

		// Create regex pattern
		let regex: RegExp;
		try {
			regex = new RegExp(params.regex);
		} catch (error) {
			return {
				success: false,
				error: `Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`
			};
		}

		const searchPath = URI.joinPath(workspaceRoot, params.path);

		// Check if path exists
		const exists = await fileService.exists(searchPath);
		if (!exists) {
			return {
				success: false,
				error: `Path not found: ${params.path}`
			};
		}

		// Perform search
		const results = await searchDirectory(fileService, searchPath, regex, params.file_pattern);

		// Format results
		const formattedResults: string[] = [];
		for (const [filePath, matches] of results.entries()) {
			formattedResults.push(`\n${filePath}:`);
			formattedResults.push(...matches);
		}

		const content = formattedResults.length > 0
			? formattedResults.join('\n')
			: 'No matches found';

		return {
			success: true,
			content
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
