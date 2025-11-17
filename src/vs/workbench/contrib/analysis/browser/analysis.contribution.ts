/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IMarkerService, IMarkerData, MarkerSeverity } from '../../../../platform/markers/common/markers.js';
import { URI } from '../../../../base/common/uri.js';
import { IMultiLanguageService } from '../../multilang/browser/multilang.contribution.js';
import { QualityAnalyzer } from '../common/qualityAnalyzer.js';
import { SecurityAnalyzer } from '../common/securityAnalyzer.js';
import { PerformanceAnalyzer } from '../common/performanceAnalyzer.js';
import { ComplexityAnalyzer } from '../common/complexityAnalyzer.js';
import { DependencyAnalyzer } from '../common/dependencyAnalyzer.js';
import { CoverageAnalyzer } from '../common/coverageAnalyzer.js';
import { TechnicalDebtAnalyzer } from '../common/technicalDebtAnalyzer.js';
import { AnalysisIssue, AnalysisResult, IssueSeverity, IssueCategory } from '../common/analysisTypes.js';
import { localize } from '../../../../nls.js';
import { Action2, registerAction2, MenuId } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ITreeSitterParserService } from '../../../../editor/common/services/treeSitterParserService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

/**
 * Main code analysis contribution
 * Phase 3.5: Code Analysis System
 */
class CodeAnalysisContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.codeAnalysis';

	private qualityAnalyzer: QualityAnalyzer;
	private securityAnalyzer: SecurityAnalyzer;
	private performanceAnalyzer: PerformanceAnalyzer;
	private complexityAnalyzer: ComplexityAnalyzer;
	private dependencyAnalyzer: DependencyAnalyzer;
	private coverageAnalyzer: CoverageAnalyzer;
	private technicalDebtAnalyzer: TechnicalDebtAnalyzer;

	constructor(
		@IEditorService _editorService: IEditorService,
		@IMarkerService private readonly markerService: IMarkerService,
		@IMultiLanguageService multiLanguageService: IMultiLanguageService,
		@ITreeSitterParserService treeSitterService: ITreeSitterParserService
	) {
		super();

		// Initialize all analyzers
		this.qualityAnalyzer = new QualityAnalyzer(multiLanguageService, treeSitterService);
		this.securityAnalyzer = new SecurityAnalyzer();
		this.performanceAnalyzer = new PerformanceAnalyzer();
		this.complexityAnalyzer = new ComplexityAnalyzer(multiLanguageService, treeSitterService);
		this.dependencyAnalyzer = new DependencyAnalyzer(multiLanguageService);
		this.coverageAnalyzer = new CoverageAnalyzer();
		this.technicalDebtAnalyzer = new TechnicalDebtAnalyzer();
	}

	/**
	 * Run all analysis on a file
	 */
	async analyzeFile(model: ITextModel, filePath: string): Promise<AnalysisResult> {
		const allIssues: AnalysisIssue[] = [];

		try {
			// Run all analyzers in parallel
			const [
				qualityIssues,
				securityIssues,
				performanceIssues,
				complexityIssues,
				dependencyIssues,
				coverageIssues,
				technicalDebtIssues
			] = await Promise.all([
				this.qualityAnalyzer.analyze(model, filePath),
				this.securityAnalyzer.analyze(model, filePath),
				this.performanceAnalyzer.analyze(model, filePath),
				this.complexityAnalyzer.analyze(model, filePath),
				this.dependencyAnalyzer.analyze(model, filePath),
				this.coverageAnalyzer.analyze(model, filePath),
				this.technicalDebtAnalyzer.analyze(model, filePath)
			]);

			allIssues.push(...qualityIssues);
			allIssues.push(...securityIssues);
			allIssues.push(...performanceIssues);
			allIssues.push(...complexityIssues);
			allIssues.push(...dependencyIssues);
			allIssues.push(...coverageIssues);
			allIssues.push(...technicalDebtIssues);

			// Update markers
			this.updateMarkers(filePath, allIssues);

			// Generate summary
			const summary = this.generateSummary(allIssues);

			return {
				timestamp: Date.now(),
				issues: allIssues,
				summary
			};
		} catch (error) {
			return {
				timestamp: Date.now(),
				issues: [],
				summary: {
					total: 0,
					errors: 0,
					warnings: 0,
					infos: 0,
					byCategory: {
						[IssueCategory.Quality]: 0,
						[IssueCategory.Security]: 0,
						[IssueCategory.Performance]: 0,
						[IssueCategory.Complexity]: 0,
						[IssueCategory.Dependency]: 0,
						[IssueCategory.Coverage]: 0,
						[IssueCategory.TechnicalDebt]: 0
					}
				}
			};
		}
	}

	/**
	 * Update VS Code markers (Problems panel)
	 */
	private updateMarkers(filePath: string, issues: AnalysisIssue[]): void {
		const uri = URI.file(filePath);
		const markers: IMarkerData[] = issues.map(issue => ({
			severity: this.toMarkerSeverity(issue.severity),
			message: issue.message,
			startLineNumber: issue.range?.startLineNumber || 1,
			startColumn: issue.range?.startColumn || 1,
			endLineNumber: issue.range?.endLineNumber || 1,
			endColumn: issue.range?.endColumn || 1,
			source: `Code Analysis [${issue.category}]`,
			code: issue.code
		}));

		this.markerService.changeOne('codeAnalysis', uri, markers);
	}

	/**
	 * Convert issue severity to VS Code marker severity
	 */
	private toMarkerSeverity(severity: IssueSeverity): MarkerSeverity {
		switch (severity) {
			case IssueSeverity.Error:
				return MarkerSeverity.Error;
			case IssueSeverity.Warning:
				return MarkerSeverity.Warning;
			case IssueSeverity.Info:
				return MarkerSeverity.Info;
			default:
				return MarkerSeverity.Info;
		}
	}

	/**
	 * Generate summary of all issues
	 */
	private generateSummary(issues: AnalysisIssue[]) {
		const summary = {
			total: issues.length,
			errors: 0,
			warnings: 0,
			infos: 0,
			byCategory: {
				[IssueCategory.Quality]: 0,
				[IssueCategory.Security]: 0,
				[IssueCategory.Performance]: 0,
				[IssueCategory.Complexity]: 0,
				[IssueCategory.Dependency]: 0,
				[IssueCategory.Coverage]: 0,
				[IssueCategory.TechnicalDebt]: 0
			}
		};

		for (const issue of issues) {
			// Count by severity
			if (issue.severity === IssueSeverity.Error) {
				summary.errors++;
			} else if (issue.severity === IssueSeverity.Warning) {
				summary.warnings++;
			} else {
				summary.infos++;
			}

			// Count by category
			summary.byCategory[issue.category]++;
		}

		return summary;
	}
}

