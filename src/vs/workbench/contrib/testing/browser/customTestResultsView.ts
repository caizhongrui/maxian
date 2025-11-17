/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { TestRunResult, TestSuite, TestCase, TestStatus } from '../common/testingTypes.js';

/**
 * Custom test results view
 * Displays test run results in a tree structure
 */
export class CustomTestResultsView extends Disposable {

	private _currentResult: TestRunResult | undefined;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();
		// _instantiationService reserved for future instantiation needs
		void this._instantiationService;
	}

	/**
	 * Show test results
	 */
	showResults(result: TestRunResult): void {
		this._currentResult = result;
		this.render();
	}

	/**
	 * Clear results
	 */
	clear(): void {
		this._currentResult = undefined;
		this.render();
	}

	/**
	 * Render the results
	 */
	private render(): void {
		if (!this._currentResult) {
			console.log('[Test Results View] No results to display');
			return;
		}

		console.log('[Test Results View] Rendering test results');
		console.log('[Test Results View] Framework:', this._currentResult.framework);
		console.log('[Test Results View] Summary:', this._currentResult.summary);

		// Render test tree
		this.renderTestSuite(this._currentResult.rootSuite, 0);

		// Display coverage if available
		if (this._currentResult.coverage) {
			this.renderCoverage(this._currentResult.coverage);
		}
	}

	/**
	 * Render a test suite
	 */
	private renderTestSuite(suite: TestSuite, depth: number): void {
		const indent = '  '.repeat(depth);
		const statusIcon = this.getStatusIcon(suite.status);

		console.log(`${indent}${statusIcon} ${suite.name} (${suite.tests.length} tests)`);

		// Render individual tests
		for (const test of suite.tests) {
			this.renderTest(test, depth + 1);
		}

		// Render nested suites
		for (const childSuite of suite.suites) {
			this.renderTestSuite(childSuite, depth + 1);
		}
	}

	/**
	 * Render a test case
	 */
	private renderTest(test: TestCase, depth: number): void {
		const indent = '  '.repeat(depth);
		const statusIcon = this.getStatusIcon(test.status);
		const duration = test.duration ? ` (${test.duration}ms)` : '';

		console.log(`${indent}${statusIcon} ${test.name}${duration}`);

		// Show error details if failed
		if (test.error) {
			console.log(`${indent}  Error: ${test.error.message}`);
			if (test.error.stack) {
				console.log(`${indent}  Stack: ${test.error.stack}`);
			}
		}
	}

	/**
	 * Render coverage information
	 */
	private renderCoverage(coverage: any): void {
		console.log('[Test Results View] Coverage:');
		console.log(`  Lines: ${coverage.lines.covered}/${coverage.lines.total} (${coverage.lines.percentage.toFixed(2)}%)`);
		console.log(`  Branches: ${coverage.branches.covered}/${coverage.branches.total} (${coverage.branches.percentage.toFixed(2)}%)`);
		console.log(`  Functions: ${coverage.functions.covered}/${coverage.functions.total} (${coverage.functions.percentage.toFixed(2)}%)`);
		console.log(`  Statements: ${coverage.statements.covered}/${coverage.statements.total} (${coverage.statements.percentage.toFixed(2)}%)`);
	}

	/**
	 * Get status icon
	 */
	private getStatusIcon(status: TestStatus): string {
		switch (status) {
			case TestStatus.Passed:
				return '✓';
			case TestStatus.Failed:
				return '✗';
			case TestStatus.Skipped:
				return '○';
			case TestStatus.Running:
				return '⟳';
			case TestStatus.Error:
				return '⚠';
			case TestStatus.Pending:
			default:
				return '◯';
		}
	}

	/**
	 * Get current result
	 */
	get currentResult(): TestRunResult | undefined {
		return this._currentResult;
	}
}

/**
 * Test results renderer for console output
 * Provides formatted console output of test results
 */
export class TestResultsRenderer {

	/**
	 * Render test results to console
	 */
	static renderToConsole(result: TestRunResult): void {
		console.log('\n' + '='.repeat(80));
		console.log('TEST RESULTS');
		console.log('='.repeat(80));
		console.log(`Framework: ${result.framework}`);
		console.log(`Timestamp: ${new Date(result.timestamp).toLocaleString()}`);
		console.log('-'.repeat(80));

		// Render summary
		this.renderSummary(result.summary);

		// Render failed tests first
		const failedTests = this.collectFailedTests(result.rootSuite);
		if (failedTests.length > 0) {
			console.log('\n' + '='.repeat(80));
			console.log('FAILED TESTS');
			console.log('='.repeat(80));
			for (const test of failedTests) {
				this.renderFailedTest(test);
			}
		}

		// Render coverage if available
		if (result.coverage) {
			console.log('\n' + '='.repeat(80));
			console.log('CODE COVERAGE');
			console.log('='.repeat(80));
			this.renderCoverage(result.coverage);
		}

		console.log('\n' + '='.repeat(80));
	}

	/**
	 * Render summary
	 */
	private static renderSummary(summary: any): void {
		console.log(`\nTotal:    ${summary.total} tests`);
		console.log(`Passed:   ${summary.passed} tests`);
		console.log(`Failed:   ${summary.failed} tests`);
		console.log(`Skipped:  ${summary.skipped} tests`);
		console.log(`Duration: ${summary.duration}ms`);

		const passRate = summary.total > 0
			? ((summary.passed / summary.total) * 100).toFixed(2)
			: '0.00';
		console.log(`Pass Rate: ${passRate}%`);
	}

	/**
	 * Collect all failed tests
	 */
	private static collectFailedTests(suite: TestSuite): TestCase[] {
		const failed: TestCase[] = [];

		// Collect failed tests from this suite
		for (const test of suite.tests) {
			if (test.status === TestStatus.Failed || test.status === TestStatus.Error) {
				failed.push(test);
			}
		}

		// Recursively collect from nested suites
		for (const childSuite of suite.suites) {
			failed.push(...this.collectFailedTests(childSuite));
		}

		return failed;
	}

	/**
	 * Render a failed test
	 */
	private static renderFailedTest(test: TestCase): void {
		console.log(`\n✗ ${test.name}`);
		console.log(`  File: ${test.filePath}${test.line ? ':' + test.line : ''}`);

		if (test.error) {
			console.log(`  Error: ${test.error.message}`);
			if (test.error.stack) {
				const stackLines = test.error.stack.split('\n').slice(0, 5);
				for (const line of stackLines) {
					console.log(`    ${line}`);
				}
			}
		}
	}

	/**
	 * Render coverage
	 */
	private static renderCoverage(coverage: any): void {
		console.log(`\nLines:      ${coverage.lines.covered}/${coverage.lines.total} (${coverage.lines.percentage.toFixed(2)}%)`);
		console.log(`Branches:   ${coverage.branches.covered}/${coverage.branches.total} (${coverage.branches.percentage.toFixed(2)}%)`);
		console.log(`Functions:  ${coverage.functions.covered}/${coverage.functions.total} (${coverage.functions.percentage.toFixed(2)}%)`);
		console.log(`Statements: ${coverage.statements.covered}/${coverage.statements.total} (${coverage.statements.percentage.toFixed(2)}%)`);

		// Show coverage quality assessment
		const lineCoverage = coverage.lines.percentage;
		let quality: string;
		if (lineCoverage >= 80) {
			quality = '✓ Good';
		} else if (lineCoverage >= 60) {
			quality = '○ Fair';
		} else {
			quality = '✗ Poor';
		}
		console.log(`\nCoverage Quality: ${quality}`);
	}
}
