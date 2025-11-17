/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Parser } from '@vscode/tree-sitter-wasm';
import { ITextModel } from '../../../../editor/common/model.js';
import { QualityIssue, IssueSeverity, IssueCategory } from './analysisTypes.js';
import { IMultiLanguageService } from '../../multilang/browser/multilang.contribution.js';
import { ITreeSitterParserService } from '../../../../editor/common/services/treeSitterParserService.js';

/**
 * Naming convention rules for different languages
 */
interface NamingRules {
	readonly className: RegExp;
	readonly methodName: RegExp;
	readonly variableName: RegExp;
	readonly constantName: RegExp;
}

/**
 * Language-specific naming conventions
 */
const NAMING_CONVENTIONS: Record<string, NamingRules> = {
	'java': {
		className: /^[A-Z][a-zA-Z0-9]*$/,
		methodName: /^[a-z][a-zA-Z0-9]*$/,
		variableName: /^[a-z][a-zA-Z0-9]*$/,
		constantName: /^[A-Z][A-Z0-9_]*$/
	},
	'typescript': {
		className: /^[A-Z][a-zA-Z0-9]*$/,
		methodName: /^[a-z][a-zA-Z0-9]*$/,
		variableName: /^[a-z][a-zA-Z0-9]*$/,
		constantName: /^[A-Z][A-Z0-9_]*$/
	},
	'javascript': {
		className: /^[A-Z][a-zA-Z0-9]*$/,
		methodName: /^[a-z][a-zA-Z0-9]*$/,
		variableName: /^[a-z][a-zA-Z0-9]*$/,
		constantName: /^[A-Z][A-Z0-9_]*$/
	},
	'python': {
		className: /^[A-Z][a-zA-Z0-9]*$/,
		methodName: /^[a-z][a-z0-9_]*$/,
		variableName: /^[a-z][a-z0-9_]*$/,
		constantName: /^[A-Z][A-Z0-9_]*$/
	},
	'go': {
		className: /^[A-Z][a-zA-Z0-9]*$/,
		methodName: /^[A-Z][a-zA-Z0-9]*$/,  // Go uses PascalCase for exported
		variableName: /^[a-z][a-zA-Z0-9]*$/,
		constantName: /^[A-Z][a-zA-Z0-9]*$/
	},
	'rust': {
		className: /^[A-Z][a-zA-Z0-9]*$/,
		methodName: /^[a-z][a-z0-9_]*$/,
		variableName: /^[a-z][a-z0-9_]*$/,
		constantName: /^[A-Z][A-Z0-9_]*$/
	}
};

/**
 * Code quality analyzer with Tree-sitter support
 * Detects:
 * - Naming convention violations
 * - Magic numbers
 * - Duplicate code
 * - Code smells
 */
export class QualityAnalyzer {

	constructor(
		private readonly multiLanguageService: IMultiLanguageService,
		private readonly treeSitterService?: ITreeSitterParserService
	) { }

	/**
	 * Analyze code quality for a given model
	 */
	async analyze(model: ITextModel, filePath: string): Promise<QualityIssue[]> {
		const issues: QualityIssue[] = [];

		// Get language adapter
		const languageId = model.getLanguageId();
		const adapter = this.multiLanguageService.getAdapter(languageId);

		if (!adapter) {
			console.warn(`[Quality Analyzer] No adapter found for language: ${languageId}`);
			return issues;
		}

		// Get the code content
		const content = model.getValue();

		// Try to use Tree-sitter first
		let ast: any = { classes: [], methods: [], variables: [] };
		if (this.treeSitterService) {
			const parseResult = this.treeSitterService.getParseResult(model);
			if (parseResult?.tree) {
				ast = this.extractFromTreeSitter(parseResult.tree, languageId);
			}
		}

		// Run all checks
		issues.push(...this.checkNamingConventions(ast, model, filePath, languageId));
		issues.push(...this.detectMagicNumbers(content, model, filePath));
		issues.push(...this.findDuplicateCode(content, model, filePath));
		issues.push(...this.checkCodeSmells(ast, content, model, filePath, languageId));

		console.log(`[Quality Analyzer] Found ${issues.length} quality issues in ${filePath} (${this.treeSitterService ? 'Tree-sitter' : 'basic'})`);
		return issues;
	}

