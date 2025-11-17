/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRange } from '../../../../editor/common/core/range.js';

/**
 * Severity levels for analysis issues
 */
export enum IssueSeverity {
	Error = 'error',
	Warning = 'warning',
	Info = 'info'
}

/**
 * Categories of analysis issues
 */
export enum IssueCategory {
	Quality = 'quality',
	Security = 'security',
	Performance = 'performance',
	Complexity = 'complexity',
	Dependency = 'dependency',
	Coverage = 'coverage',
	TechnicalDebt = 'technical-debt'
}

/**
 * Base interface for all analysis issues
 */
export interface AnalysisIssue {
	readonly category: IssueCategory;
	readonly severity: IssueSeverity;
	readonly message: string;
	readonly filePath: string;
	readonly range?: IRange;
	readonly code?: string;
	readonly suggestion?: string;
}

/**
 * Quality-specific issue
 */
export interface QualityIssue extends AnalysisIssue {
	readonly category: IssueCategory.Quality;
	readonly type: 'naming' | 'magic-number' | 'duplicate' | 'code-smell';
}

/**
 * Security-specific issue
 */
export interface SecurityIssue extends AnalysisIssue {
	readonly category: IssueCategory.Security;
	readonly type: 'sql-injection' | 'xss' | 'csrf' | 'sensitive-data';
	readonly cwe?: string; // Common Weakness Enumeration ID
}

/**
 * Performance-specific issue
 */
export interface PerformanceIssue extends AnalysisIssue {
	readonly category: IssueCategory.Performance;
	readonly type: 'n-plus-one' | 'memory-leak' | 'inefficient-algorithm' | 'blocking-operation';
	readonly estimatedImpact?: 'low' | 'medium' | 'high';
}

/**
 * Complexity metrics
 */
export interface ComplexityMetrics {
	readonly cyclomaticComplexity: number;
	readonly cognitiveComplexity?: number;
	readonly linesOfCode: number;
	readonly maintainabilityIndex?: number;
}

/**
 * Complexity-specific issue
 */
export interface ComplexityIssue extends AnalysisIssue {
	readonly category: IssueCategory.Complexity;
	readonly metrics: ComplexityMetrics;
}

/**
 * Dependency graph node
 */
export interface DependencyNode {
	readonly filePath: string;
	readonly imports: string[];
	readonly exports: string[];
}

/**
 * Dependency-specific issue
 */
export interface DependencyIssue extends AnalysisIssue {
	readonly category: IssueCategory.Dependency;
	readonly type: 'circular' | 'unused' | 'outdated' | 'missing';
	readonly dependencies?: string[];
}

/**
 * Test coverage metrics
 */
export interface CoverageMetrics {
	readonly lineCoverage: number;
	readonly branchCoverage: number;
	readonly functionCoverage: number;
	readonly statementCoverage: number;
}

/**
 * Coverage-specific issue
 */
export interface CoverageIssue extends AnalysisIssue {
	readonly category: IssueCategory.Coverage;
	readonly metrics?: CoverageMetrics;
	readonly uncoveredLines?: number[];
}

/**
 * Technical debt item
 */
export interface TechnicalDebtIssue extends AnalysisIssue {
	readonly category: IssueCategory.TechnicalDebt;
	readonly type: 'todo' | 'fixme' | 'hack' | 'deprecated' | 'outdated';
	readonly estimatedCost?: number; // In hours
	readonly priority?: 'low' | 'medium' | 'high';
}

/**
 * Analysis result containing all issues
 */
export interface AnalysisResult {
	readonly timestamp: number;
	readonly issues: AnalysisIssue[];
	readonly summary: {
		readonly total: number;
		readonly errors: number;
		readonly warnings: number;
		readonly infos: number;
		readonly byCategory: Record<IssueCategory, number>;
	};
}
