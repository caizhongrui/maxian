/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { TestFramework, TestDiscoveryResult, TestSuite, TestCase, TestStatus } from './testingTypes.js';
import { IFileService } from '../../../../platform/files/common/files.js';

/**
 * Test discovery service
 * Discovers test files and test cases in the workspace
 */
export class TestDiscovery {

	constructor(
		private readonly fileService: IFileService
	) { }

	/**
	 * Discover all tests in a workspace folder
	 */
	async discoverTests(workspaceUri: URI): Promise<TestDiscoveryResult> {
		console.log('[Test Discovery] Starting test discovery in:', workspaceUri.fsPath);

		// Detect test framework
		const framework = await this.detectFramework(workspaceUri);
		console.log('[Test Discovery] Detected framework:', framework);

		// Find test files
		const testFiles = await this.findTestFiles(workspaceUri, framework);
		console.log('[Test Discovery] Found', testFiles.length, 'test files');

		// Parse test files to extract test cases
		const tests: TestSuite[] = [];
		const errors: string[] = [];

		for (const testFile of testFiles) {
			try {
				const suite = await this.parseTestFile(testFile, framework);
				if (suite) {
					tests.push(suite);
				}
			} catch (error) {
				errors.push(`Failed to parse ${testFile.fsPath}: ${error}`);
				console.error('[Test Discovery] Parse error:', error);
			}
		}

		return {
			tests,
			framework,
			testFiles,
			errors
		};
	}

	/**
	 * Detect test framework based on project files
	 */
	private async detectFramework(workspaceUri: URI): Promise<TestFramework> {
		try {
			// Check package.json for Node.js projects
			const packageJsonUri = URI.joinPath(workspaceUri, 'package.json');
			const packageJsonStat = await this.fileService.resolve(packageJsonUri);

			if (packageJsonStat) {
				// Read package.json content
				const content = await this.fileService.readFile(packageJsonUri);
				const packageJson = JSON.parse(content.value.toString());

				// Check dependencies
				const allDeps = {
					...packageJson.dependencies,
					...packageJson.devDependencies
				};

				if (allDeps.vitest) {
					return TestFramework.Vitest;
				}
				if (allDeps.jest || allDeps['@jest/core']) {
					return TestFramework.Jest;
				}
				if (allDeps.mocha) {
					return TestFramework.Mocha;
				}
			}
		} catch (error) {
			// package.json not found or invalid
		}

		// Check for Python projects
		try {
			const requirementsUri = URI.joinPath(workspaceUri, 'requirements.txt');
			const requirementsStat = await this.fileService.resolve(requirementsUri);
			if (requirementsStat) {
				return TestFramework.Pytest;
			}
		} catch (error) {
			// requirements.txt not found
		}

		// Check for Java projects
		try {
			const pomUri = URI.joinPath(workspaceUri, 'pom.xml');
			const pomStat = await this.fileService.resolve(pomUri);
			if (pomStat) {
				return TestFramework.JUnit;
			}
		} catch (error) {
			// pom.xml not found
		}

		// Check for Go projects
		try {
			const goModUri = URI.joinPath(workspaceUri, 'go.mod');
			const goModStat = await this.fileService.resolve(goModUri);
			if (goModStat) {
				return TestFramework.Go;
			}
		} catch (error) {
			// go.mod not found
		}

		// Check for Rust projects
		try {
			const cargoUri = URI.joinPath(workspaceUri, 'Cargo.toml');
			const cargoStat = await this.fileService.resolve(cargoUri);
			if (cargoStat) {
				return TestFramework.Cargo;
			}
		} catch (error) {
			// Cargo.toml not found
		}

		return TestFramework.Unknown;
	}

	/**
	 * Find test files based on framework conventions
	 */
	private async findTestFiles(workspaceUri: URI, framework: TestFramework): Promise<URI[]> {
		const testFiles: URI[] = [];
		const patterns = this.getTestFilePatterns(framework);

		await this.collectTestFiles(workspaceUri, patterns, testFiles);

		return testFiles;
	}

	/**
	 * Get test file patterns for a framework
	 */
	private getTestFilePatterns(framework: TestFramework): RegExp[] {
		switch (framework) {
			case TestFramework.Jest:
			case TestFramework.Vitest:
			case TestFramework.Mocha:
				return [
					/\.test\.(ts|tsx|js|jsx)$/,
					/\.spec\.(ts|tsx|js|jsx)$/,
					/__tests__\/.*\.(ts|tsx|js|jsx)$/
				];
			case TestFramework.Pytest:
				return [
					/^test_.*\.py$/,
					/.*_test\.py$/
				];
			case TestFramework.JUnit:
				return [
					/Test\.java$/,
					/.*Tests\.java$/
				];
			case TestFramework.Go:
				return [
					/_test\.go$/
				];
			case TestFramework.Cargo:
				return [
					/tests\/.*\.rs$/,
					/.*_test\.rs$/
				];
			default:
				return [
					/\.test\./,
					/\.spec\./,
					/_test\./,
					/Test\./
				];
		}
	}

