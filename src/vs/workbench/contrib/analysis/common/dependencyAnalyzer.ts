/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextModel } from '../../../../editor/common/model.js';
import { DependencyIssue, DependencyNode, IssueSeverity, IssueCategory } from './analysisTypes.js';
import { IMultiLanguageService } from '../../multilang/browser/multilang.contribution.js';

/**
 * Dependency analyzer
 * Analyzes:
 * - Module dependencies
 * - Circular dependencies
 * - Unused imports
 */
export class DependencyAnalyzer {

	private dependencyGraph: Map<string, DependencyNode> = new Map();

	constructor(
		_multiLanguageService: IMultiLanguageService
	) { }

	/**
	 * Analyze dependencies for a given model
	 */
	async analyze(model: ITextModel, filePath: string): Promise<DependencyIssue[]> {
		const issues: DependencyIssue[] = [];
		const content = model.getValue();
		const languageId = model.getLanguageId();

		// Extract imports and exports
		const node = this.extractDependencies(content, filePath, languageId);
		this.dependencyGraph.set(filePath, node);

		// Check for unused imports
		issues.push(...this.checkUnusedImports(content, node, filePath));

		// Check for circular dependencies (across project - simplified)
		issues.push(...this.checkCircularDependencies(filePath, node));

		console.log(`[Dependency Analyzer] Found ${issues.length} dependency issues in ${filePath}`);
		return issues;
	}

	/**
	 * Extract import/export statements from code
	 */
	private extractDependencies(content: string, filePath: string, languageId: string): DependencyNode {
		const imports: string[] = [];
		const exports: string[] = [];
		const lines = content.split('\n');

		// Language-specific import patterns
		const importPatterns: Record<string, RegExp[]> = {
			'typescript': [
				/^import\s+.*\s+from\s+['"](.+)['"]/,
				/^import\s+['"](.+)['"]/,
				/^const\s+.*\s*=\s*require\(['"](.+)['"]\)/
			],
			'javascript': [
				/^import\s+.*\s+from\s+['"](.+)['"]/,
				/^import\s+['"](.+)['"]/,
				/^const\s+.*\s*=\s*require\(['"](.+)['"]\)/
			],
			'python': [
				/^import\s+(\S+)/,
				/^from\s+(\S+)\s+import/
			],
			'java': [
				/^import\s+([\w.]+);/
			],
			'go': [
				/^import\s+"(.+)"/,
				/^\s+"(.+)"/ // Inside import block
			]
		};

		const exportPatterns: Record<string, RegExp[]> = {
			'typescript': [
				/^export\s+(class|interface|function|const|let|var)\s+(\w+)/,
				/^export\s+default/
			],
			'javascript': [
				/^export\s+(class|function|const|let|var)\s+(\w+)/,
				/^export\s+default/,
				/^module\.exports\s*=/
			],
			'python': [
				/^def\s+(\w+)/,  // Functions are exported by default
				/^class\s+(\w+)/  // Classes are exported by default
			]
		};

		const langImportPatterns = importPatterns[languageId] || [];
		const langExportPatterns = exportPatterns[languageId] || [];

		lines.forEach(line => {
			const trimmed = line.trim();

			// Extract imports
			for (const pattern of langImportPatterns) {
				const match = trimmed.match(pattern);
				if (match && match[1]) {
					imports.push(match[1]);
				}
			}

			// Extract exports
			for (const pattern of langExportPatterns) {
				const match = trimmed.match(pattern);
				if (match) {
					exports.push(match[2] || match[1] || 'default');
				}
			}
		});

		return { filePath, imports, exports };
	}

	/**
	 * Check for unused imports
	 */
	private checkUnusedImports(content: string, node: DependencyNode, filePath: string): DependencyIssue[] {
		const issues: DependencyIssue[] = [];
		const lines = content.split('\n');

		// Extract imported names
		const importedNames = new Set<string>();
		lines.forEach(line => {
			const importMatch = line.match(/^import\s+\{([^}]+)\}|^import\s+(\w+)/);
			if (importMatch) {
				if (importMatch[1]) {
					// Named imports
					importMatch[1].split(',').forEach(name => {
						importedNames.add(name.trim().split(' as ')[0].trim());
					});
				} else if (importMatch[2]) {
					// Default import
					importedNames.add(importMatch[2]);
				}
			}
		});

		// Check if each imported name is used
		importedNames.forEach(name => {
			// Simple check: search for name in code (excluding import line)
			const usagePattern = new RegExp(`\\b${name}\\b`);
			const nonImportLines = lines.filter(l => !l.trim().startsWith('import'));
			const isUsed = nonImportLines.some(line => usagePattern.test(line));

			if (!isUsed) {
				const importLine = lines.findIndex(l => l.includes(`import`) && l.includes(name));
				if (importLine >= 0) {
					issues.push({
						category: IssueCategory.Dependency,
						type: 'unused',
						severity: IssueSeverity.Info,
						message: `Unused import: "${name}"`,
						filePath,
						range: {
							startLineNumber: importLine + 1,
							startColumn: 1,
							endLineNumber: importLine + 1,
							endColumn: lines[importLine].length + 1
						},
						suggestion: 'Remove unused import to reduce bundle size'
					});
				}
			}
		});

		return issues;
	}

	/**
	 * Check for circular dependencies
	 */
	private checkCircularDependencies(filePath: string, node: DependencyNode): DependencyIssue[] {
		const issues: DependencyIssue[] = [];
		const visited = new Set<string>();
		const recursionStack = new Set<string>();

		const detectCycle = (currentPath: string, path: string[]): string[] | null => {
			if (recursionStack.has(currentPath)) {
				// Found a cycle
				const cycleStart = path.indexOf(currentPath);
				return path.slice(cycleStart).concat(currentPath);
			}

			if (visited.has(currentPath)) {
				return null;
			}

			visited.add(currentPath);
			recursionStack.add(currentPath);

			const currentNode = this.dependencyGraph.get(currentPath);
			if (currentNode) {
				for (const dep of currentNode.imports) {
					const cycle = detectCycle(dep, path.concat(currentPath));
					if (cycle) {
						return cycle;
					}
				}
			}

			recursionStack.delete(currentPath);
			return null;
		};

		const cycle = detectCycle(filePath, []);
		if (cycle && cycle.length > 0) {
			issues.push({
				category: IssueCategory.Dependency,
				type: 'circular',
				severity: IssueSeverity.Warning,
				message: `Circular dependency detected: ${cycle.join(' -> ')}`,
				filePath,
				dependencies: cycle,
				suggestion: 'Refactor to break the circular dependency'
			});
		}

		return issues;
	}
}
