/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { TestFramework, CoverageData, FileCoverage } from './testingTypes.js';
import { IFileService } from '../../../../platform/files/common/files.js';

/**
 * Coverage collector service
 * Collects and parses test coverage data from various formats
 */
export class CoverageCollector {

	constructor(
		private readonly fileService: IFileService
	) { }

	/**
	 * Collect coverage data after test run
	 */
	async collectCoverage(
		workspaceUri: URI,
		framework: TestFramework
	): Promise<CoverageData | undefined> {
		console.log('[Coverage Collector] Collecting coverage for framework:', framework);

		try {
			// Find coverage report based on framework
			const coverageFile = await this.findCoverageReport(workspaceUri, framework);

			if (!coverageFile) {
				console.log('[Coverage Collector] No coverage report found');
				return undefined;
			}

			// Parse coverage data
			const coverageData = await this.parseCoverageReport(coverageFile, framework);

			if (coverageData) {
				this.logCoverageSummary(coverageData);
			}

			return coverageData;
		} catch (error) {
			console.error('[Coverage Collector] Failed to collect coverage:', error);
			return undefined;
		}
	}

	/**
	 * Find coverage report file
	 */
	private async findCoverageReport(
		workspaceUri: URI,
		framework: TestFramework
	): Promise<URI | undefined> {
		// Different frameworks generate coverage reports in different locations
		const coveragePaths = this.getCoveragePaths(framework);

		for (const path of coveragePaths) {
			try {
				const coverageUri = URI.joinPath(workspaceUri, path);
				const stat = await this.fileService.resolve(coverageUri);

				if (stat) {
					console.log('[Coverage Collector] Found coverage report:', coverageUri.fsPath);
					return coverageUri;
				}
			} catch (error) {
				// File doesn't exist, try next
			}
		}

		return undefined;
	}

	/**
	 * Get possible coverage report paths for framework
	 */
	private getCoveragePaths(framework: TestFramework): string[] {
		switch (framework) {
			case TestFramework.Jest:
			case TestFramework.Vitest:
				return [
					'coverage/coverage-final.json',
					'coverage/lcov.info',
					'coverage/clover.xml',
					'.nyc_output/coverage.json'
				];

			case TestFramework.Mocha:
				return [
					'coverage/coverage-final.json',
					'.nyc_output/coverage.json',
					'coverage/lcov.info'
				];

			case TestFramework.Pytest:
				return [
					'coverage.xml',
					'.coverage',
					'htmlcov/index.html'
				];

			case TestFramework.JUnit:
				return [
					'target/site/jacoco/jacoco.xml',
					'build/reports/jacoco/test/jacocoTestReport.xml',
					'target/jacoco.exec'
				];

			case TestFramework.Go:
				return [
					'coverage.out',
					'coverage.html',
					'coverage.txt'
				];

			case TestFramework.Cargo:
				return [
					'target/coverage/lcov.info',
					'target/coverage/coverage.json',
					'tarpaulin-report.json'
				];

			default:
				return [];
		}
	}

	/**
	 * Parse coverage report
	 */
	private async parseCoverageReport(
		coverageUri: URI,
		framework: TestFramework
	): Promise<CoverageData | undefined> {
		try {
			const content = await this.fileService.readFile(coverageUri);
			const text = content.value.toString();

			// Detect format by file extension
			const fileName = coverageUri.path.split('/').pop() || '';

			if (fileName.endsWith('.json')) {
				return this.parseJsonCoverage(text, framework);
			} else if (fileName.endsWith('.xml')) {
				return this.parseXmlCoverage(text, framework);
			} else if (fileName.endsWith('.info') || fileName.endsWith('.lcov')) {
				return this.parseLcovCoverage(text);
			} else if (fileName.endsWith('.out')) {
				return this.parseGoCoverage(text);
			}

			return undefined;
		} catch (error) {
			console.error('[Coverage Collector] Failed to parse coverage report:', error);
			return undefined;
		}
	}