/**
 * Action to run code analysis on current file
 */
class RunCodeAnalysisAction extends Action2 {
	constructor() {
		super({
			id: 'codeAnalysis.runAnalysis',
			title: {
				value: localize('runCodeAnalysis', "Run Code Analysis"),
				original: 'Run Code Analysis'
			},
			precondition: ContextKeyExpr.and(
				EditorContextKeys.editorTextFocus,
				EditorContextKeys.hasNonEmptySelection.negate()
			),
			menu: [
				{
					id: MenuId.EditorContext,
					group: '1_modification',
					order: 11
				}
			],
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const codeEditorService = accessor.get(ICodeEditorService);
		const markerService = accessor.get(IMarkerService);
		const multiLanguageService = accessor.get(IMultiLanguageService);
		const treeSitterService = accessor.get(ITreeSitterParserService);
		const editor = codeEditorService.getActiveCodeEditor();

		if (!editor) {
			return;
		}

		const model = editor.getModel();
		if (!model) {
			return;
		}

		const filePath = model.uri.fsPath;

		// Create temporary analyzers for this analysis run
		const qualityAnalyzer = new QualityAnalyzer(multiLanguageService, treeSitterService);
		const securityAnalyzer = new SecurityAnalyzer();
		const performanceAnalyzer = new PerformanceAnalyzer();
		const complexityAnalyzer = new ComplexityAnalyzer(multiLanguageService, treeSitterService);
		const dependencyAnalyzer = new DependencyAnalyzer(multiLanguageService);
		const coverageAnalyzer = new CoverageAnalyzer();
		const technicalDebtAnalyzer = new TechnicalDebtAnalyzer();

		try {
			// Run all analyzers in parallel
			const [
				qualityIssues,
				securityIssues,
				performanceIssues,
				complexityIssues,
				dependencyIssues,
				coverageIssues,
				technicalDebtIssues
			] = await Promise.all([
				qualityAnalyzer.analyze(model, filePath),
				securityAnalyzer.analyze(model, filePath),
				performanceAnalyzer.analyze(model, filePath),
				complexityAnalyzer.analyze(model, filePath),
				dependencyAnalyzer.analyze(model, filePath),
				coverageAnalyzer.analyze(model, filePath),
				technicalDebtAnalyzer.analyze(model, filePath)
			]);

			const allIssues = [
				...qualityIssues,
				...securityIssues,
				...performanceIssues,
				...complexityIssues,
				...dependencyIssues,
				...coverageIssues,
				...technicalDebtIssues
			];

			// Update markers in Problems panel
			const uri = model.uri;
			const markers: IMarkerData[] = allIssues.map(issue => ({
				severity: issue.severity === IssueSeverity.Error ? MarkerSeverity.Error :
					issue.severity === IssueSeverity.Warning ? MarkerSeverity.Warning :
						MarkerSeverity.Info,
				message: issue.message,
				startLineNumber: issue.range?.startLineNumber || 1,
				startColumn: issue.range?.startColumn || 1,
				endLineNumber: issue.range?.endLineNumber || 1,
				endColumn: issue.range?.endColumn || 1,
				source: `Code Analysis [${issue.category}]`,
				code: issue.code
			}));

			markerService.changeOne('codeAnalysis', uri, markers);
		} catch (error) {
			// Analysis failed silently
		}
	}
}

/**
 * Action to run code analysis on entire project
 */
class RunProjectCodeAnalysisAction extends Action2 {
	constructor() {
		super({
			id: 'codeAnalysis.runProjectAnalysis',
			title: {
				value: localize('runProjectCodeAnalysis', "Run Code Analysis on Project"),
				original: 'Run Code Analysis on Project'
			},
			menu: [
				{
					id: MenuId.CommandPalette
				}
			],
			f1: true
		});
	}

	async run(accessor: ServicesAccessor, uri?: URI): Promise<void> {
		const workspaceService = accessor.get(IWorkspaceContextService);
		const fileService = accessor.get(IFileService);
		const textModelService = accessor.get(ITextModelService);
		const markerService = accessor.get(IMarkerService);
		const multiLanguageService = accessor.get(IMultiLanguageService);
		const treeSitterService = accessor.get(ITreeSitterParserService);
		const progressService = accessor.get(IProgressService);

		const workspace = workspaceService.getWorkspace();
		if (!workspace || workspace.folders.length === 0) {
			return;
		}

		// Define supported file extensions
		const supportedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.sql'];

		// Create analyzers
		const qualityAnalyzer = new QualityAnalyzer(multiLanguageService, treeSitterService);
		const securityAnalyzer = new SecurityAnalyzer();
		const performanceAnalyzer = new PerformanceAnalyzer();
		const complexityAnalyzer = new ComplexityAnalyzer(multiLanguageService, treeSitterService);
		const dependencyAnalyzer = new DependencyAnalyzer(multiLanguageService);
		const coverageAnalyzer = new CoverageAnalyzer();
		const technicalDebtAnalyzer = new TechnicalDebtAnalyzer();

		// Run with progress indicator
		await progressService.withProgress(
			{
				location: ProgressLocation.Notification,
				title: localize('analyzingProject', "Analyzing Project..."),
				cancellable: true
			},
			async (progress) => {
				const token = CancellationToken.None;
				const allFiles: URI[] = [];

				// Collect all files from workspace folders
				for (const folder of workspace.folders) {
					await this.collectFiles(folder.uri, fileService, supportedExtensions, allFiles, token);
				}

				if (allFiles.length === 0) {
					return;
				}

				let analyzed = 0;
				const totalIssues: AnalysisIssue[] = [];

				// Analyze each file
				for (const fileUri of allFiles) {
					if (token.isCancellationRequested) {
						return;
					}

					try {
						// Update progress
						progress.report({
							message: `${analyzed + 1}/${allFiles.length} files`,
							increment: (100 / allFiles.length)
						});

						// Get text model for the file
						const reference = await textModelService.createModelReference(fileUri);
						const model = reference.object.textEditorModel;
						const filePath = fileUri.fsPath;

						// Run all analyzers
						const [
							qualityIssues,
							securityIssues,
							performanceIssues,
							complexityIssues,
							dependencyIssues,
							coverageIssues,
							technicalDebtIssues
						] = await Promise.all([
							qualityAnalyzer.analyze(model, filePath),
							securityAnalyzer.analyze(model, filePath),
							performanceAnalyzer.analyze(model, filePath),
							complexityAnalyzer.analyze(model, filePath),
							dependencyAnalyzer.analyze(model, filePath),
							coverageAnalyzer.analyze(model, filePath),
							technicalDebtAnalyzer.analyze(model, filePath)
						]);

						const fileIssues = [
							...qualityIssues,
							...securityIssues,
							...performanceIssues,
							...complexityIssues,
							...dependencyIssues,
							...coverageIssues,
							...technicalDebtIssues
						];

						// Update markers for this file
						const markers: IMarkerData[] = fileIssues.map(issue => ({
							severity: issue.severity === IssueSeverity.Error ? MarkerSeverity.Error :
								issue.severity === IssueSeverity.Warning ? MarkerSeverity.Warning :
									MarkerSeverity.Info,
							message: issue.message,
							startLineNumber: issue.range?.startLineNumber || 1,
							startColumn: issue.range?.startColumn || 1,
							endLineNumber: issue.range?.endLineNumber || 1,
							endColumn: issue.range?.endColumn || 1,
							source: `Code Analysis [${issue.category}]`,
							code: issue.code
						}));

						markerService.changeOne('codeAnalysis', fileUri, markers);
						totalIssues.push(...fileIssues);

						// Dispose the reference
						reference.dispose();
						analyzed++;

					} catch (error) {
						// Skip failed files
					}
				}
			}
		);
	}

	/**
	 * Recursively collect files from a directory
	 */
	private async collectFiles(
		uri: URI,
		fileService: IFileService,
		supportedExtensions: string[],
		result: URI[],
		token: CancellationToken
	): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}

		try {
			const stat = await fileService.resolve(uri);

			if (stat.isDirectory) {
				// Skip common directories that shouldn't be analyzed
				const skipDirs = ['node_modules', '.git', 'dist', 'build', 'out', 'target', 'coverage', '.vscode'];
				const dirName = uri.path.split('/').pop() || '';
				if (skipDirs.includes(dirName)) {
					return;
				}

				// Recurse into children
				if (stat.children) {
					for (const child of stat.children) {
						await this.collectFiles(child.resource, fileService, supportedExtensions, result, token);
					}
				}
			} else {
				// Check if file has supported extension
				const fileName = uri.path;
				if (supportedExtensions.some(ext => fileName.endsWith(ext))) {
					result.push(uri);
				}
			}
		} catch (error) {
			// Skip inaccessible paths
		}
	}
}

