/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IProgress, IProgressService, IProgressStep, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { TestDiscovery } from '../common/testDiscovery.js';
import { TestGenerator } from '../common/testGenerator.js';
import { TestFramework, TestDiscoveryResult } from '../common/testingTypes.js';
import { URI } from '../../../../base/common/uri.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';

/**
 * Action to discover tests in workspace
 */
class DiscoverTestsAction extends Action2 {
	constructor() {
		super({
			id: 'customTesting.discoverTests',
			title: {
				value: localize('discoverTests', "Discover Tests"),
				original: 'Discover Tests'
			},
			category: Categories.Test,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const fileService = accessor.get(IFileService);
		const progressService = accessor.get(IProgressService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const notificationService = accessor.get(INotificationService);

		// Get workspace folder
		const workspaceFolders = workspaceService.getWorkspace().folders;
		if (workspaceFolders.length === 0) {
			notificationService.warn(localize('noWorkspace', "No workspace folder open"));
			return;
		}

		const workspaceUri = workspaceFolders[0].uri;

		await progressService.withProgress(
			{
				location: ProgressLocation.Notification,
				title: localize('discoveringTests', "Discovering tests..."),
				cancellable: false
			},
			async (progress: IProgress<IProgressStep>) => {
				try {
					// Create test discovery service
					const testDiscovery = new TestDiscovery(fileService);

					// Discover tests
					progress.report({ message: localize('analyzingWorkspace', "Analyzing workspace...") });
					const result = await testDiscovery.discoverTests(workspaceUri);

					// Show results
					this.showDiscoveryResults(result, notificationService);
				} catch (error) {
					notificationService.error(
						localize('discoveryFailed', "Test discovery failed: {0}", error instanceof Error ? error.message : String(error))
					);
				}
			}
		);
	}

	private showDiscoveryResults(result: TestDiscoveryResult, notificationService: INotificationService): void {
		const testCount = result.tests.reduce((sum, suite) => sum + suite.tests.length, 0);
		const fileCount = result.testFiles.length;

		if (testCount === 0) {
			notificationService.info(
				localize('noTestsFound', "No tests found in workspace")
			);
		} else {
			notificationService.info(
				localize(
					'testsDiscovered',
					"Found {0} tests in {1} files (Framework: {2})",
					testCount,
					fileCount,
					result.framework
				)
			);
		}

		if (result.errors.length > 0) {
			console.warn('[Test Discovery] Errors:', result.errors);
		}
	}
}

/**
 * Action to run all tests in workspace
 */
class RunAllTestsAction extends Action2 {
	constructor() {
		super({
			id: 'customTesting.runAllTests',
			title: {
				value: localize('runAllTests', "Run All Tests"),
				original: 'Run All Tests'
			},
			category: Categories.Test,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const fileService = accessor.get(IFileService);
		const progressService = accessor.get(IProgressService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const notificationService = accessor.get(INotificationService);

		// Get workspace folder
		const workspaceFolders = workspaceService.getWorkspace().folders;
		if (workspaceFolders.length === 0) {
			notificationService.warn(localize('noWorkspace', "No workspace folder open"));
			return;
		}

		const workspaceUri = workspaceFolders[0].uri;

		await progressService.withProgress(
			{
				location: ProgressLocation.Notification,
				title: localize('runningTests', "Running tests..."),
				cancellable: true
			},
			async (progress: IProgress<IProgressStep>) => {
				try {
					// Step 1: Discover tests
					progress.report({ message: localize('discoveringTests', "Discovering tests...") });
					const testDiscovery = new TestDiscovery(fileService);
					const discoveryResult = await testDiscovery.discoverTests(workspaceUri);

					if (discoveryResult.tests.length === 0) {
						notificationService.info(localize('noTestsToRun', "No tests to run"));
						return;
					}

					// Test execution is not implemented yet
					// Show message to user
					notificationService.info(
						localize(
							'testExecutionNotImplemented',
							"Found {0} test suites using {1}. Test execution requires terminal integration (not yet implemented).",
							discoveryResult.tests.length,
							discoveryResult.framework
						)
					);
				} catch (error) {
					notificationService.error(
						localize('testRunFailed', "Test run failed: {0}", error instanceof Error ? error.message : String(error))
					);
				}
			}
		);
	}
}

/**
 * Action to run tests with coverage
 */
class RunTestsWithCoverageAction extends Action2 {
	constructor() {
		super({
			id: 'customTesting.runTestsWithCoverage',
			title: {
				value: localize('runTestsWithCoverage', "Run Tests with Coverage"),
				original: 'Run Tests with Coverage'
			},
			category: Categories.Test,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const fileService = accessor.get(IFileService);
		const progressService = accessor.get(IProgressService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const notificationService = accessor.get(INotificationService);

		// Get workspace folder
		const workspaceFolders = workspaceService.getWorkspace().folders;
		if (workspaceFolders.length === 0) {
			notificationService.warn(localize('noWorkspace', "No workspace folder open"));
			return;
		}

		const workspaceUri = workspaceFolders[0].uri;

		await progressService.withProgress(
			{
				location: ProgressLocation.Notification,
				title: localize('runningTestsWithCoverage', "Running tests with coverage..."),
				cancellable: true
			},
			async (progress: IProgress<IProgressStep>) => {
				try {
					// Step 1: Discover tests
					progress.report({ message: localize('discoveringTests', "Discovering tests...") });
					const testDiscovery = new TestDiscovery(fileService);
					const discoveryResult = await testDiscovery.discoverTests(workspaceUri);

					if (discoveryResult.tests.length === 0) {
						notificationService.info(localize('noTestsToRun', "No tests to run"));
						return;
					}

					// Test execution with coverage is not implemented yet
					// Show message to user
					notificationService.info(
						localize(
							'coverageTestExecutionNotImplemented',
							"Found {0} test suites using {1}. Test execution with coverage requires terminal integration (not yet implemented).",
							discoveryResult.tests.length,
							discoveryResult.framework
						)
					);
				} catch (error) {
					notificationService.error(
						localize('testRunFailed', "Test run with coverage failed: {0}", error instanceof Error ? error.message : String(error))
					);
				}
			}
		);
	}
}

/**
 * Action to run tests on a specific folder
 */
class RunFolderTestsAction extends Action2 {
	constructor() {
		super({
			id: 'customTesting.runFolderTests',
			title: {
				value: localize('runFolderTests', "Run Tests in Folder"),
				original: 'Run Tests in Folder'
			},
			category: Categories.Test,
			menu: [
				{
					id: MenuId.ExplorerContext,
					group: '2_workspace',
					order: 40
				}
			]
		});
	}

	async run(accessor: ServicesAccessor, uri?: URI): Promise<void> {
		const fileService = accessor.get(IFileService);
		const progressService = accessor.get(IProgressService);
		const notificationService = accessor.get(INotificationService);

		if (!uri) {
			notificationService.warn(localize('noFolderSelected', "No folder selected"));
			return;
		}

		// Check if it's a directory
		try {
			const stat = await fileService.resolve(uri);
			if (!stat.isDirectory) {
				notificationService.warn(localize('notAFolder', "Selected item is not a folder"));
				return;
			}
		} catch (error) {
			notificationService.error(localize('folderAccessError', "Cannot access folder"));
			return;
		}

		await progressService.withProgress(
			{
				location: ProgressLocation.Notification,
				title: localize('runningFolderTests', "Running tests in folder..."),
				cancellable: true
			},
			async (progress: IProgress<IProgressStep>) => {
				try {
					// Step 1: Discover tests
					const testDiscovery = new TestDiscovery(fileService);
					const discoveryResult = await testDiscovery.discoverTests(uri);

					if (discoveryResult.tests.length === 0) {
						notificationService.info(localize('noTestsInFolder', "No tests found in folder"));
						return;
					}

					// Test execution is not implemented yet
					// Show message to user
					notificationService.info(
						localize(
							'folderTestExecutionNotImplemented',
							"Found {0} test suites in folder using {1}. Test execution requires terminal integration (not yet implemented).",
							discoveryResult.tests.length,
							discoveryResult.framework
						)
					);
				} catch (error) {
					notificationService.error(
						localize('folderTestRunFailed', "Folder test run failed: {0}", error instanceof Error ? error.message : String(error))
					);
				}
			}
		);
	}
}

/**
 * Action to generate tests for workspace/folder
 */
class GenerateTestsAction extends Action2 {
	constructor() {
		super({
			id: 'customTesting.generateTests',
			title: {
				value: localize('generateTests', "Generate Tests"),
				original: 'Generate Tests'
			},
			category: Categories.Test,
			f1: true,
			menu: [
				{
					id: MenuId.ExplorerContext,
					group: '2_workspace',
					order: 39
				}
			]
		});
	}

	async run(accessor: ServicesAccessor, uri?: URI): Promise<void> {
		const fileService = accessor.get(IFileService);
		const progressService = accessor.get(IProgressService);
		const workspaceService = accessor.get(IWorkspaceContextService);
		const notificationService = accessor.get(INotificationService);
		const aiService = accessor.get(IAIService);

		// Determine target URI (folder from context or workspace)
		let targetUri: URI;
		if (uri) {
			targetUri = uri;
		} else {
			const workspaceFolders = workspaceService.getWorkspace().folders;
			if (workspaceFolders.length === 0) {
				notificationService.warn(localize('noWorkspace', "No workspace folder open"));
				return;
			}
			targetUri = workspaceFolders[0].uri;
		}

		await progressService.withProgress(
			{
				location: ProgressLocation.Notification,
				title: localize('generatingTests', "Generating tests with AI..."),
				cancellable: false
			},
			async (progress: IProgress<IProgressStep>) => {
				try {
					// Step 1: Detect framework
					progress.report({ message: localize('detectingFramework', "Detecting test framework...") });
					const testDiscovery = new TestDiscovery(fileService);
					let framework = await testDiscovery.discoverTests(targetUri).then(r => r.framework);

					// If framework unknown, try to infer from file extension
					if (framework === TestFramework.Unknown) {
						framework = await this.inferFrameworkFromFiles(fileService, targetUri);
					}

					if (framework === TestFramework.Unknown) {
						notificationService.warn(
							localize('unknownFramework', "Could not detect test framework. Please ensure your project has test framework dependencies or source files (.ts, .js, .py, .java, .go, .rs).")
						);
						return;
					}

					// Step 2: Generate tests with AI
					progress.report({ message: localize('generatingTestFiles', "Generating test files with AI...") });
					const testGenerator = new TestGenerator(fileService, aiService);
					const result = await testGenerator.generateTests(targetUri, framework);

					// Step 3: Show results
					if (result.generatedFiles.length === 0) {
						if (result.errors.length > 0) {
							notificationService.error(
								localize('testGenerationFailedWithErrors', "Test generation failed: {0}", result.errors[0])
							);
						} else {
							notificationService.info(
								localize('noFilesToGenerate', "No new test files to generate. Test files may already exist.")
							);
						}
					} else {
						notificationService.info(
							localize(
								'testsGenerated',
								"Generated {0} test files for framework: {1}",
								result.generatedFiles.length,
								framework
							)
						);
					}

					if (result.errors.length > 0) {
						console.warn('[Test Generator] Errors:', result.errors);
					}
				} catch (error) {
					notificationService.error(
						localize('testGenerationFailed', "Test generation failed: {0}", error instanceof Error ? error.message : String(error))
					);
				}
			}
		);
	}

	/**
	 * Infer test framework from file extensions in the directory
	 */
	private async inferFrameworkFromFiles(fileService: IFileService, uri: URI): Promise<TestFramework> {
		try {
			// Count files by extension
			const extensions = new Map<string, number>();
			await this.countFileExtensions(fileService, uri, extensions);

			console.log('[Test Generator] File extensions found:', Array.from(extensions.entries()));

			// Determine framework based on dominant file type
			const tsCount = (extensions.get('.ts') || 0) + (extensions.get('.tsx') || 0);
			const jsCount = (extensions.get('.js') || 0) + (extensions.get('.jsx') || 0);
			const pyCount = extensions.get('.py') || 0;
			const javaCount = extensions.get('.java') || 0;
			const goCount = extensions.get('.go') || 0;
			const rsCount = extensions.get('.rs') || 0;

			// Return the framework for the dominant file type
			if (tsCount + jsCount > 0) {
				return TestFramework.Jest; // Default to Jest for TypeScript/JavaScript
			}
			if (pyCount > 0) {
				return TestFramework.Pytest;
			}
			if (javaCount > 0) {
				return TestFramework.JUnit;
			}
			if (goCount > 0) {
				return TestFramework.Go;
			}
			if (rsCount > 0) {
				return TestFramework.Cargo;
			}

			return TestFramework.Unknown;
		} catch (error) {
			console.error('[Test Generator] Error inferring framework:', error);
			return TestFramework.Unknown;
		}
	}

	/**
	 * Recursively count file extensions in a directory
	 */
	private async countFileExtensions(
		fileService: IFileService,
		uri: URI,
		extensions: Map<string, number>
	): Promise<void> {
		try {
			const stat = await fileService.resolve(uri);

			if (stat.isDirectory && stat.children) {
				// Skip common directories
				const dirName = uri.path.split('/').pop() || '';
				const skipDirs = ['node_modules', '.git', 'dist', 'build', 'out', 'target', 'coverage'];
				if (skipDirs.includes(dirName)) {
					return;
				}

				// Recurse into children
				for (const child of stat.children) {
					await this.countFileExtensions(fileService, child.resource, extensions);
				}
			} else {
				// Count file extension
				const fileName = uri.path.split('/').pop() || '';
				const match = fileName.match(/\.(ts|tsx|js|jsx|py|java|go|rs)$/);
				if (match) {
					const ext = match[0];
					extensions.set(ext, (extensions.get(ext) || 0) + 1);
				}
			}
		} catch (error) {
			// Ignore errors accessing files
		}
	}
}

// Register all actions
export function registerCustomTestActions(): void {
	registerAction2(DiscoverTestsAction);
	registerAction2(RunAllTestsAction);
	registerAction2(RunTestsWithCoverageAction);
	registerAction2(RunFolderTestsAction);
	registerAction2(GenerateTestsAction);
}