	/**
	 * Parse JSON coverage format (Istanbul/NYC)
	 */
	private parseJsonCoverage(
		text: string,
		framework: TestFramework
	): CoverageData | undefined {
		try {
			const json = JSON.parse(text);

			// Istanbul/NYC format
			if (typeof json === 'object' && json !== null) {
				return this.parseIstanbulCoverage(json);
			}

			return undefined;
		} catch (error) {
			console.error('[Coverage Collector] Failed to parse JSON coverage:', error);
			return undefined;
		}
	}

	/**
	 * Parse Istanbul/NYC coverage format
	 */
	private parseIstanbulCoverage(json: any): CoverageData {
		const files = new Map<string, FileCoverage>();
		let totalLines = 0;
		let coveredLines = 0;
		let totalBranches = 0;
		let coveredBranches = 0;
		let totalFunctions = 0;
		let coveredFunctions = 0;
		let totalStatements = 0;
		let coveredStatements = 0;

		// Iterate through files in coverage report
		for (const [filePath, fileData] of Object.entries(json)) {
			if (typeof fileData !== 'object' || fileData === null) {
				continue;
			}

			const data: any = fileData;

			// Parse line coverage
			const lineCov = this.parseIstanbulMetric(data.statementMap, data.s);
			totalLines += lineCov.total;
			coveredLines += lineCov.covered;

			// Parse branch coverage
			const branchCov = this.parseIstanbulMetric(data.branchMap, data.b);
			totalBranches += branchCov.total;
			coveredBranches += branchCov.covered;

			// Parse function coverage
			const functionCov = this.parseIstanbulMetric(data.fnMap, data.f);
			totalFunctions += functionCov.total;
			coveredFunctions += functionCov.covered;

			// Parse statement coverage
			const statementCov = this.parseIstanbulMetric(data.statementMap, data.s);
			totalStatements += statementCov.total;
			coveredStatements += statementCov.covered;

			// Get uncovered lines
			const uncoveredLines: number[] = [];
			if (data.statementMap && data.s) {
				for (const [key, hits] of Object.entries(data.s)) {
					if (hits === 0 && data.statementMap[key]) {
						const statement = data.statementMap[key];
						if (statement.start && statement.start.line) {
							uncoveredLines.push(statement.start.line);
						}
					}
				}
			}

			files.set(filePath, {
				path: filePath,
				lines: {
					total: lineCov.total,
					covered: lineCov.covered,
					percentage: lineCov.total > 0 ? (lineCov.covered / lineCov.total) * 100 : 0,
					uncovered: uncoveredLines.sort((a, b) => a - b)
				},
				branches: {
					total: branchCov.total,
					covered: branchCov.covered,
					percentage: branchCov.total > 0 ? (branchCov.covered / branchCov.total) * 100 : 0
				},
				functions: {
					total: functionCov.total,
					covered: functionCov.covered,
					percentage: functionCov.total > 0 ? (functionCov.covered / functionCov.total) * 100 : 0
				},
				statements: {
					total: statementCov.total,
					covered: statementCov.covered,
					percentage: statementCov.total > 0 ? (statementCov.covered / statementCov.total) * 100 : 0
				}
			});
		}

		return {
			lines: {
				total: totalLines,
				covered: coveredLines,
				percentage: totalLines > 0 ? (coveredLines / totalLines) * 100 : 0
			},
			branches: {
				total: totalBranches,
				covered: coveredBranches,
				percentage: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0
			},
			functions: {
				total: totalFunctions,
				covered: coveredFunctions,
				percentage: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0
			},
			statements: {
				total: totalStatements,
				covered: coveredStatements,
				percentage: totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0
			},
			files
		};
	}