	/**
	 * Recursively collect test files
	 */
	private async collectTestFiles(uri: URI, patterns: RegExp[], result: URI[]): Promise<void> {
		try {
			const stat = await this.fileService.resolve(uri);

			if (stat.isDirectory) {
				// Skip common directories
				const skipDirs = ['node_modules', '.git', 'dist', 'build', 'out', 'target', 'coverage', '.vscode'];
				const dirName = uri.path.split('/').pop() || '';
				if (skipDirs.includes(dirName)) {
					return;
				}

				// Recurse into children
				if (stat.children) {
					for (const child of stat.children) {
						await this.collectTestFiles(child.resource, patterns, result);
					}
				}
			} else {
				// Check if file matches test patterns
				const fileName = uri.path.split('/').pop() || '';
				if (patterns.some(pattern => pattern.test(fileName))) {
					result.push(uri);
				}
			}
		} catch (error) {
			console.error(`[Test Discovery] Error accessing ${uri.fsPath}:`, error);
		}
	}

	/**
	 * Parse a test file to extract test cases
	 * Note: This is a simplified implementation
	 * In a real implementation, we would use AST parsing
	 */
	private async parseTestFile(fileUri: URI, framework: TestFramework): Promise<TestSuite | null> {
		try {
			const content = await this.fileService.readFile(fileUri);
			const text = content.value.toString();

			const tests: TestCase[] = [];
			const suites: TestSuite[] = [];

			// Simple regex-based parsing (would use AST in production)
			switch (framework) {
				case TestFramework.Jest:
				case TestFramework.Vitest:
				case TestFramework.Mocha:
					this.parseJestLikeTests(text, fileUri.fsPath, tests);
					break;
				case TestFramework.Pytest:
					this.parsePytestTests(text, fileUri.fsPath, tests);
					break;
				case TestFramework.JUnit:
					this.parseJUnitTests(text, fileUri.fsPath, tests);
					break;
				case TestFramework.Go:
					this.parseGoTests(text, fileUri.fsPath, tests);
					break;
				case TestFramework.Cargo:
					this.parseCargoTests(text, fileUri.fsPath, tests);
					break;
			}

			if (tests.length === 0) {
				return null;
			}

			return {
				id: fileUri.fsPath,
				name: fileUri.path.split('/').pop() || 'Unknown',
				filePath: fileUri.fsPath,
				tests,
				suites,
				status: TestStatus.Pending
			};
		} catch (error) {
			console.error(`[Test Discovery] Failed to parse ${fileUri.fsPath}:`, error);
			return null;
		}
	}

	/**
	 * Parse Jest/Vitest/Mocha style tests
	 */
	private parseJestLikeTests(text: string, filePath: string, tests: TestCase[]): void {
		// Match: test('name', ...) or it('name', ...)
		const testRegex = /(?:test|it)\s*\(\s*['"`]([^'"`]+)['"`]/g;
		let match;
		let index = 0;

		while ((match = testRegex.exec(text)) !== null) {
			const testName = match[1];
			const line = text.substring(0, match.index).split('\n').length;

			tests.push({
				id: `${filePath}::${index}`,
				name: testName,
				filePath,
				line,
				status: TestStatus.Pending
			});
			index++;
		}
	}

	/**
	 * Parse Pytest style tests
	 */
	private parsePytestTests(text: string, filePath: string, tests: TestCase[]): void {
		// Match: def test_name(...):
		const testRegex = /def\s+(test_\w+)\s*\(/g;
		let match;
		let index = 0;

		while ((match = testRegex.exec(text)) !== null) {
			const testName = match[1];
			const line = text.substring(0, match.index).split('\n').length;

			tests.push({
				id: `${filePath}::${testName}`,
				name: testName,
				filePath,
				line,
				status: TestStatus.Pending
			});
			index++;
		}
	}

	/**
	 * Parse JUnit style tests
	 */
	private parseJUnitTests(text: string, filePath: string, tests: TestCase[]): void {
		// Match: @Test ... public void testName()
		const testRegex = /@Test[\s\S]*?public\s+void\s+(\w+)\s*\(/g;
		let match;
		let index = 0;

		while ((match = testRegex.exec(text)) !== null) {
			const testName = match[1];
			const line = text.substring(0, match.index).split('\n').length;

			tests.push({
				id: `${filePath}::${testName}`,
				name: testName,
				filePath,
				line,
				status: TestStatus.Pending
			});
			index++;
		}
	}

	/**
	 * Parse Go style tests
	 */
	private parseGoTests(text: string, filePath: string, tests: TestCase[]): void {
		// Match: func TestName(t *testing.T)
		const testRegex = /func\s+(Test\w+)\s*\(\s*t\s+\*testing\.T\s*\)/g;
		let match;

		while ((match = testRegex.exec(text)) !== null) {
			const testName = match[1];
			const line = text.substring(0, match.index).split('\n').length;

			tests.push({
				id: `${filePath}::${testName}`,
				name: testName,
				filePath,
				line,
				status: TestStatus.Pending
			});
		}
	}

	/**
	 * Parse Rust/Cargo style tests
	 */
	private parseCargoTests(text: string, filePath: string, tests: TestCase[]): void {
		// Match: #[test] fn test_name()
		const testRegex = /#\[test\][\s\S]*?fn\s+(\w+)\s*\(/g;
		let match;

		while ((match = testRegex.exec(text)) !== null) {
			const testName = match[1];
			const line = text.substring(0, match.index).split('\n').length;

			tests.push({
				id: `${filePath}::${testName}`,
				name: testName,
				filePath,
				line,
				status: TestStatus.Pending
			});
		}
	}
}