/**
 * Action to run code analysis on selected folder in Explorer
 */
class RunFolderCodeAnalysisAction extends Action2 {
	constructor() {
		super({
			id: 'codeAnalysis.runFolderAnalysis',
			title: {
				value: localize('runFolderCodeAnalysis', "Run Code Analysis on Folder"),
				original: 'Run Code Analysis on Folder'
			},
			menu: [
				{
					id: MenuId.ExplorerContext,
					group: '2_workspace',
					order: 30
				}
			]
		});
	}

	async run(accessor: ServicesAccessor, uri?: URI): Promise<void> {
		const fileService = accessor.get(IFileService);
		const textModelService = accessor.get(ITextModelService);
		const markerService = accessor.get(IMarkerService);
		const multiLanguageService = accessor.get(IMultiLanguageService);
		const treeSitterService = accessor.get(ITreeSitterParserService);
		const progressService = accessor.get(IProgressService);

		// Get folder URI from context
		if (!uri) {
			return;
		}

		// Check if it's a directory
		const stat = await fileService.resolve(uri);
		if (!stat.isDirectory) {
			return;
		}

		// Define supported file extensions
		const supportedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.sql'];

		// Create analyzers
		const qualityAnalyzer = new QualityAnalyzer(multiLanguageService, treeSitterService);
		const securityAnalyzer = new SecurityAnalyzer();
		const performanceAnalyzer = new PerformanceAnalyzer();
		const complexityAnalyzer = new ComplexityAnalyzer(multiLanguageService, treeSitterService);
		const dependencyAnalyzer = new DependencyAnalyzer(multiLanguageService);
		const coverageAnalyzer = new CoverageAnalyzer();
		const technicalDebtAnalyzer = new TechnicalDebtAnalyzer();

		// Run with progress indicator
		await progressService.withProgress(
			{
				location: ProgressLocation.Notification,
				title: localize('analyzingFolder', "Analyzing Folder..."),
				cancellable: true
			},
			async (progress) => {
				const token = CancellationToken.None;
				const allFiles: URI[] = [];

				// Collect files from selected folder
				await this.collectFiles(uri, fileService, supportedExtensions, allFiles, token);

				if (allFiles.length === 0) {
					return;
				}

				let analyzed = 0;
				const totalIssues: AnalysisIssue[] = [];

				// Analyze each file
				for (const fileUri of allFiles) {
					if (token.isCancellationRequested) {
						return;
					}

					try {
						// Update progress
						progress.report({
							message: `${analyzed + 1}/${allFiles.length} files`,
							increment: (100 / allFiles.length)
						});

						// Get text model for the file
						const reference = await textModelService.createModelReference(fileUri);
						const model = reference.object.textEditorModel;
						const filePath = fileUri.fsPath;

						// Run all analyzers
						const [
							qualityIssues,
							securityIssues,
							performanceIssues,
							complexityIssues,
							dependencyIssues,
							coverageIssues,
							technicalDebtIssues
						] = await Promise.all([
							qualityAnalyzer.analyze(model, filePath),
							securityAnalyzer.analyze(model, filePath),
							performanceAnalyzer.analyze(model, filePath),
							complexityAnalyzer.analyze(model, filePath),
							dependencyAnalyzer.analyze(model, filePath),
							coverageAnalyzer.analyze(model, filePath),
							technicalDebtAnalyzer.analyze(model, filePath)
						]);

						const fileIssues = [
							...qualityIssues,
							...securityIssues,
							...performanceIssues,
							...complexityIssues,
							...dependencyIssues,
							...coverageIssues,
							...technicalDebtIssues
						];

						// Update markers for this file
						const markers: IMarkerData[] = fileIssues.map(issue => ({
							severity: issue.severity === IssueSeverity.Error ? MarkerSeverity.Error :
								issue.severity === IssueSeverity.Warning ? MarkerSeverity.Warning :
									MarkerSeverity.Info,
							message: issue.message,
							startLineNumber: issue.range?.startLineNumber || 1,
							startColumn: issue.range?.startColumn || 1,
							endLineNumber: issue.range?.endLineNumber || 1,
							endColumn: issue.range?.endColumn || 1,
							source: `Code Analysis [${issue.category}]`,
							code: issue.code
						}));

						markerService.changeOne('codeAnalysis', fileUri, markers);
						totalIssues.push(...fileIssues);

						// Dispose the reference
						reference.dispose();
						analyzed++;

					} catch (error) {
						// Skip failed files
					}
				}
			}
		);
	}

