/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextModel } from '../../../../editor/common/model.js';
import { TechnicalDebtIssue, IssueSeverity, IssueCategory } from './analysisTypes.js';

/**
 * Technical debt analyzer
 * Detects:
 * - TODO/FIXME comments
 * - Deprecated API usage
 * - Temporary hacks
 * - Outdated dependencies
 */
export class TechnicalDebtAnalyzer {

	/**
	 * Analyze technical debt for a given model
	 */
	async analyze(model: ITextModel, filePath: string): Promise<TechnicalDebtIssue[]> {
		const issues: TechnicalDebtIssue[] = [];
		const content = model.getValue();

		// Run all technical debt checks
		issues.push(...this.findTodoComments(content, filePath));
		issues.push(...this.findDeprecatedUsage(content, filePath));
		issues.push(...this.findHacks(content, filePath));
		issues.push(...this.findOutdatedPatterns(content, filePath, model.getLanguageId()));

		console.log(`[Technical Debt Analyzer] Found ${issues.length} technical debt items in ${filePath}`);
		return issues;
	}

	/**
	 * Find TODO/FIXME comments
	 */
	private findTodoComments(content: string, filePath: string): TechnicalDebtIssue[] {
		const issues: TechnicalDebtIssue[] = [];
		const lines = content.split('\n');

		const patterns = [
			{ regex: /\/\/\s*TODO:?\s*(.+)/i, type: 'todo' as const, priority: 'medium' as const, cost: 2 },
			{ regex: /\/\/\s*FIXME:?\s*(.+)/i, type: 'fixme' as const, priority: 'high' as const, cost: 4 },
			{ regex: /\/\/\s*HACK:?\s*(.+)/i, type: 'hack' as const, priority: 'high' as const, cost: 6 },
			{ regex: /\/\/\s*XXX:?\s*(.+)/i, type: 'hack' as const, priority: 'medium' as const, cost: 3 },
			{ regex: /\/\*\s*TODO:?\s*(.+?)\*\//i, type: 'todo' as const, priority: 'medium' as const, cost: 2 },
			{ regex: /\/\*\s*FIXME:?\s*(.+?)\*\//i, type: 'fixme' as const, priority: 'high' as const, cost: 4 },
			{ regex: /#\s*TODO:?\s*(.+)/i, type: 'todo' as const, priority: 'medium' as const, cost: 2 },  // Python/Shell
			{ regex: /#\s*FIXME:?\s*(.+)/i, type: 'fixme' as const, priority: 'high' as const, cost: 4 }   // Python/Shell
		];

		lines.forEach((line, idx) => {
			for (const { regex, type, priority, cost } of patterns) {
				const match = line.match(regex);
				if (match) {
					const description = match[1]?.trim() || '';
					issues.push({
						category: IssueCategory.TechnicalDebt,
						type,
						severity: priority === 'high' ? IssueSeverity.Warning : IssueSeverity.Info,
						message: `${type.toUpperCase()}: ${description}`,
						filePath,
						priority,
						estimatedCost: cost,
						range: {
							startLineNumber: idx + 1,
							startColumn: 1,
							endLineNumber: idx + 1,
							endColumn: line.length + 1
						},
						suggestion: `Address this ${type} comment`
					});
					break;  // Only match one pattern per line
				}
			}
		});

		return issues;
	}

	/**
	 * Find deprecated API usage
	 */
	private findDeprecatedUsage(content: string, filePath: string): TechnicalDebtIssue[] {
		const issues: TechnicalDebtIssue[] = [];
		const lines = content.split('\n');

		// Common deprecated patterns
		const deprecatedPatterns = [
			// Explicit @deprecated annotations
			{
				pattern: /@deprecated/i,
				message: 'Using deprecated API',
				cost: 4
			},
			// JavaScript deprecated methods
			{
				pattern: /\.substr\(/,
				message: 'substr() is deprecated, use substring() or slice()',
				cost: 1
			},
			{
				pattern: /document\.write\(/,
				message: 'document.write() is deprecated and blocks rendering',
				cost: 3
			},
			// Node.js deprecated
			{
				pattern: /require\(['"]domain['"]\)/,
				message: 'domain module is deprecated',
				cost: 8
			},
			{
				pattern: /Buffer\(\s*\d+\s*\)/,
				message: 'Buffer constructor is deprecated, use Buffer.alloc() or Buffer.from()',
				cost: 2
			},
			// React deprecated
			{
				pattern: /componentWillMount|componentWillReceiveProps|componentWillUpdate/,
				message: 'Deprecated React lifecycle method',
				cost: 4
			},
			{
				pattern: /React\.createClass/,
				message: 'React.createClass is deprecated, use ES6 classes',
				cost: 6
			}
		];

		lines.forEach((line, idx) => {
			for (const { pattern, message, cost } of deprecatedPatterns) {
				if (pattern.test(line)) {
					issues.push({
						category: IssueCategory.TechnicalDebt,
						type: 'deprecated',
						severity: IssueSeverity.Warning,
						message,
						filePath,
						priority: 'high',
						estimatedCost: cost,
						range: {
							startLineNumber: idx + 1,
							startColumn: 1,
							endLineNumber: idx + 1,
							endColumn: line.length + 1
						},
						suggestion: 'Update to use the recommended alternative'
					});
				}
			}
		});

		return issues;
	}

	/**
	 * Find temporary hacks and workarounds
	 */
	private findHacks(content: string, filePath: string): TechnicalDebtIssue[] {
		const issues: TechnicalDebtIssue[] = [];
		const lines = content.split('\n');

		const hackPatterns = [
			// Temporary fixes
			{
				pattern: /temporary|temp fix|quick fix|workaround/i,
				message: 'Temporary solution or workaround detected',
				cost: 4
			},
			// Commented out code (more than 3 consecutive lines)
			{
				pattern: /^\/\/\s*[a-zA-Z0-9_]+/,
				message: 'Commented out code should be removed',
				cost: 1,
				checkConsecutive: true
			},
			// Suppressed warnings
			{
				pattern: /@SuppressWarnings|@ts-ignore|@ts-nocheck|eslint-disable|@ts-expect-error/,
				message: 'Warning suppression - may hide underlying issues',
				cost: 2
			},
			// Any/unknown type usage (TypeScript)
			{
				pattern: /:\s*any\s*[;,)=]/,
				message: 'Using "any" type defeats TypeScript purpose',
				cost: 2
			},
			// Forced type casting
			{
				pattern: /as any|as unknown/,
				message: 'Forced type casting may hide type errors',
				cost: 2
			}
		];

		let commentedOutLines = 0;
		let firstCommentLine = -1;

		lines.forEach((line, idx) => {
			const trimmed = line.trim();

			// Check for consecutive commented code
			if (trimmed.match(/^\/\/\s*[a-zA-Z0-9_]+/)) {
				commentedOutLines++;
				if (firstCommentLine === -1) {
					firstCommentLine = idx;
				}

				if (commentedOutLines >= 3 && firstCommentLine >= 0) {
					issues.push({
						category: IssueCategory.TechnicalDebt,
						type: 'hack',
						severity: IssueSeverity.Info,
						message: `${commentedOutLines} lines of commented out code`,
						filePath,
						priority: 'low',
						estimatedCost: 1,
						range: {
							startLineNumber: firstCommentLine + 1,
							startColumn: 1,
							endLineNumber: idx + 1,
							endColumn: line.length + 1
						},
						suggestion: 'Remove commented out code or restore it'
					});
					commentedOutLines = 0;
					firstCommentLine = -1;
				}
			} else {
				commentedOutLines = 0;
				firstCommentLine = -1;
			}

			// Check other hack patterns
			for (const { pattern, message, cost, checkConsecutive } of hackPatterns) {
				if (checkConsecutive) {
					continue; // Already handled above
				}

				if (pattern.test(line)) {
					issues.push({
						category: IssueCategory.TechnicalDebt,
						type: 'hack',
						severity: IssueSeverity.Info,
						message,
						filePath,
						priority: 'medium',
						estimatedCost: cost,
						range: {
							startLineNumber: idx + 1,
							startColumn: 1,
							endLineNumber: idx + 1,
							endColumn: line.length + 1
						},
						suggestion: 'Refactor to use proper solution'
					});
				}
			}
		});

		return issues;
	}

	/**
	 * Find outdated coding patterns
	 */
	private findOutdatedPatterns(content: string, filePath: string, languageId: string): TechnicalDebtIssue[] {
		const issues: TechnicalDebtIssue[] = [];
		const lines = content.split('\n');

		// Language-specific outdated patterns
		const outdatedPatterns: Record<string, Array<{ pattern: RegExp; message: string; cost: number }>> = {
			'javascript': [
				{ pattern: /var\s+\w+/, message: 'Use const/let instead of var', cost: 1 },
				{ pattern: /function\s+\w+\s*\([^)]*\)\s*\{/, message: 'Consider using arrow functions', cost: 1 },
				{ pattern: /\.indexOf\([^)]+\)\s*[>!=]=\s*-?[01]/, message: 'Use .includes() instead of indexOf', cost: 1 }
			],
			'typescript': [
				{ pattern: /var\s+\w+/, message: 'Use const/let instead of var', cost: 1 },
				{ pattern: /\.indexOf\([^)]+\)\s*[>!=]=\s*-?[01]/, message: 'Use .includes() instead of indexOf', cost: 1 }
			],
			'python': [
				{ pattern: /print\s+[^(]/, message: 'Use print() function instead of print statement (Python 2)', cost: 2 },
				{ pattern: /has_key\(/, message: 'Use "in" operator instead of has_key()', cost: 1 }
			]
		};

		const patterns = outdatedPatterns[languageId] || [];

		lines.forEach((line, idx) => {
			for (const { pattern, message, cost } of patterns) {
				if (pattern.test(line)) {
					issues.push({
						category: IssueCategory.TechnicalDebt,
						type: 'outdated',
						severity: IssueSeverity.Info,
						message,
						filePath,
						priority: 'low',
						estimatedCost: cost,
						range: {
							startLineNumber: idx + 1,
							startColumn: 1,
							endLineNumber: idx + 1,
							endColumn: line.length + 1
						},
						suggestion: 'Update to modern syntax'
					});
				}
			}
		});

		return issues;
	}
}
