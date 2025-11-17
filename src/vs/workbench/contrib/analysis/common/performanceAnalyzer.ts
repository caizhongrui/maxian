/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextModel } from '../../../../editor/common/model.js';
import { PerformanceIssue, IssueSeverity, IssueCategory } from './analysisTypes.js';

/**
 * Performance bottleneck analyzer
 * Detects:
 * - N+1 query problems
 * - Memory leaks
 * - Inefficient algorithms
 * - Blocking operations
 */
export class PerformanceAnalyzer {

	/**
	 * Analyze performance issues for a given model
	 */
	async analyze(model: ITextModel, filePath: string): Promise<PerformanceIssue[]> {
		const issues: PerformanceIssue[] = [];
		const content = model.getValue();
		const languageId = model.getLanguageId();

		// Run all performance checks
		issues.push(...this.checkNPlusOne(content, model, filePath, languageId));
		issues.push(...this.checkMemoryLeaks(content, model, filePath, languageId));
		issues.push(...this.checkInefficientAlgorithms(content, model, filePath));
		issues.push(...this.checkBlockingOperations(content, model, filePath, languageId));

		console.log(`[Performance Analyzer] Found ${issues.length} performance issues in ${filePath}`);
		return issues;
	}

	/**
	 * Check for N+1 query problems
	 */
	private checkNPlusOne(
		content: string,
		model: ITextModel,
		filePath: string,
		languageId: string
	): PerformanceIssue[] {
		const issues: PerformanceIssue[] = [];
		const lines = content.split('\n');

		// Pattern: loop with database query inside
		const patterns = [
			// forEach/for loop with SQL query
			/for\s*\(|forEach\s*\(|\.map\s*\(/i,
			/SELECT|INSERT|UPDATE|DELETE|find|findOne|query/i
		];

		let inLoop = false;

		lines.forEach((line, idx) => {
			if (patterns[0].test(line)) {
				inLoop = true;
			}

			if (inLoop && patterns[1].test(line)) {
				issues.push({
					category: IssueCategory.Performance,
					type: 'n-plus-one',
					severity: IssueSeverity.Warning,
					message: 'Potential N+1 query: database query inside loop',
					filePath,
					estimatedImpact: 'high',
					range: {
						startLineNumber: idx + 1,
						startColumn: 1,
						endLineNumber: idx + 1,
						endColumn: line.length + 1
					},
					suggestion: 'Consider using batch queries or eager loading'
				});
				inLoop = false;
			}

			// Reset loop tracking after closing brace
			if (inLoop && line.includes('}')) {
				inLoop = false;
			}
		});

		return issues;
	}

	/**
	 * Check for memory leaks
	 */
	private checkMemoryLeaks(
		content: string,
		model: ITextModel,
		filePath: string,
		languageId: string
	): PerformanceIssue[] {
		const issues: PerformanceIssue[] = [];
		const lines = content.split('\n');

		// Memory leak patterns
		const leakPatterns = [
			// Event listeners without cleanup
			{
				pattern: /addEventListener\s*\(/i,
				message: 'Event listener added without corresponding removeEventListener',
				check: (content: string, idx: number) => {
					const following = lines.slice(idx, idx + 50).join('\n');
					return !following.includes('removeEventListener');
				}
			},
			// setInterval without clearInterval
			{
				pattern: /setInterval\s*\(/i,
				message: 'setInterval without corresponding clearInterval',
				check: (content: string, idx: number) => {
					const following = lines.slice(idx, idx + 50).join('\n');
					return !following.includes('clearInterval');
				}
			},
			// Unclosed streams/connections
			{
				pattern: /createReadStream|createWriteStream|connect\(/i,
				message: 'Stream/connection created without explicit cleanup',
				check: (content: string, idx: number) => {
					const following = lines.slice(idx, idx + 30).join('\n');
					return !following.match(/\.close\(|\.end\(|\.destroy\(/);
				}
			}
		];

		lines.forEach((line, idx) => {
			for (const { pattern, message, check } of leakPatterns) {
				if (pattern.test(line) && check(content, idx)) {
					issues.push({
						category: IssueCategory.Performance,
						type: 'memory-leak',
						severity: IssueSeverity.Warning,
						message,
						filePath,
						estimatedImpact: 'medium',
						range: {
							startLineNumber: idx + 1,
							startColumn: 1,
							endLineNumber: idx + 1,
							endColumn: line.length + 1
						},
						suggestion: 'Ensure proper cleanup in component unmount or function exit'
					});
				}
			}
		});

		return issues;
	}

	/**
	 * Check for inefficient algorithms
	 */
	private checkInefficientAlgorithms(
		content: string,
		model: ITextModel,
		filePath: string
	): PerformanceIssue[] {
		const issues: PerformanceIssue[] = [];
		const lines = content.split('\n');

		// Nested loops (O(n²) or worse)
		let loopDepth = 0;
		const loopStack: number[] = [];

		lines.forEach((line, idx) => {
			if (/for\s*\(|while\s*\(|forEach\s*\(|\.map\s*\(/.test(line)) {
				loopDepth++;
				loopStack.push(idx);
			}

			if (loopDepth >= 3) {
				issues.push({
					category: IssueCategory.Performance,
					type: 'inefficient-algorithm',
					severity: IssueSeverity.Warning,
					message: `Deeply nested loops (depth: ${loopDepth}) - O(n^${loopDepth}) complexity`,
					filePath,
					estimatedImpact: 'high',
					range: {
						startLineNumber: idx + 1,
						startColumn: 1,
						endLineNumber: idx + 1,
						endColumn: line.length + 1
					},
					suggestion: 'Consider using more efficient data structures (Map, Set) or algorithms'
				});
			}

			if (line.includes('}')) {
				if (loopDepth > 0) {
					loopDepth--;
					loopStack.pop();
				}
			}
		});

		// Array operations in loops
		lines.forEach((line, idx) => {
			// Inefficient array search in loop
			if (/for\s*\(.*\.indexOf\(|for\s*\(.*\.includes\(/.test(line)) {
				issues.push({
					category: IssueCategory.Performance,
					type: 'inefficient-algorithm',
					severity: IssueSeverity.Info,
					message: 'Array search (indexOf/includes) in loop - consider using Set',
					filePath,
					estimatedImpact: 'medium',
					range: {
						startLineNumber: idx + 1,
						startColumn: 1,
						endLineNumber: idx + 1,
						endColumn: line.length + 1
					},
					suggestion: 'Convert array to Set for O(1) lookups instead of O(n)'
				});
			}
		});

		return issues;
	}

	/**
	 * Check for blocking operations
	 */
	private checkBlockingOperations(
		content: string,
		model: ITextModel,
		filePath: string,
		languageId: string
	): PerformanceIssue[] {
		const issues: PerformanceIssue[] = [];
		const lines = content.split('\n');

		// Blocking patterns in async contexts
		const blockingPatterns = [
			// Synchronous file operations
			{
				pattern: /fs\.readFileSync|fs\.writeFileSync|fs\.existsSync/i,
				message: 'Synchronous file operation blocks the event loop',
				impact: 'high' as const,
				suggestion: 'Use async versions: readFile, writeFile, access'
			},
			// Synchronous crypto operations
			{
				pattern: /crypto\.pbkdf2Sync|crypto\.randomBytesSync/i,
				message: 'Synchronous crypto operation blocks the event loop',
				impact: 'medium' as const,
				suggestion: 'Use async versions: pbkdf2, randomBytes'
			},
			// Heavy CPU operations without workers
			{
				pattern: /JSON\.parse\(.*large|JSON\.stringify\(.*large/i,
				message: 'Large JSON operation may block the main thread',
				impact: 'medium' as const,
				suggestion: 'Consider using worker threads for large JSON operations'
			},
			// Synchronous network calls
			{
				pattern: /request\.sync|http\.requestSync|axios\.sync/i,
				message: 'Synchronous HTTP request blocks execution',
				impact: 'high' as const,
				suggestion: 'Use async/await or promises for HTTP requests'
			}
		];

		lines.forEach((line, idx) => {
			for (const { pattern, message, impact, suggestion } of blockingPatterns) {
				if (pattern.test(line)) {
					issues.push({
						category: IssueCategory.Performance,
						type: 'blocking-operation',
						severity: impact === 'high' ? IssueSeverity.Warning : IssueSeverity.Info,
						message,
						filePath,
						estimatedImpact: impact,
						range: {
							startLineNumber: idx + 1,
							startColumn: 1,
							endLineNumber: idx + 1,
							endColumn: line.length + 1
						},
						suggestion
					});
				}
			}
		});

		return issues;
	}
}