	/**
	 * Recursively collect files from a directory
	 */
	private async collectFiles(
		uri: URI,
		fileService: IFileService,
		supportedExtensions: string[],
		result: URI[],
		token: CancellationToken
	): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}

		try {
			const stat = await fileService.resolve(uri);

			if (stat.isDirectory) {
				// Skip common directories that shouldn't be analyzed
				const skipDirs = ['node_modules', '.git', 'dist', 'build', 'out', 'target', 'coverage', '.vscode'];
				const dirName = uri.path.split('/').pop() || '';
				if (skipDirs.includes(dirName)) {
					return;
				}

				// Recurse into children
				if (stat.children) {
					for (const child of stat.children) {
						await this.collectFiles(child.resource, fileService, supportedExtensions, result, token);
					}
				}
			} else {
				// Check if file has supported extension
				const fileName = uri.path;
				if (supportedExtensions.some(ext => fileName.endsWith(ext))) {
					result.push(uri);
				}
			}
		} catch (error) {
			// Skip inaccessible paths
		}
	}
}

// Register the contribution
registerWorkbenchContribution2(
	CodeAnalysisContribution.ID,
	CodeAnalysisContribution,
	WorkbenchPhase.BlockRestore
);

// Register the actions
registerAction2(RunCodeAnalysisAction);
registerAction2(RunProjectCodeAnalysisAction);
registerAction2(RunFolderCodeAnalysisAction);
