/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { languageAdapterRegistry } from './languageAdapter.js';

/**
 * 框架信息
 */
export interface FrameworkInfo {
	/**
	 * 框架名称
	 */
	name: string;

	/**
	 * 框架版本
	 */
	version?: string;

	/**
	 * 框架类型 (frontend, backend, fullstack, testing, build)
	 */
	type: 'frontend' | 'backend' | 'fullstack' | 'testing' | 'build' | 'other';

	/**
	 * 置信度 (0-1)
	 */
	confidence: number;

	/**
	 * 检测依据
	 */
	evidence: string[];
}

/**
 * 项目类型
 */
export type ProjectType =
	| 'spring-boot'
	| 'react'
	| 'vue'
	| 'angular'
	| 'express'
	| 'django'
	| 'flask'
	| 'go-gin'
	| 'rust-actix'
	| 'dotnet-core'
	| 'laravel'
	| 'rails'
	| 'unknown';

/**
 * 语言检测器
 */
export class LanguageDetector {
	constructor(
		private readonly fileService: IFileService
	) { }

	/**
	 * 根据文件扩展名检测语言
	 */
	detectLanguageByExtension(fileUri: URI): string | undefined {
		const path = fileUri.path;
		const lastDot = path.lastIndexOf('.');

		if (lastDot < 0) {
			return undefined;
		}

		const extension = path.substring(lastDot);
		const adapter = languageAdapterRegistry.getAdapterByExtension(extension);

		return adapter?.language;
	}

	/**
	 * 根据文件内容检测语言
	 */
	detectLanguageByContent(content: string): string | undefined {
		// 检测 shebang
		if (content.startsWith('#!')) {
			const firstLine = content.split('\n')[0];
			if (firstLine.includes('python')) {
				return 'python';
			}
			if (firstLine.includes('node') || firstLine.includes('nodejs')) {
				return 'javascript';
			}
			if (firstLine.includes('ruby')) {
				return 'ruby';
			}
			if (firstLine.includes('bash') || firstLine.includes('sh')) {
				return 'shell';
			}
		}

		// 检测典型的语言特征
		if (this.isProbablyJava(content)) {
			return 'java';
		}
		if (this.isProbablyTypeScript(content)) {
			return 'typescript';
		}
		if (this.isProbablyPython(content)) {
			return 'python';
		}
		if (this.isProbablyGo(content)) {
			return 'go';
		}
		if (this.isProbablyRust(content)) {
			return 'rust';
		}
		if (this.isProbablyCSharp(content)) {
			return 'csharp';
		}

		return undefined;
	}

	/**
	 * 检测项目中的主要语言
	 */
	async detectPrimaryLanguage(workspaceFolder: URI, token?: CancellationToken): Promise<string | undefined> {
		const languageCounts = new Map<string, number>();

		try {
			// 扫描工作区目录
			const files = await this.scanDirectory(workspaceFolder, token);

			for (const fileUri of files) {
				if (token?.isCancellationRequested) {
					break;
				}

				const language = this.detectLanguageByExtension(fileUri);
				if (language) {
					const count = languageCounts.get(language) || 0;
					languageCounts.set(language, count + 1);
				}
			}

			// 找出数量最多的语言
			let maxCount = 0;
			let primaryLanguage: string | undefined;

			for (const [language, count] of languageCounts.entries()) {
				if (count > maxCount) {
					maxCount = count;
					primaryLanguage = language;
				}
			}

			return primaryLanguage;
		} catch (error) {
			console.error('[Language Detector] Failed to detect primary language:', error);
			return undefined;
		}
	}