	/**
	 * Parse Istanbul metric (lines, branches, functions, statements)
	 */
	private parseIstanbulMetric(
		map: any,
		hits: any
	): { total: number; covered: number } {
		if (!map || !hits) {
			return { total: 0, covered: 0 };
		}

		const total = Object.keys(map).length;
		let covered = 0;

		for (const key of Object.keys(hits)) {
			const hitCount = hits[key];
			// For branches, hitCount is an array
			if (Array.isArray(hitCount)) {
				if (hitCount.some(h => h > 0)) {
					covered++;
				}
			} else if (hitCount > 0) {
				covered++;
			}
		}

		return { total, covered };
	}

	/**
	 * Parse XML coverage format (JaCoCo, Cobertura)
	 */
	private parseXmlCoverage(
		text: string,
		framework: TestFramework
	): CoverageData | undefined {
		// Simplified XML parsing
		// In production, would use proper XML parser

		// For JaCoCo format
		if (text.includes('<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report')) {
			return this.parseJacocoCoverage(text);
		}

		// For Cobertura format (Python coverage)
		if (text.includes('<!DOCTYPE coverage SYSTEM')) {
			return this.parseCoberturaCoverage(text);
		}

		return undefined;
	}

	/**
	 * Parse JaCoCo XML coverage
	 */
	private parseJacocoCoverage(text: string): CoverageData {
		// Simplified regex-based parsing
		// In production, would use proper XML parser

		const files = new Map<string, FileCoverage>();

		// Extract overall counters
		const lineMatch = text.match(/<counter type="LINE"[^>]*covered="(\d+)"[^>]*missed="(\d+)"/);
		const branchMatch = text.match(/<counter type="BRANCH"[^>]*covered="(\d+)"[^>]*missed="(\d+)"/);
		const methodMatch = text.match(/<counter type="METHOD"[^>]*covered="(\d+)"[^>]*missed="(\d+)"/);

		const linesCovered = lineMatch ? parseInt(lineMatch[1]) : 0;
		const linesMissed = lineMatch ? parseInt(lineMatch[2]) : 0;
		const branchesCovered = branchMatch ? parseInt(branchMatch[1]) : 0;
		const branchesMissed = branchMatch ? parseInt(branchMatch[2]) : 0;
		const methodsCovered = methodMatch ? parseInt(methodMatch[1]) : 0;
		const methodsMissed = methodMatch ? parseInt(methodMatch[2]) : 0;

		const linesTotal = linesCovered + linesMissed;
		const branchesTotal = branchesCovered + branchesMissed;
		const methodsTotal = methodsCovered + methodsMissed;

		return {
			lines: {
				total: linesTotal,
				covered: linesCovered,
				percentage: linesTotal > 0 ? (linesCovered / linesTotal) * 100 : 0
			},
			branches: {
				total: branchesTotal,
				covered: branchesCovered,
				percentage: branchesTotal > 0 ? (branchesCovered / branchesTotal) * 100 : 0
			},
			functions: {
				total: methodsTotal,
				covered: methodsCovered,
				percentage: methodsTotal > 0 ? (methodsCovered / methodsTotal) * 100 : 0
			},
			statements: {
				total: linesTotal,
				covered: linesCovered,
				percentage: linesTotal > 0 ? (linesCovered / linesTotal) * 100 : 0
			},
			files
		};
	}

	/**
	 * Parse Cobertura XML coverage (Python)
	 */
	private parseCoberturaCoverage(text: string): CoverageData {
		// Simplified regex-based parsing

		const files = new Map<string, FileCoverage>();

		// Extract overall metrics
		const coverageMatch = text.match(/<coverage[^>]*line-rate="([0-9.]+)"[^>]*branch-rate="([0-9.]+)"/);

		const lineRate = coverageMatch ? parseFloat(coverageMatch[1]) : 0;
		const branchRate = coverageMatch ? parseFloat(coverageMatch[2]) : 0;

		return {
			lines: {
				total: 100,
				covered: Math.round(lineRate * 100),
				percentage: lineRate * 100
			},
			branches: {
				total: 100,
				covered: Math.round(branchRate * 100),
				percentage: branchRate * 100
			},
			functions: {
				total: 0,
				covered: 0,
				percentage: 0
			},
			statements: {
				total: 100,
				covered: Math.round(lineRate * 100),
				percentage: lineRate * 100
			},
			files
		};
	}

