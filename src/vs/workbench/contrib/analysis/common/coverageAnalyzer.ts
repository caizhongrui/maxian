/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextModel } from '../../../../editor/common/model.js';
import { CoverageIssue, CoverageMetrics, IssueSeverity, IssueCategory } from './analysisTypes.js';

/**
 * Test coverage analyzer
 * Analyzes test coverage from coverage reports OR analyzes test file patterns
 * Note: Can work in two modes:
 * 1. With coverage data from Istanbul, JaCoCo, etc.
 * 2. Without coverage data by analyzing test file patterns
 */
export class CoverageAnalyzer {

	/**
	 * Analyze test coverage for a given model
	 * @param model - The text model to analyze
	 * @param filePath - Path to the file
	 * @param coverageData - Optional coverage data from test runners
	 */
	async analyze(
		model: ITextModel,
		filePath: string,
		coverageData?: any
	): Promise<CoverageIssue[]> {
		// If coverage data provided, use it
		if (coverageData) {
			return this.analyzeWithCoverageData(model, filePath, coverageData);
		}

		// Otherwise, analyze test file patterns
		return this.analyzeTestFilePattern(model, filePath);
	}

	/**
	 * Analyze with coverage data
	 */
	private async analyzeWithCoverageData(
		model: ITextModel,
		filePath: string,
		coverageData: any
	): Promise<CoverageIssue[]> {
		const issues: CoverageIssue[] = [];

		// Parse coverage data (format depends on tool: Istanbul, JaCoCo, etc.)
		const metrics = this.parseCoverageData(coverageData, filePath);

		if (!metrics) {
			return issues;
		}

		// Report low coverage
		if (metrics.lineCoverage < 80) {
			const severity = metrics.lineCoverage < 50
				? IssueSeverity.Warning
				: IssueSeverity.Info;

			issues.push({
				category: IssueCategory.Coverage,
				severity,
				message: `Low test coverage: ${metrics.lineCoverage.toFixed(1)}% lines covered`,
				filePath,
				metrics,
				uncoveredLines: this.extractUncoveredLines(coverageData),
				suggestion: this.getCoverageSuggestion(metrics)
			});
		}

		console.log(`[Coverage Analyzer] Coverage for ${filePath}: ${metrics.lineCoverage.toFixed(1)}%`);
		return issues;
	}

	/**
	 * Analyze test file patterns without coverage data
	 * Checks if source files have corresponding test files
	 */
	private async analyzeTestFilePattern(
		model: ITextModel,
		filePath: string
	): Promise<CoverageIssue[]> {
		const issues: CoverageIssue[] = [];
		const content = model.getValue();

		// Skip if this is already a test file
		if (this.isTestFile(filePath)) {
			console.log(`[Coverage Analyzer] Skipping test file: ${filePath}`);
			return issues;
		}

		// Skip if file has no testable code
		if (!this.hasTestableCode(content)) {
			console.log(`[Coverage Analyzer] No testable code in: ${filePath}`);
			return issues;
		}

		// Check for missing test file
		const expectedTestFile = this.getExpectedTestFilePath(filePath);
		issues.push({
			category: IssueCategory.Coverage,
			severity: IssueSeverity.Info,
			message: `No test coverage detected. Expected test file: ${expectedTestFile}`,
			filePath,
			suggestion: 'Create unit tests to verify functionality'
		});

		console.log(`[Coverage Analyzer] Missing test file for ${filePath}: ${expectedTestFile}`);
		return issues;
	}

	/**
	 * Check if file is a test file
	 */
	private isTestFile(filePath: string): boolean {
		const testPatterns = [
			/\.test\.(ts|js|tsx|jsx|py|java|go|rs)$/,
			/\.spec\.(ts|js|tsx|jsx|py)$/,
			/_test\.(ts|js|tsx|jsx|py|go)$/,
			/Test\.(java|kt)$/,
			/test_.*\.py$/,
			/__tests__\//,
			/\/tests?\//
		];

		return testPatterns.some(pattern => pattern.test(filePath));
	}