	/**
	 * 检测项目框架
	 */
	async detectFramework(workspaceFolder: URI, token?: CancellationToken): Promise<FrameworkInfo[]> {
		const frameworks: FrameworkInfo[] = [];

		try {
			// 检测 Node.js 项目
			const packageJsonUri = URI.joinPath(workspaceFolder, 'package.json');
			if (await this.fileExists(packageJsonUri)) {
				const nodeFrameworks = await this.detectNodeFrameworks(packageJsonUri, token);
				frameworks.push(...nodeFrameworks);
			}

			// 检测 Java 项目
			const pomXmlUri = URI.joinPath(workspaceFolder, 'pom.xml');
			if (await this.fileExists(pomXmlUri)) {
				const javaFrameworks = await this.detectJavaFrameworks(pomXmlUri, token);
				frameworks.push(...javaFrameworks);
			}

			// 检测 Python 项目
			const requirementsUri = URI.joinPath(workspaceFolder, 'requirements.txt');
			if (await this.fileExists(requirementsUri)) {
				const pythonFrameworks = await this.detectPythonFrameworks(requirementsUri, token);
				frameworks.push(...pythonFrameworks);
			}

			// 检测 Go 项目
			const goModUri = URI.joinPath(workspaceFolder, 'go.mod');
			if (await this.fileExists(goModUri)) {
				const goFrameworks = await this.detectGoFrameworks(goModUri, token);
				frameworks.push(...goFrameworks);
			}

			// 检测 Rust 项目
			const cargoTomlUri = URI.joinPath(workspaceFolder, 'Cargo.toml');
			if (await this.fileExists(cargoTomlUri)) {
				const rustFrameworks = await this.detectRustFrameworks(cargoTomlUri, token);
				frameworks.push(...rustFrameworks);
			}

			return frameworks;
		} catch (error) {
			console.error('[Language Detector] Failed to detect frameworks:', error);
			return frameworks;
		}
	}

	/**
	 * 检测项目类型
	 */
	async detectProjectType(workspaceFolder: URI, token?: CancellationToken): Promise<ProjectType> {
		const frameworks = await this.detectFramework(workspaceFolder, token);

		// 根据检测到的框架推断项目类型
		for (const framework of frameworks) {
			if (framework.name.toLowerCase().includes('spring')) {
				return 'spring-boot';
			}
			if (framework.name.toLowerCase() === 'react') {
				return 'react';
			}
			if (framework.name.toLowerCase() === 'vue') {
				return 'vue';
			}
			if (framework.name.toLowerCase() === 'angular') {
				return 'angular';
			}
			if (framework.name.toLowerCase() === 'express') {
				return 'express';
			}
			if (framework.name.toLowerCase() === 'django') {
				return 'django';
			}
			if (framework.name.toLowerCase() === 'flask') {
				return 'flask';
			}
			if (framework.name.toLowerCase() === 'gin') {
				return 'go-gin';
			}
			if (framework.name.toLowerCase() === 'actix') {
				return 'rust-actix';
			}
		}

		return 'unknown';
	}

	/**
	 * 检测 Node.js 框架
	 */
	private async detectNodeFrameworks(packageJsonUri: URI, token?: CancellationToken): Promise<FrameworkInfo[]> {
		const frameworks: FrameworkInfo[] = [];

		try {
			const content = await this.readFile(packageJsonUri, token);
			const packageJson = JSON.parse(content);

			const dependencies = {
				...packageJson.dependencies,
				...packageJson.devDependencies
			};

			// React
			if (dependencies['react']) {
				frameworks.push({
					name: 'React',
					version: dependencies['react'],
					type: 'frontend',
					confidence: 0.95,
					evidence: ['package.json: react dependency']
				});
			}

			// Vue
			if (dependencies['vue']) {
				frameworks.push({
					name: 'Vue',
					version: dependencies['vue'],
					type: 'frontend',
					confidence: 0.95,
					evidence: ['package.json: vue dependency']
				});
			}

			// Angular
			if (dependencies['@angular/core']) {
				frameworks.push({
					name: 'Angular',
					version: dependencies['@angular/core'],
					type: 'frontend',
					confidence: 0.95,
					evidence: ['package.json: @angular/core dependency']
				});
			}

			// Express
			if (dependencies['express']) {
				frameworks.push({
					name: 'Express',
					version: dependencies['express'],
					type: 'backend',
					confidence: 0.95,
					evidence: ['package.json: express dependency']
				});
			}

			// NestJS
			if (dependencies['@nestjs/core']) {
				frameworks.push({
					name: 'NestJS',
					version: dependencies['@nestjs/core'],
					type: 'backend',
					confidence: 0.95,
					evidence: ['package.json: @nestjs/core dependency']
				});
			}

			// Next.js
			if (dependencies['next']) {
				frameworks.push({
					name: 'Next.js',
					version: dependencies['next'],
					type: 'fullstack',
					confidence: 0.95,
					evidence: ['package.json: next dependency']
				});
			}

		} catch (error) {
			console.warn('[Language Detector] Failed to parse package.json:', error);
		}

		return frameworks;
	}