	/**
	 * Parse LCOV coverage format
	 */
	private parseLcovCoverage(text: string): CoverageData {
		const files = new Map<string, FileCoverage>();
		let totalLines = 0;
		let coveredLines = 0;
		let totalBranches = 0;
		let coveredBranches = 0;
		let totalFunctions = 0;
		let coveredFunctions = 0;

		// Parse LCOV format line by line
		const lines = text.split('\n');
		// let currentFile: string | null = null;

		for (const line of lines) {
			// if (line.startsWith('SF:')) {
			// 	currentFile = line.substring(3);
			// }
			if (line.startsWith('LH:')) {
				coveredLines += parseInt(line.substring(3));
			} else if (line.startsWith('LF:')) {
				totalLines += parseInt(line.substring(3));
			} else if (line.startsWith('BRH:')) {
				coveredBranches += parseInt(line.substring(4));
			} else if (line.startsWith('BRF:')) {
				totalBranches += parseInt(line.substring(4));
			} else if (line.startsWith('FNH:')) {
				coveredFunctions += parseInt(line.substring(4));
			} else if (line.startsWith('FNF:')) {
				totalFunctions += parseInt(line.substring(4));
			}
		}

		return {
			lines: {
				total: totalLines,
				covered: coveredLines,
				percentage: totalLines > 0 ? (coveredLines / totalLines) * 100 : 0
			},
			branches: {
				total: totalBranches,
				covered: coveredBranches,
				percentage: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0
			},
			functions: {
				total: totalFunctions,
				covered: coveredFunctions,
				percentage: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0
			},
			statements: {
				total: totalLines,
				covered: coveredLines,
				percentage: totalLines > 0 ? (coveredLines / totalLines) * 100 : 0
			},
			files
		};
	}

	/**
	 * Parse Go coverage format
	 */
	private parseGoCoverage(text: string): CoverageData {
		const files = new Map<string, FileCoverage>();
		let totalBlocks = 0;
		let coveredBlocks = 0;

		// Parse Go coverage format
		// Format: file.go:line.column,line.column statements count
		const lines = text.split('\n');

		for (const line of lines) {
			if (line.startsWith('mode:')) {
				continue;
			}

			const match = line.match(/^(.+):(\d+)\.(\d+),(\d+)\.(\d+) (\d+) (\d+)$/);
			if (match) {
				const count = parseInt(match[7]);
				totalBlocks++;
				if (count > 0) {
					coveredBlocks++;
				}
			}
		}

		return {
			lines: {
				total: totalBlocks,
				covered: coveredBlocks,
				percentage: totalBlocks > 0 ? (coveredBlocks / totalBlocks) * 100 : 0
			},
			branches: {
				total: 0,
				covered: 0,
				percentage: 0
			},
			functions: {
				total: 0,
				covered: 0,
				percentage: 0
			},
			statements: {
				total: totalBlocks,
				covered: coveredBlocks,
				percentage: totalBlocks > 0 ? (coveredBlocks / totalBlocks) * 100 : 0
			},
			files
		};
	}

	/**
	 * Log coverage summary
	 */
	private logCoverageSummary(coverage: CoverageData): void {
		console.log('[Coverage Collector] Coverage Summary:');
		console.log(`  Lines: ${coverage.lines.covered}/${coverage.lines.total} (${coverage.lines.percentage.toFixed(2)}%)`);
		console.log(`  Branches: ${coverage.branches.covered}/${coverage.branches.total} (${coverage.branches.percentage.toFixed(2)}%)`);
		console.log(`  Functions: ${coverage.functions.covered}/${coverage.functions.total} (${coverage.functions.percentage.toFixed(2)}%)`);
		console.log(`  Statements: ${coverage.statements.covered}/${coverage.statements.total} (${coverage.statements.percentage.toFixed(2)}%)`);
	}
}
