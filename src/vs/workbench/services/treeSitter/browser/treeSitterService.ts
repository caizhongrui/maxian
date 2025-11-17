/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITreeSitterService, ICodeDefinition, IParseResult } from '../common/treeSitter.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { extname } from '../../../../base/common/resources.js';
// import { FileAccess } from '../../../../base/common/network.js'; // Unused
import * as TreeSitter from 'web-tree-sitter';

/**
 * Language parser configuration
 */
interface ILanguageParser {
	parser: TreeSitter.Parser;
	query: TreeSitter.Query;
	language: TreeSitter.Language;
}

/**
 * Tree-sitter service implementation for parsing source code
 */
export class TreeSitterService extends Disposable implements ITreeSitterService {

	declare readonly _serviceBrand: undefined;

	private readonly _parsers = new Map<string, ILanguageParser>();
	private _initialized = false;

	// Supported file extensions
	private readonly _supportedExtensions = [
		'.java',
		'.ts',
		'.tsx',
		'.js',
		'.jsx',
		'.py',
	];

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		// Initialize asynchronously
		this._initialize().catch(error => {
			this.logService.error('[TreeSitter] Initialization failed:', error);
		});
	}

	/**
	 * Initialize Tree-sitter and load language grammars
	 */
	private async _initialize(): Promise<void> {
		if (this._initialized) {
			return;
		}

		try {
			await TreeSitter.Parser.init();
			this._initialized = true;
			this.logService.info('[TreeSitter] Service initialized successfully');
		} catch (error) {
			this.logService.error('[TreeSitter] Failed to initialize:', error);
			throw error;
		}
	}

	/**
	 * Load language parser for a specific file extension
	 */
	private async _loadParser(ext: string): Promise<ILanguageParser | undefined> {
		// Check if already loaded
		if (this._parsers.has(ext)) {
			return this._parsers.get(ext);
		}

		// Ensure initialized
		await this._initialize();

		try {
			let languageName: string;
			let queryString: string;

			// Map extension to language name and query
			switch (ext) {
				case '.java':
					languageName = 'java';
					queryString = this._getJavaQuery();
					break;
				case '.ts':
					languageName = 'typescript';
					queryString = this._getTypeScriptQuery();
					break;
				case '.tsx':
					languageName = 'tsx';
					queryString = this._getTsxQuery();
					break;
				case '.js':
				case '.jsx':
					languageName = 'javascript';
					queryString = this._getJavaScriptQuery();
					break;
				case '.py':
					languageName = 'python';
					queryString = this._getPythonQuery();
					break;
				default:
					this.logService.warn(`[TreeSitter] Unsupported extension: ${ext}`);
					return undefined;
			}

			// Load WASM grammar - get the correct path for the WASM file
			const wasmPath = `node_modules/tree-sitter-${languageName}/tree-sitter-${languageName}.wasm`;
			const language = await TreeSitter.Language.load(wasmPath);
			const parser = new TreeSitter.Parser();
			parser.setLanguage(language);
			const query = new TreeSitter.Query(language, queryString);

			const languageParser: ILanguageParser = { parser, query, language };
			this._parsers.set(ext, languageParser);

			this.logService.info(`[TreeSitter] Loaded parser for ${ext}`);
			return languageParser;

		} catch (error) {
			this.logService.error(`[TreeSitter] Failed to load parser for ${ext}:`, error);
			return undefined;
		}
	}

	/**
	 * Parse a single file and extract code definitions
	 */
	async parseFile(uri: URI): Promise<IParseResult> {
		const ext = extname(uri);

		// Check if supported
		if (!this.isSupported(uri)) {
			return {
				uri,
				definitions: [],
				error: `Unsupported file extension: ${ext}`
			};
		}

		try {
			// Read file content
			const content = await this.fileService.readFile(uri);
			const text = content.value.toString();

			// Load parser
			const languageParser = await this._loadParser(ext);
			if (!languageParser) {
				return {
					uri,
					definitions: [],
					error: `Failed to load parser for ${ext}`
				};
			}

			// Parse the file
			const tree = languageParser.parser.parse(text);
			if (!tree) {
				return {
					uri,
					definitions: [],
					error: 'Failed to parse file'
				};
			}

			// Extract definitions using query
			const captures = languageParser.query.captures(tree.rootNode);
			const lines = text.split('\n');
			const definitions = this._processCaptures(captures, lines, ext);

			this.logService.info(`[TreeSitter] Parsed ${uri.toString()}: found ${definitions.length} definitions`);

			return {
				uri,
				definitions
			};

		} catch (error) {
			this.logService.error(`[TreeSitter] Error parsing file ${uri.toString()}:`, error);
			return {
				uri,
				definitions: [],
				error: error instanceof Error ? error.message : 'Unknown error'
			};
		}
	}

	/**
	 * Parse multiple files
	 */
	async parseFiles(uris: URI[]): Promise<IParseResult[]> {
		return Promise.all(uris.map(uri => this.parseFile(uri)));
	}

	/**
	 * Check if a file is supported
	 */
	isSupported(uri: URI): boolean {
		const ext = extname(uri);
		return this._supportedExtensions.includes(ext);
	}

	/**
	 * Get supported extensions
	 */
	getSupportedExtensions(): string[] {
		return [...this._supportedExtensions];
	}

	/**
	 * Process Tree-sitter captures into code definitions
	 */
	private _processCaptures(
		captures: TreeSitter.QueryCapture[],
		lines: string[],
		ext: string
	): ICodeDefinition[] {
		const definitions: ICodeDefinition[] = [];
		const processed = new Set<string>();

		// Sort by position
		captures.sort((a, b) => a.node.startPosition.row - b.node.startPosition.row);

		for (const capture of captures) {
			const { node, name } = capture;

			// Only process definition captures
			if (!name.includes('definition')) {
				continue;
			}

			// Get the parent node that contains the full definition
			const definitionNode = name.includes('name') ? node.parent : node;
			if (!definitionNode) {
				continue;
			}

			const startLine = definitionNode.startPosition.row;
			const endLine = definitionNode.endPosition.row;
			const lineCount = endLine - startLine + 1;

			// Skip small definitions (less than 4 lines) unless it's a method signature
			const isMethodSignature = name.includes('definition.method.start');
			if (lineCount < 4 && !isMethodSignature) {
				continue;
			}

			// Create unique key
			const key = `${startLine}-${endLine}`;
			if (processed.has(key)) {
				continue;
			}
			processed.add(key);

			// Extract definition type
			let type = 'unknown';
			if (name.includes('class')) {
				type = 'class';
			} else if (name.includes('interface')) {
				type = 'interface';
			} else if (name.includes('function')) {
				type = 'function';
			} else if (name.includes('method')) {
				type = 'method';
			} else if (name.includes('enum')) {
				type = 'enum';
			}

			// Get the code text
			const text = lines[startLine] || '';

			definitions.push({
				name: node.text || text.trim(),
				type,
				startLine: startLine + 1, // Convert to 1-based
				endLine: endLine + 1,     // Convert to 1-based
				text
			});
		}

		return definitions;
	}

	/**
	 * Get Java query string
	 */
	private _getJavaQuery(): string {
		return `
; Class declarations
(class_declaration
  name: (identifier) @name.definition.class) @definition.class

; Interface declarations
(interface_declaration
  name: (identifier) @name.definition.interface) @definition.interface

; Enum declarations
(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum

; Method declarations
(method_declaration
  type: (_) @definition.method.start
  name: (identifier) @name.definition.method) @definition.method

; Constructor declarations
(constructor_declaration
  name: (identifier) @name.definition.constructor) @definition.constructor
`;
	}

	/**
	 * Get TypeScript query string
	 */
	private _getTypeScriptQuery(): string {
		return `
; Function declarations
(function_declaration
  name: (identifier) @name.definition.function) @definition.function

; Class declarations
(class_declaration
  name: (type_identifier) @name.definition.class) @definition.class

; Interface declarations
(interface_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

; Method definitions
(method_definition
  name: (property_identifier) @name.definition.method) @definition.method

; Type alias declarations
(type_alias_declaration
  name: (type_identifier) @name.definition.type) @definition.type

; Enum declarations
(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum
`;
	}

	/**
	 * Get TSX query string (extends TypeScript)
	 */
	private _getTsxQuery(): string {
		// TSX uses similar queries to TypeScript
		return this._getTypeScriptQuery();
	}

	/**
	 * Get JavaScript query string
	 */
	private _getJavaScriptQuery(): string {
		return `
; Function declarations
(function_declaration
  name: (identifier) @name.definition.function) @definition.function

; Class declarations
(class_declaration
  name: (identifier) @name.definition.class) @definition.class

; Method definitions
(method_definition
  name: (property_identifier) @name.definition.method) @definition.method
`;
	}

	/**
	 * Get Python query string
	 */
	private _getPythonQuery(): string {
		return `
; Class definitions
(class_definition
  name: (identifier) @name.definition.class) @definition.class

; Function definitions
(function_definition
  name: (identifier) @name.definition.function) @definition.function

; Decorated class definitions
(decorated_definition
  definition: (class_definition
    name: (identifier) @name.definition.class)) @definition.class

; Decorated function definitions
(decorated_definition
  definition: (function_definition
    name: (identifier) @name.definition.function)) @definition.function
`;
	}

	override dispose(): void {
		this._parsers.clear();
		super.dispose();
	}
}
