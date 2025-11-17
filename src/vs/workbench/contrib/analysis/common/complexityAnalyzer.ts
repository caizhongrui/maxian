/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Parser } from '@vscode/tree-sitter-wasm';
import { ITextModel } from '../../../../editor/common/model.js';
import { ComplexityIssue, ComplexityMetrics, IssueSeverity, IssueCategory } from './analysisTypes.js';
import { IMultiLanguageService } from '../../multilang/browser/multilang.contribution.js';
import { ITreeSitterParserService } from '../../../../editor/common/services/treeSitterParserService.js';

/**
 * Code complexity analyzer with Tree-sitter support
 * Calculates:
 * - Cyclomatic complexity (McCabe)
 * - Lines of code
 * - Maintainability index
 */
export class ComplexityAnalyzer {

	constructor(
		private readonly multiLanguageService: IMultiLanguageService,
		private readonly treeSitterService?: ITreeSitterParserService
	) { }

	/**
	 * Analyze code complexity for a given model
	 */
	async analyze(model: ITextModel, filePath: string): Promise<ComplexityIssue[]> {
		const issues: ComplexityIssue[] = [];
		const languageId = model.getLanguageId();
		const adapter = this.multiLanguageService.getAdapter(languageId);

		if (!adapter) {
			console.warn(`[Complexity Analyzer] No adapter found for language: ${languageId}`);
			return issues;
		}

		const content = model.getValue();

		// Try to use Tree-sitter first
		if (this.treeSitterService) {
			const parseResult = this.treeSitterService.getParseResult(model);
			if (parseResult?.tree) {
				return this.analyzeWithTreeSitter(parseResult.tree, content, filePath, languageId);
			}
		}

		// Fallback to regex-based extraction
		return this.analyzeWithRegex(content, filePath, languageId);
	}

	/**
	 * Analyze with Tree-sitter AST
	 */
	private analyzeWithTreeSitter(tree: Parser.Tree, content: string, filePath: string, languageId: string): ComplexityIssue[] {
		const issues: ComplexityIssue[] = [];
		const methods = this.extractMethodsFromTree(tree, languageId);

		for (const method of methods) {
			const metrics = this.calculateComplexityForMethod(method, content);

			// Report if complexity is high
			if (metrics.cyclomaticComplexity > 10) {
				const severity = metrics.cyclomaticComplexity > 20
					? IssueSeverity.Error
					: metrics.cyclomaticComplexity > 15
						? IssueSeverity.Warning
						: IssueSeverity.Info;

				issues.push({
					category: IssueCategory.Complexity,
					severity,
					message: `Method "${method.name}" has high cyclomatic complexity (${metrics.cyclomaticComplexity})`,
					filePath,
					range: method.range,
					metrics,
					suggestion: this.getSuggestion(metrics)
				});
			}
		}

		console.log(`[Complexity Analyzer] Found ${issues.length} complexity issues in ${filePath} (Tree-sitter)`);
		return issues;
	}

	/**
	 * Extract methods from Tree-sitter AST
	 */
	private extractMethodsFromTree(tree: Parser.Tree, languageId: string): Array<{ name: string; range: any; source: string }> {
		const methods: Array<{ name: string; range: any; source: string }> = [];
		const root = tree.rootNode;

		// Language-specific node types for functions/methods
		const functionNodeTypes: Record<string, string[]> = {
			'typescript': ['function_declaration', 'method_definition', 'arrow_function', 'function_expression'],
			'javascript': ['function_declaration', 'method_definition', 'arrow_function', 'function_expression'],
			'python': ['function_definition', 'async_function_definition'],
			'java': ['method_declaration', 'constructor_declaration'],
			'go': ['function_declaration', 'method_declaration'],
			'rust': ['function_item', 'method_item']
		};

		const targetTypes = functionNodeTypes[languageId] || functionNodeTypes['typescript'];

		const traverse = (node: Parser.SyntaxNode) => {
			if (targetTypes.includes(node.type)) {
				const nameNode = node.childForFieldName('name');
				const name = nameNode?.text || 'anonymous';

				methods.push({
					name,
					range: {
						startLineNumber: node.startPosition.row + 1,
						startColumn: node.startPosition.column + 1,
						endLineNumber: node.endPosition.row + 1,
						endColumn: node.endPosition.column + 1
					},
					source: node.text
				});
			}

			for (const child of node.children) {
				traverse(child);
			}
		};

		traverse(root);
		return methods;
	}

	/**
	 * Analyze with regex fallback
	 */
	private analyzeWithRegex(content: string, filePath: string, languageId: string): ComplexityIssue[] {
		const issues: ComplexityIssue[] = [];
		const methods = this.extractMethodsWithRegex(content, languageId);

		for (const method of methods) {
			const metrics = this.calculateComplexityForMethod(method, content);

			// Report if complexity is high
			if (metrics.cyclomaticComplexity > 10) {
				const severity = metrics.cyclomaticComplexity > 20
					? IssueSeverity.Error
					: metrics.cyclomaticComplexity > 15
						? IssueSeverity.Warning
						: IssueSeverity.Info;

				issues.push({
					category: IssueCategory.Complexity,
					severity,
					message: `Function "${method.name}" has high cyclomatic complexity (${metrics.cyclomaticComplexity})`,
					filePath,
					range: method.range,
					metrics,
					suggestion: this.getSuggestion(metrics)
				});
			}
		}

		console.log(`[Complexity Analyzer] Found ${issues.length} complexity issues in ${filePath} (regex)`);
		return issues;
	}

