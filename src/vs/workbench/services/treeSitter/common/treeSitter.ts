/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../base/common/uri.js';

export const ITreeSitterService = createDecorator<ITreeSitterService>('treeSitterService');

/**
 * Code definition extracted from source code
 */
export interface ICodeDefinition {
	/**
	 * Name of the definition (class, function, method, etc.)
	 */
	name: string;
	/**
	 * Type of definition (class, function, method, interface, etc.)
	 */
	type: string;
	/**
	 * Start line number (1-based)
	 */
	startLine: number;
	/**
	 * End line number (1-based)
	 */
	endLine: number;
	/**
	 * The actual code text
	 */
	text: string;
}

/**
 * Result of parsing a file for code definitions
 */
export interface IParseResult {
	/**
	 * URI of the parsed file
	 */
	uri: URI;
	/**
	 * List of code definitions found
	 */
	definitions: ICodeDefinition[];
	/**
	 * Error message if parsing failed
	 */
	error?: string;
}

/**
 * Service for parsing source code using Tree-sitter
 */
export interface ITreeSitterService {
	readonly _serviceBrand: undefined;

	/**
	 * Parse a single file and extract code definitions
	 * @param uri URI of the file to parse
	 * @returns Parse result with definitions or error
	 */
	parseFile(uri: URI): Promise<IParseResult>;

	/**
	 * Parse multiple files and extract code definitions
	 * @param uris Array of file URIs to parse
	 * @returns Array of parse results
	 */
	parseFiles(uris: URI[]): Promise<IParseResult[]>;

	/**
	 * Check if a file type is supported
	 * @param uri URI of the file to check
	 * @returns true if the file type is supported
	 */
	isSupported(uri: URI): boolean;

	/**
	 * Get supported file extensions
	 * @returns Array of supported file extensions (e.g., ['.java', '.ts', '.py'])
	 */
	getSupportedExtensions(): string[];
}