	/**
	 * Check naming convention violations
	 */
	private checkNamingConventions(
		ast: any,
		model: ITextModel,
		filePath: string,
		languageId: string
	): QualityIssue[] {
		const issues: QualityIssue[] = [];
		const rules = NAMING_CONVENTIONS[languageId];

		if (!rules) {
			return issues; // No rules defined for this language
		}

		// Extract classes, methods, variables from AST
		const elements = this.extractCodeElements(ast, languageId);

		// Check class names
		for (const cls of elements.classes) {
			if (!rules.className.test(cls.name)) {
				issues.push({
					category: IssueCategory.Quality,
					type: 'naming',
					severity: IssueSeverity.Warning,
					message: `Class name "${cls.name}" does not follow naming conventions (should be PascalCase)`,
					filePath,
					range: cls.range,
					suggestion: `Rename to ${this.toPascalCase(cls.name)}`
				});
			}
		}

		// Check method names
		for (const method of elements.methods) {
			if (!rules.methodName.test(method.name)) {
				const expectedCase = languageId === 'go' ? 'PascalCase (for exported) or camelCase' : 'camelCase';
				issues.push({
					category: IssueCategory.Quality,
					type: 'naming',
					severity: IssueSeverity.Warning,
					message: `Method name "${method.name}" does not follow naming conventions (should be ${expectedCase})`,
					filePath,
					range: method.range,
					suggestion: `Rename to ${this.toCamelCase(method.name)}`
				});
			}
		}

		// Check variable names
		for (const variable of elements.variables) {
			const isConstant = variable.isConstant || variable.name === variable.name.toUpperCase();

			if (isConstant && !rules.constantName.test(variable.name)) {
				issues.push({
					category: IssueCategory.Quality,
					type: 'naming',
					severity: IssueSeverity.Info,
					message: `Constant "${variable.name}" should use UPPER_SNAKE_CASE`,
					filePath,
					range: variable.range,
					suggestion: `Rename to ${this.toConstantCase(variable.name)}`
				});
			} else if (!isConstant && !rules.variableName.test(variable.name)) {
				issues.push({
					category: IssueCategory.Quality,
					type: 'naming',
					severity: IssueSeverity.Info,
					message: `Variable "${variable.name}" does not follow naming conventions`,
					filePath,
					range: variable.range,
					suggestion: `Rename to ${this.toCamelCase(variable.name)}`
				});
			}
		}

		return issues;
	}

	/**
	 * Detect magic numbers in code
	 */
	private detectMagicNumbers(
		content: string,
		model: ITextModel,
		filePath: string
	): QualityIssue[] {
		const issues: QualityIssue[] = [];

		// Allowed magic numbers (common constants)
		const allowed = new Set([0, 1, -1, 2, 10, 100, 1000]);

		// Regex to find numeric literals (not in strings or comments)
		const numberPattern = /\b(\d+\.?\d*)\b/g;
		const lines = content.split('\n');

		lines.forEach((line, lineIndex) => {
			// Skip comments and strings (simplified check)
			if (line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*')) {
				return;
			}

			let match;
			while ((match = numberPattern.exec(line)) !== null) {
				const num = parseFloat(match[1]);

				// Skip if allowed or looks like a version number
				if (allowed.has(num) || match[0].includes('.')) {
					continue;
				}

				// Check context - skip array indices, loop counters
				const before = line.substring(0, match.index).trim();
				if (before.endsWith('[') || before.endsWith('for') || before.includes('i <') || before.includes('i <=')) {
					continue;
				}

				issues.push({
					category: IssueCategory.Quality,
					type: 'magic-number',
					severity: IssueSeverity.Info,
					message: `Magic number ${match[1]} should be replaced with a named constant`,
					filePath,
					range: {
						startLineNumber: lineIndex + 1,
						startColumn: match.index + 1,
						endLineNumber: lineIndex + 1,
						endColumn: match.index + match[0].length + 1
					},
					suggestion: `const MEANINGFUL_NAME = ${match[1]};`
				});
			}
		});

		return issues;
	}

