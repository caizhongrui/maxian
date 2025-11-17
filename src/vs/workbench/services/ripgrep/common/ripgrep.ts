/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IRipgrepService = createDecorator<IRipgrepService>('ripgrepService');

/**
 * Search result for a single file
 */
export interface ISearchFileResult {
	file: string;
	searchResults: ISearchResult[];
}

/**
 * A search result containing multiple lines
 */
export interface ISearchResult {
	lines: ISearchLineResult[];
}

/**
 * A single line in a search result
 */
export interface ISearchLineResult {
	line: number;
	text: string;
	isMatch: boolean;
	column?: number;
}

/**
 * File listing options
 */
export interface IListFilesOptions {
	/** Directory path to list files from */
	dirPath: string;
	/** Whether to recursively list files in subdirectories */
	recursive: boolean;
	/** Maximum number of files to return */
	limit: number;
	/** Cancellation token */
	token?: CancellationToken;
}

/**
 * File listing result
 */
export interface IListFilesResult {
	/** Array of file paths */
	files: string[];
	/** Whether the limit was reached */
	limitReached: boolean;
}

/**
 * Regex search options
 */
export interface IRegexSearchOptions {
	/** The current working directory (for relative path calculation) */
	cwd: string;
	/** The directory to search in */
	directoryPath: string;
	/** The regular expression to search for (Rust regex syntax) */
	regex: string;
	/** Optional glob pattern to filter files */
	filePattern?: string;
	/** Cancellation token */
	token?: CancellationToken;
}

/**
 * Ripgrep service for high-performance file operations
 */
export interface IRipgrepService {
	readonly _serviceBrand: undefined;

	/**
	 * List files in a directory
	 * @param options File listing options
	 * @returns Promise resolving to file listing result
	 */
	listFiles(options: IListFilesOptions): Promise<IListFilesResult>;

	/**
	 * Perform a regex search across files
	 * @param options Regex search options
	 * @returns Promise resolving to formatted search results
	 */
	regexSearch(options: IRegexSearchOptions): Promise<string>;

	/**
	 * Get the path to the ripgrep binary
	 * @returns Promise resolving to the ripgrep binary path
	 */
	getRipgrepPath(): Promise<string>;
}