	/**
	 * 检测 Java 框架
	 */
	private async detectJavaFrameworks(pomXmlUri: URI, token?: CancellationToken): Promise<FrameworkInfo[]> {
		const frameworks: FrameworkInfo[] = [];

		try {
			const content = await this.readFile(pomXmlUri, token);

			// Spring Boot
			if (content.includes('spring-boot-starter')) {
				frameworks.push({
					name: 'Spring Boot',
					type: 'backend',
					confidence: 0.95,
					evidence: ['pom.xml: spring-boot-starter dependency']
				});
			}

			// Spring
			if (content.includes('springframework')) {
				frameworks.push({
					name: 'Spring Framework',
					type: 'backend',
					confidence: 0.9,
					evidence: ['pom.xml: springframework dependency']
				});
			}

			// Hibernate
			if (content.includes('hibernate')) {
				frameworks.push({
					name: 'Hibernate',
					type: 'backend',
					confidence: 0.85,
					evidence: ['pom.xml: hibernate dependency']
				});
			}

		} catch (error) {
			console.warn('[Language Detector] Failed to parse pom.xml:', error);
		}

		return frameworks;
	}

	/**
	 * 检测 Python 框架
	 */
	private async detectPythonFrameworks(requirementsUri: URI, token?: CancellationToken): Promise<FrameworkInfo[]> {
		const frameworks: FrameworkInfo[] = [];

		try {
			const content = await this.readFile(requirementsUri, token);
			const lines = content.split('\n');

			for (const line of lines) {
				const trimmed = line.trim().toLowerCase();

				if (trimmed.startsWith('django')) {
					frameworks.push({
						name: 'Django',
						type: 'backend',
						confidence: 0.95,
						evidence: ['requirements.txt: django']
					});
				}

				if (trimmed.startsWith('flask')) {
					frameworks.push({
						name: 'Flask',
						type: 'backend',
						confidence: 0.95,
						evidence: ['requirements.txt: flask']
					});
				}

				if (trimmed.startsWith('fastapi')) {
					frameworks.push({
						name: 'FastAPI',
						type: 'backend',
						confidence: 0.95,
						evidence: ['requirements.txt: fastapi']
					});
				}
			}

		} catch (error) {
			console.warn('[Language Detector] Failed to parse requirements.txt:', error);
		}

		return frameworks;
	}

	/**
	 * 检测 Go 框架
	 */
	private async detectGoFrameworks(goModUri: URI, token?: CancellationToken): Promise<FrameworkInfo[]> {
		const frameworks: FrameworkInfo[] = [];

		try {
			const content = await this.readFile(goModUri, token);

			if (content.includes('gin-gonic/gin')) {
				frameworks.push({
					name: 'Gin',
					type: 'backend',
					confidence: 0.95,
					evidence: ['go.mod: gin-gonic/gin']
				});
			}

			if (content.includes('gorilla/mux')) {
				frameworks.push({
					name: 'Gorilla Mux',
					type: 'backend',
					confidence: 0.9,
					evidence: ['go.mod: gorilla/mux']
				});
			}

		} catch (error) {
			console.warn('[Language Detector] Failed to parse go.mod:', error);
		}

		return frameworks;
	}

