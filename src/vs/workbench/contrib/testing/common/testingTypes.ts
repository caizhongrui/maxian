/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';

/**
 * Test status
 */
export enum TestStatus {
	Pending = 'pending',
	Running = 'running',
	Passed = 'passed',
	Failed = 'failed',
	Skipped = 'skipped',
	Error = 'error'
}

/**
 * Test framework type
 */
export enum TestFramework {
	Jest = 'jest',
	Mocha = 'mocha',
	Vitest = 'vitest',
	Pytest = 'pytest',
	JUnit = 'junit',
	Go = 'go',
	Cargo = 'cargo',
	Unknown = 'unknown'
}

/**
 * Single test case
 */
export interface TestCase {
	readonly id: string;
	readonly name: string;
	readonly filePath: string;
	readonly line?: number;
	readonly status: TestStatus;
	readonly duration?: number;
	readonly error?: {
		readonly message: string;
		readonly stack?: string;
	};
}

/**
 * Test suite (collection of tests)
 */
export interface TestSuite {
	readonly id: string;
	readonly name: string;
	readonly filePath: string;
	readonly tests: TestCase[];
	readonly suites: TestSuite[];
	readonly status: TestStatus;
	readonly duration?: number;
}

/**
 * Test run result
 */
export interface TestRunResult {
	readonly timestamp: number;
	readonly framework: TestFramework;
	readonly rootSuite: TestSuite;
	readonly summary: {
		readonly total: number;
		readonly passed: number;
		readonly failed: number;
		readonly skipped: number;
		readonly duration: number;
	};
	readonly coverage?: CoverageData;
}

/**
 * Code coverage data
 */
export interface CoverageData {
	readonly lines: {
		readonly total: number;
		readonly covered: number;
		readonly percentage: number;
	};
	readonly branches: {
		readonly total: number;
		readonly covered: number;
		readonly percentage: number;
	};
	readonly functions: {
		readonly total: number;
		readonly covered: number;
		readonly percentage: number;
	};
	readonly statements: {
		readonly total: number;
		readonly covered: number;
		readonly percentage: number;
	};
	readonly files: Map<string, FileCoverage>;
}

/**
 * File-specific coverage data
 */
export interface FileCoverage {
	readonly path: string;
	readonly lines: {
		readonly total: number;
		readonly covered: number;
		readonly percentage: number;
		readonly uncovered: number[];
	};
	readonly branches: {
		readonly total: number;
		readonly covered: number;
		readonly percentage: number;
	};
	readonly functions: {
		readonly total: number;
		readonly covered: number;
		readonly percentage: number;
	};
	readonly statements: {
		readonly total: number;
		readonly covered: number;
		readonly percentage: number;
	};
}

/**
 * Test configuration
 */
export interface TestConfiguration {
	readonly framework: TestFramework;
	readonly testMatch: string[];
	readonly coverageEnabled: boolean;
	readonly coverageThreshold?: {
		readonly lines?: number;
		readonly branches?: number;
		readonly functions?: number;
		readonly statements?: number;
	};
	readonly timeout?: number;
	readonly parallel?: boolean;
}

/**
 * Test discovery result
 */
export interface TestDiscoveryResult {
	readonly tests: TestSuite[];
	readonly framework: TestFramework;
	readonly testFiles: URI[];
	readonly errors: string[];
}