	/**
	 * Extract methods using regex patterns
	 */
	private extractMethodsWithRegex(content: string, languageId: string): Array<{ name: string; range: any; source: string }> {
		const methods: Array<{ name: string; range: any; source: string }> = [];
		const lines = content.split('\n');

		// Language-specific function patterns
		const patterns: Record<string, RegExp[]> = {
			'typescript': [
				/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
				/^\s*(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*{/,
				/^\s*(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/
			],
			'javascript': [
				/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
				/^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*{/,
				/^\s*(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/
			],
			'python': [
				/^\s*(?:async\s+)?def\s+(\w+)\s*\(/
			],
			'java': [
				/^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)?(\w+)\s*\([^)]*\)\s*{/
			]
		};

		const langPatterns = patterns[languageId] || patterns['typescript'];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			for (const pattern of langPatterns) {
				const match = line.match(pattern);
				if (match) {
					const name = match[1];
					const startLine = i + 1;

					// Find the end of the function (simple brace counting)
					let braceCount = 0;
					let endLine = startLine;
					let foundStart = false;

					for (let j = i; j < lines.length; j++) {
						const currentLine = lines[j];
						for (const char of currentLine) {
							if (char === '{') {
								braceCount++;
								foundStart = true;
							} else if (char === '}') {
								braceCount--;
								if (foundStart && braceCount === 0) {
									endLine = j + 1;
									break;
								}
							}
						}
						if (foundStart && braceCount === 0) {
							break;
						}
					}

					const source = lines.slice(i, endLine).join('\n');

					methods.push({
						name,
						range: {
							startLineNumber: startLine,
							startColumn: 1,
							endLineNumber: endLine,
							endColumn: lines[endLine - 1]?.length || 1
						},
						source
					});

					break;
				}
			}
		}

		return methods;
	}

	/**
	 * Calculate cyclomatic complexity for a method
	 * Based on McCabe's algorithm: E - N + 2P
	 * Simplified: count decision points + 1
	 */
	private calculateComplexityForMethod(method: { name: string; source: string }, content: string): ComplexityMetrics {
		const methodSource = method.source;
		const lines = methodSource.split('\n');

		// Count lines of code (excluding comments and blanks)
		const linesOfCode = lines.filter(line => {
			const trimmed = line.trim();
			return trimmed.length > 0 &&
				!trimmed.startsWith('//') &&
				!trimmed.startsWith('/*') &&
				!trimmed.startsWith('*');
		}).length;

		// Calculate cyclomatic complexity
		// Count decision points: if, else if, for, while, case, catch, &&, ||, ?
		let complexity = 1; // Base complexity

		const decisionPatterns = [
			/\bif\s*\(/g,           // if statements
			/\belse\s+if\s*\(/g,    // else if
			/\bfor\s*\(/g,          // for loops
			/\bwhile\s*\(/g,        // while loops
			/\bcase\s+/g,           // switch cases
			/\bcatch\s*\(/g,        // catch blocks
			/\?\s*[^:]+:/g,         // ternary operators
			/&&/g,                  // logical AND
			/\|\|/g                 // logical OR
		];

		for (const pattern of decisionPatterns) {
			const matches = methodSource.match(pattern);
			if (matches) {
				complexity += matches.length;
			}
		}

		// Calculate maintainability index (simplified)
		// MI = 171 - 5.2 * ln(HV) - 0.23 * CC - 16.2 * ln(LOC)
		// Simplified version based on LOC and CC
		const maintainabilityIndex = Math.max(0, Math.min(100,
			171 - (5.2 * Math.log(linesOfCode + 1)) - (0.23 * complexity) - (16.2 * Math.log(linesOfCode + 1))
		));

		return {
			cyclomaticComplexity: complexity,
			linesOfCode,
			maintainabilityIndex: Math.round(maintainabilityIndex)
		};
	}

	/**
	 * Get suggestion based on complexity metrics
	 */
	private getSuggestion(metrics: ComplexityMetrics): string {
		const suggestions: string[] = [];

		if (metrics.cyclomaticComplexity > 20) {
			suggestions.push('Critical: Break down into smaller methods');
		} else if (metrics.cyclomaticComplexity > 15) {
			suggestions.push('Consider refactoring into smaller methods');
		} else {
			suggestions.push('Simplify conditional logic if possible');
		}

		if (metrics.linesOfCode > 50) {
			suggestions.push('Method is too long, consider splitting it');
		}

		if (metrics.maintainabilityIndex && metrics.maintainabilityIndex < 20) {
			suggestions.push('Low maintainability - requires significant refactoring');
		} else if (metrics.maintainabilityIndex && metrics.maintainabilityIndex < 40) {
			suggestions.push('Consider improving code structure and reducing complexity');
		}

		return suggestions.join('; ');
	}
}