	/**
	 * Find duplicate code blocks
	 */
	private findDuplicateCode(
		content: string,
		model: ITextModel,
		filePath: string
	): QualityIssue[] {
		const issues: QualityIssue[] = [];
		const lines = content.split('\n');
		const minBlockSize = 5; // Minimum lines to consider as duplicate

		// Build a map of code blocks (hash -> line numbers)
		const blockMap = new Map<string, number[][]>();

		for (let i = 0; i <= lines.length - minBlockSize; i++) {
			const block = lines.slice(i, i + minBlockSize);
			const normalized = block.map(l => l.trim()).join('\n');

			// Skip empty or comment blocks
			if (normalized.length < 20 || normalized.startsWith('//') || normalized.startsWith('/*')) {
				continue;
			}

			const hash = this.simpleHash(normalized);
			const existing = blockMap.get(hash) || [];
			existing.push([i + 1, i + minBlockSize]);
			blockMap.set(hash, existing);
		}

		// Report duplicates
		blockMap.forEach((locations, hash) => {
			if (locations.length > 1) {
				const [startLine, endLine] = locations[0];
				issues.push({
					category: IssueCategory.Quality,
					type: 'duplicate',
					severity: IssueSeverity.Warning,
					message: `Duplicate code block found (${locations.length} occurrences)`,
					filePath,
					range: {
						startLineNumber: startLine,
						startColumn: 1,
						endLineNumber: endLine,
						endColumn: 1
					},
					suggestion: 'Consider extracting this code into a reusable function'
				});
			}
		});

		return issues;
	}

	/**
	 * Check for common code smells
	 */
	private checkCodeSmells(
		ast: any,
		content: string,
		model: ITextModel,
		filePath: string,
		languageId: string
	): QualityIssue[] {
		const issues: QualityIssue[] = [];

		// Extract methods
		const elements = this.extractCodeElements(ast, languageId);

		// Check for long methods (> 50 lines)
		for (const method of elements.methods) {
			if (method.range) {
				const length = method.range.endLineNumber - method.range.startLineNumber;
				if (length > 50) {
					issues.push({
						category: IssueCategory.Quality,
						type: 'code-smell',
						severity: IssueSeverity.Warning,
						message: `Method "${method.name}" is too long (${length} lines)`,
						filePath,
						range: method.range,
						suggestion: 'Consider breaking this method into smaller functions'
					});
				}
			}
		}

		// Check for too many parameters (> 5)
		for (const method of elements.methods) {
			if (method.parameters && method.parameters.length > 5) {
				issues.push({
					category: IssueCategory.Quality,
					type: 'code-smell',
					severity: IssueSeverity.Warning,
					message: `Method "${method.name}" has too many parameters (${method.parameters.length})`,
					filePath,
					range: method.range,
					suggestion: 'Consider using a parameter object or builder pattern'
				});
			}
		}

		// Check for deeply nested code (> 4 levels)
		const lines = content.split('\n');
		lines.forEach((line, idx) => {
			const indentLevel = this.getIndentLevel(line);
			if (indentLevel > 4) {
				issues.push({
					category: IssueCategory.Quality,
					type: 'code-smell',
					severity: IssueSeverity.Info,
					message: `Code is deeply nested (${indentLevel} levels)`,
					filePath,
					range: {
						startLineNumber: idx + 1,
						startColumn: 1,
						endLineNumber: idx + 1,
						endColumn: line.length + 1
					},
					suggestion: 'Consider refactoring to reduce nesting depth'
				});
			}
		});

		return issues;
	}

