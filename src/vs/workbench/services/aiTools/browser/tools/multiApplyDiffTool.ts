/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Multi-File Apply Diff Tool - Applies diffs to multiple files in a batch
 */

export interface DiffOperation {
	path: string;
	diff: Array<{
		content: string;
		startLine?: number;
	}>;
}

export type OperationStatus = 'pending' | 'approved' | 'denied' | 'blocked' | 'error';

export interface OperationResult {
	path: string;
	status: OperationStatus;
	error?: string;
	result?: string;
	diffItems?: Array<{ content: string; startLine?: number }>;
	absolutePath?: string;
	fileExists?: boolean;
}

export interface ParsedDiff {
	content: string;
	start_line?: string;
}

export interface ParsedFile {
	path: string;
	diff: ParsedDiff | ParsedDiff[];
}

export interface ParsedXmlResult {
	file: ParsedFile | ParsedFile[];
}

/**
 * Parse diff operations from XML args
 */
export function parseDiffOperationsFromXml(argsXmlTag: string): Map<string, DiffOperation> {
	const operationsMap = new Map<string, DiffOperation>();

	// This is a placeholder - real implementation would use XML parser
	// For now, return empty map
	return operationsMap;
}

/**
 * Create batch diff data for approval
 */
export function createBatchDiffData(operations: OperationResult[]): Array<{
	path: string;
	changeCount: number;
	key: string;
	content: string;
	diffs?: Array<{ content: string; startLine?: number }>;
}> {
	return operations.map((opResult) => {
		const changeCount = opResult.diffItems?.length || 0;
		const changeText = changeCount === 1 ? '1 change' : `${changeCount} changes`;

		return {
			path: opResult.path,
			changeCount,
			key: `${opResult.path} (${changeText})`,
			content: opResult.path,
			diffs: opResult.diffItems?.map((item) => ({
				content: item.content,
				startLine: item.startLine,
			})),
		};
	});
}

/**
 * Process batch approval response
 */
export function processBatchApprovalResponse(
	response: string,
	text: string | undefined,
	operationsToApprove: OperationResult[],
	updateOperationResult: (path: string, updates: Partial<OperationResult>) => void
): { hasAnyDenial: boolean } {
	let hasAnyDenial = false;

	if (response === 'yesButtonClicked') {
		// Approve all files
		operationsToApprove.forEach((opResult) => {
			updateOperationResult(opResult.path, { status: 'approved' });
		});
	} else if (response === 'noButtonClicked') {
		// Deny all files
		hasAnyDenial = true;
		operationsToApprove.forEach((opResult) => {
			updateOperationResult(opResult.path, {
				status: 'denied',
				result: `Changes to ${opResult.path} were not approved by user`,
			});
		});
	} else {
		// Handle individual permissions from objectResponse
		try {
			const parsedResponse = JSON.parse(text || '{}');

			if (parsedResponse.action === 'applyDiff' && parsedResponse.approvedFiles) {
				const approvedFiles = parsedResponse.approvedFiles;

				operationsToApprove.forEach((opResult) => {
					const approved = approvedFiles[opResult.path] === true;

					if (approved) {
						updateOperationResult(opResult.path, { status: 'approved' });
					} else {
						hasAnyDenial = true;
						updateOperationResult(opResult.path, {
							status: 'denied',
							result: `Changes to ${opResult.path} were not approved by user`,
						});
					}
				});
			}
		} catch (error) {
			// Fallback: if JSON parsing fails, deny all files
			hasAnyDenial = true;
			operationsToApprove.forEach((opResult) => {
				updateOperationResult(opResult.path, {
					status: 'denied',
					result: `Changes to ${opResult.path} were not approved by user`,
				});
			});
		}
	}

	return { hasAnyDenial };
}

/**
 * Check for single SEARCH/REPLACE block warning
 */
export function checkForSingleBlockWarning(operations: DiffOperation[]): string {
	let totalSearchBlocks = 0;
	for (const operation of operations) {
		for (const diffItem of operation.diff) {
			const searchBlocks = (diffItem.content.match(/<<<<<<< SEARCH/g) || []).length;
			totalSearchBlocks += searchBlocks;
		}
	}

	return totalSearchBlocks === 1
		? '\n<notice>Making multiple related changes in a single apply_diff is more efficient. If other changes are needed in this file, please include them as additional SEARCH/REPLACE blocks.</notice>'
		: '';
}