	/**
	 * 检测 Rust 框架
	 */
	private async detectRustFrameworks(cargoTomlUri: URI, token?: CancellationToken): Promise<FrameworkInfo[]> {
		const frameworks: FrameworkInfo[] = [];

		try {
			const content = await this.readFile(cargoTomlUri, token);

			if (content.includes('actix-web')) {
				frameworks.push({
					name: 'Actix-web',
					type: 'backend',
					confidence: 0.95,
					evidence: ['Cargo.toml: actix-web']
				});
			}

			if (content.includes('rocket')) {
				frameworks.push({
					name: 'Rocket',
					type: 'backend',
					confidence: 0.95,
					evidence: ['Cargo.toml: rocket']
				});
			}

		} catch (error) {
			console.warn('[Language Detector] Failed to parse Cargo.toml:', error);
		}

		return frameworks;
	}

	// ====== 私有辅助方法 ======

	private isProbablyJava(content: string): boolean {
		return /\bclass\s+\w+/.test(content) &&
			/\bpublic\s+(class|interface|enum)/.test(content) &&
			/\bimport\s+[\w.]+;/.test(content);
	}

	private isProbablyTypeScript(content: string): boolean {
		return /\binterface\s+\w+/.test(content) ||
			/:\s*(string|number|boolean|any)\b/.test(content) ||
			/\btype\s+\w+\s*=/.test(content);
	}

	private isProbablyPython(content: string): boolean {
		return /\bdef\s+\w+\s*\(/.test(content) &&
			(/\bimport\s+\w+/.test(content) || /\bfrom\s+\w+\s+import/.test(content));
	}

	private isProbablyGo(content: string): boolean {
		return /\bpackage\s+\w+/.test(content) &&
			/\bfunc\s+\w+\s*\(/.test(content);
	}

	private isProbablyRust(content: string): boolean {
		return /\bfn\s+\w+\s*\(/.test(content) &&
			/\buse\s+[\w:]+;/.test(content);
	}

	private isProbablyCSharp(content: string): boolean {
		return /\bnamespace\s+[\w.]+/.test(content) &&
			/\busing\s+[\w.]+;/.test(content);
	}

	private async scanDirectory(directory: URI, token?: CancellationToken): Promise<URI[]> {
		const files: URI[] = [];

		try {
			const entries = await this.fileService.resolve(directory);

			if (!entries.children) {
				return files;
			}

			for (const entry of entries.children) {
				if (token?.isCancellationRequested) {
					break;
				}

				if (entry.isDirectory) {
					// 跳过常见的排除目录
					const dirName = entry.name.toLowerCase();
					if (this.shouldExcludeDirectory(dirName)) {
						continue;
					}

					// 递归扫描子目录
					const subFiles = await this.scanDirectory(entry.resource, token);
					files.push(...subFiles);
				} else {
					files.push(entry.resource);
				}
			}

		} catch (error) {
			console.warn('[Language Detector] Failed to scan directory:', error);
		}

		return files;
	}

	private shouldExcludeDirectory(dirName: string): boolean {
		const excludedDirs = [
			'node_modules', 'dist', 'build', 'out', 'target',
			'.git', '.idea', '.vscode', '__pycache__', '.next',
			'coverage', '.cache', 'vendor'
		];
		return excludedDirs.includes(dirName);
	}

	private async fileExists(fileUri: URI): Promise<boolean> {
		try {
			await this.fileService.resolve(fileUri);
			return true;
		} catch {
			return false;
		}
	}

	private async readFile(fileUri: URI, token?: CancellationToken): Promise<string> {
		const fileContent = await this.fileService.readFile(fileUri, undefined, token);
		return fileContent.value.toString();
	}
}