	/**
	 * Extract code elements from Tree-sitter AST
	 */
	private extractFromTreeSitter(tree: Parser.Tree, languageId: string): any {
		const classes: Array<{ name: string; range: any }> = [];
		const methods: Array<{ name: string; range: any; parameters: any[] }> = [];
		const variables: Array<{ name: string; range: any; isConstant: boolean }> = [];

		const root = tree.rootNode;

		// Language-specific node types
		const nodeTypes: Record<string, { class: string[]; method: string[]; variable: string[] }> = {
			'typescript': {
				class: ['class_declaration', 'interface_declaration'],
				method: ['method_definition', 'function_declaration', 'arrow_function'],
				variable: ['variable_declarator', 'lexical_declaration']
			},
			'javascript': {
				class: ['class_declaration'],
				method: ['method_definition', 'function_declaration', 'arrow_function'],
				variable: ['variable_declarator', 'lexical_declaration']
			},
			'python': {
				class: ['class_definition'],
				method: ['function_definition'],
				variable: ['assignment']
			},
			'java': {
				class: ['class_declaration', 'interface_declaration'],
				method: ['method_declaration', 'constructor_declaration'],
				variable: ['variable_declarator']
			},
			'go': {
				class: ['type_declaration'],
				method: ['function_declaration', 'method_declaration'],
				variable: ['var_declaration', 'const_declaration']
			},
			'rust': {
				class: ['struct_item', 'enum_item', 'trait_item'],
				method: ['function_item'],
				variable: ['let_declaration']
			}
		};

		const types = nodeTypes[languageId] || nodeTypes['typescript'];

		const traverse = (node: Parser.SyntaxNode) => {
			// Extract classes
			if (types.class.includes(node.type)) {
				const nameNode = node.childForFieldName('name');
				if (nameNode) {
					classes.push({
						name: nameNode.text,
						range: {
							startLineNumber: node.startPosition.row + 1,
							startColumn: node.startPosition.column + 1,
							endLineNumber: node.endPosition.row + 1,
							endColumn: node.endPosition.column + 1
						}
					});
				}
			}

			// Extract methods/functions
			if (types.method.includes(node.type)) {
				const nameNode = node.childForFieldName('name');
				const name = nameNode?.text || 'anonymous';

				// Extract parameters
				const paramsNode = node.childForFieldName('parameters');
				const parameters: any[] = [];
				if (paramsNode) {
					for (const param of paramsNode.children) {
						if (param.type.includes('parameter')) {
							const paramName = param.childForFieldName('name');
							if (paramName) {
								parameters.push({ name: paramName.text });
							}
						}
					}
				}

				methods.push({
					name,
					range: {
						startLineNumber: node.startPosition.row + 1,
						startColumn: node.startPosition.column + 1,
						endLineNumber: node.endPosition.row + 1,
						endColumn: node.endPosition.column + 1
					},
					parameters
				});
			}

			// Extract variables
			if (types.variable.includes(node.type)) {
				const nameNode = node.childForFieldName('name');
				if (nameNode) {
					// Check if it's a constant
					const isConstant = node.text.startsWith('const ') ||
						node.text.includes('final ') ||
						node.text === node.text.toUpperCase();

					variables.push({
						name: nameNode.text,
						range: {
							startLineNumber: node.startPosition.row + 1,
							startColumn: node.startPosition.column + 1,
							endLineNumber: node.endPosition.row + 1,
							endColumn: node.endPosition.column + 1
						},
						isConstant
					});
				}
			}

			// Traverse children
			for (const child of node.children) {
				traverse(child);
			}
		};

		traverse(root);

		return { classes, methods, variables };
	}

	/**
	 * Extract code elements from AST
	 */
	private extractCodeElements(ast: any, languageId: string): {
		classes: Array<{ name: string; range?: any }>;
		methods: Array<{ name: string; range?: any; parameters?: any[] }>;
		variables: Array<{ name: string; range?: any; isConstant?: boolean }>;
	} {
		// This is a simplified extraction - in production, use proper AST traversal
		// For now, return mock data structure
		return {
			classes: ast.classes || [],
			methods: ast.methods || [],
			variables: ast.variables || []
		};
	}

	// Helper methods for naming conventions
	private toPascalCase(str: string): string {
		return str.charAt(0).toUpperCase() + str.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
	}

	private toCamelCase(str: string): string {
		return str.charAt(0).toLowerCase() + str.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
	}

	private toConstantCase(str: string): string {
		return str.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
	}

	private simpleHash(str: string): string {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return hash.toString(36);
	}

	private getIndentLevel(line: string): number {
		const match = line.match(/^(\s*)/);
		if (!match) {
			return 0;
		}
		const indent = match[1];
		// Assume 4 spaces or 1 tab = 1 level
		return Math.floor((indent.replace(/\t/g, '    ').length) / 4);
	}
}
