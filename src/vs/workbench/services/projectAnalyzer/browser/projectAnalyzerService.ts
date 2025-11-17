/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IProjectAnalyzerService, ProjectStructure, ProjectType, ProjectDependency, DirectoryStructure } from '../common/projectAnalyzer.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

export class ProjectAnalyzerService implements IProjectAnalyzerService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService
	) { }

	async analyzeProject(workspaceUri: URI): Promise<ProjectStructure> {
		const type = await this.detectProjectType(workspaceUri);
		const dependencies = await this.getDependencies(workspaceUri);
		const directories = await this.analyzeDirectories(workspaceUri, type);

		return {
			type,
			framework: await this.detectFramework(workspaceUri, type),
			language: await this.detectPrimaryLanguage(workspaceUri),
			directories,
			dependencies
		};
	}

	/**
	 * Detect base package from existing Java files
	 */
	async detectBasePackage(workspaceUri: URI): Promise<string | null> {
		try {
			// Look for Java files recursively in src/main/java
			const javaDir = URI.joinPath(workspaceUri, 'src/main/java');
			console.log('[Project Analyzer] Detecting base package from:', javaDir.fsPath);

			const foundPackage = await this.findFirstJavaPackage(javaDir);

			console.log('[Project Analyzer] Found package:', foundPackage);

			if (foundPackage) {
				// Extract base package (first 3 segments)
				const parts = foundPackage.split('.');
				const basePackage = parts.slice(0, Math.min(3, parts.length)).join('.');
				console.log('[Project Analyzer] Base package:', basePackage);
				return basePackage;
			}
		} catch (error) {
			console.error('[Project Analyzer] Error detecting base package:', error);
		}

		console.warn('[Project Analyzer] No base package found, using default');
		return null;
	}

	/**
	 * Recursively find first Java file and extract its package
	 */
	private async findFirstJavaPackage(dirUri: URI): Promise<string | null> {
		try {
			const files = await this.fileService.resolve(dirUri);

			if (files.children) {
				// First check for Java files in current directory
				for (const child of files.children) {
					if (child.name.endsWith('.java') && !child.isDirectory) {
						const content = await this.readFile(child.resource);
						const pkgMatch = content.match(/package\s+([\w.]+);/);
						if (pkgMatch) {
							return pkgMatch[1];
						}
					}
				}

				// Then recurse into subdirectories
				for (const child of files.children) {
					if (child.isDirectory) {
						const pkg = await this.findFirstJavaPackage(child.resource);
						if (pkg) {
							return pkg;
						}
					}
				}
			}
		} catch (error) {
			// Directory might not exist, that's ok
		}

		return null;
	}

	/**
	 * Detect package structure by scanning existing files
	 */
	async detectPackageStructure(workspaceUri: URI): Promise<Record<string, string>> {
		const packages: Record<string, string> = {};
		const basePackage = await this.detectBasePackage(workspaceUri) || 'com.example.app';

		console.log('[Project Analyzer] Detecting package structure, base:', basePackage);

		// Dynamically discover actual directory types in project
		const discoveredTypes = await this.discoverProjectTypes(workspaceUri);

		console.log('[Project Analyzer] Discovered types:', discoveredTypes);

		for (const type of discoveredTypes) {
			try {
				const typeDir = URI.joinPath(workspaceUri, `src/main/java`);
				const foundPkg = await this.findPackageInTypeDir(typeDir, type);

				if (foundPkg) {
					packages[type] = foundPkg;
					console.log(`[Project Analyzer] ${type} package:`, foundPkg);
				} else {
					packages[type] = `${basePackage}.${type}`;
				}
			} catch (error) {
				packages[type] = `${basePackage}.${type}`;
			}
		}

		return packages;
	}

	/**
	 * Discover actual project types by scanning directory structure
	 */
	private async discoverProjectTypes(workspaceUri: URI): Promise<string[]> {
		const types: string[] = [];

		try {
			const javaDir = URI.joinPath(workspaceUri, 'src/main/java');
			await this.scanForTypes(javaDir, types, 0);
		} catch (error) {
			console.error('[Project Analyzer] Error discovering types:', error);
		}

		// Add common fallback types if not found
		const commonTypes = ['controller', 'service', 'dto', 'model'];
		for (const common of commonTypes) {
			if (!types.includes(common)) {
				types.push(common);
			}
		}

		return types;
	}

	/**
	 * Scan directory to find type directories (controller, service, etc.)
	 */
	private async scanForTypes(dirUri: URI, types: string[], depth: number): Promise<void> {
		if (depth > 5) return;

		try {
			const files = await this.fileService.resolve(dirUri);

			if (files.children) {
				for (const child of files.children) {
					if (child.isDirectory) {
						const dirName = child.name.toLowerCase();

						// Skip package name parts and common non-type directories
						const skipDirs = ['com', 'org', 'cn', 'io', 'java', 'main', 'resources', 'test', 'target', 'build'];

						if (!skipDirs.includes(dirName) && dirName.length > 2) {
							// Check if directory contains Java files (is likely a type directory)
							const hasJavaFiles = await this.directoryHasJavaFiles(child.resource);

							if (hasJavaFiles && !types.includes(dirName)) {
								types.push(dirName);
								console.log('[Project Analyzer] Found type directory:', dirName);
							}
						}

						// Recurse
						await this.scanForTypes(child.resource, types, depth + 1);
					}
				}
			}
		} catch (error) {
			// Directory might not exist
		}
	}

	/**
	 * Check if directory contains any Java files
	 */
	private async directoryHasJavaFiles(dirUri: URI): Promise<boolean> {
		try {
			const files = await this.fileService.resolve(dirUri);

			if (files.children) {
				for (const child of files.children) {
					if (!child.isDirectory && child.name.endsWith('.java')) {
						return true;
					}
				}
			}
		} catch (error) {
			// ignore
		}

		return false;
	}

	/**
	 * Find package for a specific type (e.g., controller, service)
	 */
	private async findPackageInTypeDir(javaDir: URI, type: string): Promise<string | null> {
		try {
			const files = await this.fileService.resolve(javaDir);

			if (files.children) {
				for (const child of files.children) {
					if (child.isDirectory) {
						// Check if this directory or subdirectory name matches type
						if (child.name === type) {
							// Found type directory, get package from first Java file
							return await this.findFirstJavaPackage(child.resource);
						} else {
							// Recurse into subdirectory
							const found = await this.findPackageInTypeDir(child.resource, type);
							if (found) {
								return found;
							}
						}
					}
				}
			}
		} catch (error) {
			// Directory might not exist
		}

		return null;
	}

	async detectProjectType(workspaceUri: URI): Promise<ProjectType> {
		try {
			// Check for package.json
			const packageJson = URI.joinPath(workspaceUri, 'package.json');
			if (await this.fileExists(packageJson)) {
				const content = await this.readFile(packageJson);
				const pkg = JSON.parse(content);

				// Check dependencies
				const deps = { ...pkg.dependencies, ...pkg.devDependencies };

				if (deps['react']) { return 'react'; }
				if (deps['vue']) { return 'vue'; }
				if (deps['@angular/core']) { return 'angular'; }
				if (deps['express']) { return 'express'; }
			}

			// Check for pom.xml (Spring Boot)
			const pomXml = URI.joinPath(workspaceUri, 'pom.xml');
			if (await this.fileExists(pomXml)) {
				return 'spring-boot';
			}

			// Check for requirements.txt (Python)
			const requirementsTxt = URI.joinPath(workspaceUri, 'requirements.txt');
			if (await this.fileExists(requirementsTxt)) {
				const content = await this.readFile(requirementsTxt);
				if (content.includes('django')) { return 'django'; }
				if (content.includes('fastapi')) { return 'fastapi'; }
			}

			// Check for go.mod (Go)
			const goMod = URI.joinPath(workspaceUri, 'go.mod');
			if (await this.fileExists(goMod)) {
				return 'go-gin';
			}

			// Check for Cargo.toml (Rust)
			const cargoToml = URI.joinPath(workspaceUri, 'Cargo.toml');
			if (await this.fileExists(cargoToml)) {
				return 'rust-actix';
			}

		} catch (error) {
			console.error('[Project Analyzer] Error detecting project type:', error);
		}

		return 'unknown';
	}

	async suggestFileLocation(fileName: string, fileType: 'controller' | 'service' | 'model' | 'component' | 'test'): Promise<string> {
		const workspace = this.workspaceService.getWorkspace().folders[0];
		if (!workspace) {
			return fileName;
		}

		const projectType = await this.detectProjectType(workspace.uri);
		const baseDir = workspace.uri.fsPath;

		switch (projectType) {
			case 'spring-boot':
				switch (fileType) {
					case 'controller': return `${baseDir}/src/main/java/com/example/controller/${fileName}`;
					case 'service': return `${baseDir}/src/main/java/com/example/service/${fileName}`;
					case 'model': return `${baseDir}/src/main/java/com/example/model/${fileName}`;
					case 'test': return `${baseDir}/src/test/java/com/example/${fileName}`;
				}
				break;

			case 'express':
				switch (fileType) {
					case 'controller': return `${baseDir}/src/controllers/${fileName}`;
					case 'service': return `${baseDir}/src/services/${fileName}`;
					case 'model': return `${baseDir}/src/models/${fileName}`;
					case 'test': return `${baseDir}/test/${fileName}`;
				}
				break;

			case 'react':
			case 'vue':
			case 'angular':
				switch (fileType) {
					case 'component': return `${baseDir}/src/components/${fileName}`;
					case 'service': return `${baseDir}/src/services/${fileName}`;
					case 'test': return `${baseDir}/src/__tests__/${fileName}`;
				}
				break;
		}

		return `${baseDir}/src/${fileName}`;
	}

	async getDependencies(workspaceUri: URI): Promise<ProjectDependency[]> {
		const dependencies: ProjectDependency[] = [];

		try {
			const packageJson = URI.joinPath(workspaceUri, 'package.json');
			if (await this.fileExists(packageJson)) {
				const content = await this.readFile(packageJson);
				const pkg = JSON.parse(content);

				if (pkg.dependencies) {
					for (const [name, version] of Object.entries(pkg.dependencies)) {
						dependencies.push({ name, version: version as string, type: 'runtime' });
					}
				}

				if (pkg.devDependencies) {
					for (const [name, version] of Object.entries(pkg.devDependencies)) {
						dependencies.push({ name, version: version as string, type: 'dev' });
					}
				}
			}
		} catch (error) {
			console.error('[Project Analyzer] Error reading dependencies:', error);
		}

		return dependencies;
	}

	private async detectFramework(workspaceUri: URI, projectType: ProjectType): Promise<string | null> {
		switch (projectType) {
			case 'spring-boot': return 'Spring Boot';
			case 'express': return 'Express.js';
			case 'react': return 'React';
			case 'vue': return 'Vue.js';
			case 'angular': return 'Angular';
			case 'django': return 'Django';
			case 'fastapi': return 'FastAPI';
			case 'go-gin': return 'Gin';
			case 'rust-actix': return 'Actix';
			default: return null;
		}
	}

	private async detectPrimaryLanguage(workspaceUri: URI): Promise<string> {
		const projectType = await this.detectProjectType(workspaceUri);

		switch (projectType) {
			case 'spring-boot': return 'java';
			case 'express': return 'typescript';
			case 'react': return 'typescript';
			case 'vue': return 'typescript';
			case 'angular': return 'typescript';
			case 'django': return 'python';
			case 'fastapi': return 'python';
			case 'go-gin': return 'go';
			case 'rust-actix': return 'rust';
			default: return 'typescript';
		}
	}

	private async analyzeDirectories(workspaceUri: URI, projectType: ProjectType): Promise<DirectoryStructure> {
		const baseDir = workspaceUri.fsPath;

		switch (projectType) {
			case 'spring-boot':
				return {
					src: `${baseDir}/src/main/java`,
					test: `${baseDir}/src/test/java`,
					config: `${baseDir}/src/main/resources`,
					frontend: null,
					backend: `${baseDir}/src/main/java`
				};

			case 'express':
				return {
					src: `${baseDir}/src`,
					test: `${baseDir}/test`,
					config: `${baseDir}/config`,
					frontend: null,
					backend: `${baseDir}/src`
				};

			case 'react':
			case 'vue':
			case 'angular':
				return {
					src: `${baseDir}/src`,
					test: `${baseDir}/src/__tests__`,
					config: `${baseDir}/config`,
					frontend: `${baseDir}/src`,
					backend: null
				};

			default:
				return {
					src: `${baseDir}/src`,
					test: `${baseDir}/test`,
					config: `${baseDir}/config`,
					frontend: null,
					backend: null
				};
		}
	}

	private async fileExists(uri: URI): Promise<boolean> {
		try {
			await this.fileService.resolve(uri);
			return true;
		} catch {
			return false;
		}
	}

	private async readFile(uri: URI): Promise<string> {
		const file = await this.fileService.readFile(uri);
		return file.value.toString();
	}

	/**
	 * Search for files related to a requirement
	 */
	async searchRelatedFiles(workspaceUri: URI, keywords: string[]): Promise<Array<{ path: string; content: string; type: string }>> {
		const relatedFiles: Array<{ path: string; content: string; type: string }> = [];

		try {
			console.log('[Project Analyzer] Searching with keywords:', keywords);

			// Search from workspace root (supports multi-module automatically)
			console.log('[Project Analyzer] Searching from workspace root:', workspaceUri.fsPath);
			await this.searchInDirectory(workspaceUri, keywords, relatedFiles, workspaceUri, 0);

			console.log('[Project Analyzer] Search results:', relatedFiles.length, 'files found');
		} catch (error) {
			console.error('[Project Analyzer] Error searching files:', error);
		}

		return relatedFiles.slice(0, 5);
	}

	/**
	 * Recursively search directory for files matching keywords
	 */
	private async searchInDirectory(
		dirUri: URI,
		keywords: string[],
		results: Array<{ path: string; content: string; type: string }>,
		workspaceUri: URI,
		depth: number
	): Promise<void> {
		if (depth > 10 || results.length >= 5) {
			return;
		}

		try {
			const files = await this.fileService.resolve(dirUri);
			console.log(`[Search] Depth ${depth}, Dir: ${dirUri.fsPath.split('/').slice(-2).join('/')}, Children: ${files.children?.length || 0}`);

			if (files.children) {
				for (const child of files.children) {
					if (results.length >= 5) break;

					if (child.isDirectory) {
						if (['node_modules', 'target', 'build', 'dist', '.git'].includes(child.name)) {
							continue;
						}

						await this.searchInDirectory(child.resource, keywords, results, workspaceUri, depth + 1);
					} else if (child.name.endsWith('.java') || child.name.endsWith('.ts')) {
						console.log(`[Search] Checking file: ${child.name}`);

						const fileName = child.name.toLowerCase();
						const matchesFilename = keywords.some(kw => {
							const match = kw.length > 1 && fileName.includes(kw.toLowerCase());
							if (match) console.log(`[Search] ✓ Filename match: ${child.name} contains "${kw}"`);
							return match;
						});

						if (matchesFilename || keywords.length === 0) {
							const content = await this.readFile(child.resource);
							const relativePath = child.resource.fsPath.substring(workspaceUri.fsPath.length + 1);
							const contentLower = content.toLowerCase();

							const matchesContent = keywords.some(kw => {
								const match = kw.length > 1 && contentLower.includes(kw.toLowerCase());
								if (match) console.log(`[Search] ✓ Content match: ${child.name} contains "${kw}"`);
								return match;
							});

							if (matchesFilename || matchesContent) {
								// Determine file type from actual path structure
								// Extract the directory name that contains the file
								const pathParts = relativePath.split(/[/\\]/);
								let type = 'other';

								// Look for type directory in path (working backwards)
								for (let i = pathParts.length - 2; i >= 0; i--) {
									const dir = pathParts[i].toLowerCase();

									// Skip package name parts (com, boyo, etc.)
									if (dir.length > 2 && !dir.match(/^(com|org|cn|io|java|main|src)$/)) {
										type = dir;
										break;
									}
								}

								console.log('[Project Analyzer] Found matching file:', relativePath, 'type:', type);

								results.push({
									path: relativePath,
									content: content.substring(0, 1000),
									type
								});
							}
						}
					}
				}
			}
		} catch (error) {
			console.error('[Project Analyzer] Error reading directory:', dirUri.fsPath, error);
		}
	}
}

registerSingleton(IProjectAnalyzerService, ProjectAnalyzerService, InstantiationType.Delayed);