	/**
	 * Check if file contains testable code
	 */
	private hasTestableCode(content: string): boolean {
		// Check for functions/methods/classes
		const codePatterns = [
			/\bfunction\s+\w+/,           // JavaScript/TypeScript functions
			/\bclass\s+\w+/,              // Classes
			/\bdef\s+\w+/,                // Python functions
			/\bpublic\s+.*\s+\w+\s*\(/,  // Java methods
			/\bfn\s+\w+/                  // Rust/Go functions
		];

		return codePatterns.some(pattern => pattern.test(content));
	}

	/**
	 * Get expected test file path based on conventions
	 */
	private getExpectedTestFilePath(filePath: string): string {
		// TypeScript/JavaScript conventions
		if (/\.(ts|tsx|js|jsx)$/.test(filePath)) {
			// Try .test.ts pattern
			return filePath.replace(/\.(ts|tsx|js|jsx)$/, '.test.$1');
		}

		// Python conventions
		if (/\.py$/.test(filePath)) {
			const dir = filePath.substring(0, filePath.lastIndexOf('/'));
			const filename = filePath.substring(filePath.lastIndexOf('/') + 1);
			return `${dir}/test_${filename}`;
		}

		// Java conventions
		if (/\.java$/.test(filePath)) {
			return filePath.replace(/\.java$/, 'Test.java').replace('/src/', '/test/');
		}

		// Go conventions
		if (/\.go$/.test(filePath)) {
			return filePath.replace(/\.go$/, '_test.go');
		}

		// Rust conventions
		if (/\.rs$/.test(filePath)) {
			const dir = filePath.substring(0, filePath.lastIndexOf('/'));
			return `${dir}/tests/`;
		}

		// Generic: add .test extension
		return `${filePath}.test`;
	}

	/**
	 * Parse coverage data from various formats
	 */
	private parseCoverageData(coverageData: any, filePath: string): CoverageMetrics | null {
		// Support common coverage formats

		// Istanbul/NYC format
		if (coverageData.total || coverageData[filePath]) {
			const fileData = coverageData[filePath] || coverageData.total;
			return {
				lineCoverage: this.calculatePercentage(fileData.lines || fileData.l),
				branchCoverage: this.calculatePercentage(fileData.branches || fileData.b),
				functionCoverage: this.calculatePercentage(fileData.functions || fileData.f),
				statementCoverage: this.calculatePercentage(fileData.statements || fileData.s)
			};
		}

		// JaCoCo format (Java)
		if (coverageData.counter) {
			const lineCounter = coverageData.counter.find((c: any) => c.type === 'LINE');
			const branchCounter = coverageData.counter.find((c: any) => c.type === 'BRANCH');
			const methodCounter = coverageData.counter.find((c: any) => c.type === 'METHOD');

			return {
				lineCoverage: this.calculateCoverage(lineCounter?.covered, lineCounter?.missed),
				branchCoverage: this.calculateCoverage(branchCounter?.covered, branchCounter?.missed),
				functionCoverage: this.calculateCoverage(methodCounter?.covered, methodCounter?.missed),
				statementCoverage: this.calculateCoverage(lineCounter?.covered, lineCounter?.missed)
			};
		}

		// Generic format
		if (coverageData.lineCoverage !== undefined) {
			return {
				lineCoverage: coverageData.lineCoverage,
				branchCoverage: coverageData.branchCoverage || 0,
				functionCoverage: coverageData.functionCoverage || 0,
				statementCoverage: coverageData.statementCoverage || coverageData.lineCoverage
			};
		}

		return null;
	}

	/**
	 * Calculate coverage percentage
	 */
	private calculatePercentage(data: any): number {
		if (!data) {
			return 0;
		}
		if (typeof data === 'number') {
			return data;
		}
		if (data.pct !== undefined) {
			return data.pct;
		}
		if (data.covered !== undefined && data.total !== undefined) {
			return data.total > 0 ? (data.covered / data.total) * 100 : 0;
		}
		return 0;
	}

	/**
	 * Calculate coverage from covered/missed counts
	 */
	private calculateCoverage(covered?: number, missed?: number): number {
		if (covered === undefined || missed === undefined) {
			return 0;
		}
		const total = covered + missed;
		return total > 0 ? (covered / total) * 100 : 0;
	}

	/**
	 * Extract uncovered line numbers
	 */
	private extractUncoveredLines(coverageData: any): number[] {
		const uncovered: number[] = [];

		// Istanbul format
		if (coverageData.statementMap && coverageData.s) {
			Object.keys(coverageData.s).forEach(key => {
				if (coverageData.s[key] === 0) {
					const statement = coverageData.statementMap[key];
					if (statement && statement.start) {
						uncovered.push(statement.start.line);
					}
				}
			});
		}

		// Generic format
		if (Array.isArray(coverageData.uncoveredLines)) {
			uncovered.push(...coverageData.uncoveredLines);
		}

		return Array.from(new Set(uncovered)).sort((a, b) => a - b);
	}

	/**
	 * Get suggestion based on coverage metrics
	 */
	private getCoverageSuggestion(metrics: CoverageMetrics): string {
		const suggestions: string[] = [];

		if (metrics.lineCoverage < 50) {
			suggestions.push('Critical: Add comprehensive unit tests');
		} else if (metrics.lineCoverage < 80) {
			suggestions.push('Add more test cases to improve coverage');
		}

		if (metrics.branchCoverage < metrics.lineCoverage - 20) {
			suggestions.push('Focus on testing different code paths and edge cases');
		}

		if (metrics.functionCoverage < metrics.lineCoverage - 15) {
			suggestions.push('Ensure all functions have test coverage');
		}

		if (suggestions.length === 0) {
			suggestions.push('Maintain current coverage level');
		}

		return suggestions.join('; ');
	}
}
