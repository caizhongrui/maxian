/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Codebase Search Tool - Semantic search through indexed codebase
 */

export interface VectorStoreSearchResult {
	score: number;
	payload: {
		filePath: string;
		startLine: number;
		endLine: number;
		codeChunk: string;
	};
}

export interface CodebaseSearchParams {
	query: string;
	path?: string;
}

export interface CodebaseSearchResult {
	query: string;
	results: Array<{
		filePath: string;
		score: number;
		startLine: number;
		endLine: number;
		codeChunk: string;
	}>;
}

export interface CodeIndexStatus {
	systemStatus: 'Standby' | 'Indexing' | 'Indexed' | 'Error';
	message?: string;
	processedItems?: number;
	totalItems?: number;
	currentItemUnit?: string;
}

export function formatCodebaseSearchResults(
	query: string,
	searchResults: VectorStoreSearchResult[],
	workspacePath: string
): CodebaseSearchResult {
	const result: CodebaseSearchResult = {
		query,
		results: [],
	};

	searchResults.forEach((result_item) => {
		if (!result_item.payload) {
			return;
		}

		const relativePath = getRelativePath(result_item.payload.filePath, workspacePath);

		result.results.push({
			filePath: relativePath,
			score: result_item.score,
			startLine: result_item.payload.startLine,
			endLine: result_item.payload.endLine,
			codeChunk: result_item.payload.codeChunk.trim(),
		});
	});

	return result;
}

export function formatCodebaseSearchOutput(result: CodebaseSearchResult): string {
	if (result.results.length === 0) {
		return `No relevant code snippets found for the query: "${result.query}"`;
	}

	return `Query: ${result.query}
Results:

${result.results
		.map(
			(item) => `File path: ${item.filePath}
Score: ${item.score}
Lines: ${item.startLine}-${item.endLine}
Code Chunk: ${item.codeChunk}
`
		)
		.join('\n')}`;
}

function getRelativePath(filePath: string, workspacePath: string): string {
	// Simple relative path calculation
	if (filePath.startsWith(workspacePath)) {
		return filePath.substring(workspacePath.length + 1);
	}
	return filePath;
}

export function getIndexStatusMessage(status: CodeIndexStatus): string {
	const defaultStatusMessage = (() => {
		switch (status.systemStatus) {
			case 'Indexing':
				return 'Code indexing is still running';
			case 'Standby':
				return 'Code indexing has not started';
			case 'Error':
				return 'Code indexing is in an error state';
			default:
				return 'Code indexing is not ready';
		}
	})();

	const normalizedMessage =
		status.message && status.message.trim() !== '' ? status.message.trim() : defaultStatusMessage;
	const unit =
		status.currentItemUnit && status.currentItemUnit.trim() !== '' ? status.currentItemUnit : 'items';
	const totalItems = status.totalItems ?? 0;
	const processedItems = status.processedItems ?? 0;
	const progress = totalItems > 0 ? `${processedItems}/${totalItems} ${unit}` : undefined;
	const messageWithoutTrailingPeriod = normalizedMessage.endsWith('.')
		? normalizedMessage.slice(0, -1)
		: normalizedMessage;
	const friendlyMessage = progress
		? `${messageWithoutTrailingPeriod} (Progress: ${progress}).`
		: `${messageWithoutTrailingPeriod}.`;

	return `${friendlyMessage} Semantic search is unavailable until indexing completes. Please try again later.`;
}
