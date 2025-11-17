/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { SourceFile, LearningProgress } from './styleTypes.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

/**
 * 代码扫描器
 * 扫描项目中的所有源代码文件
 */
export class CodeScanner {

	// 支持的语言扩展名
	private static readonly LANGUAGE_EXTENSIONS = {
		java: ['.java'],
		typescript: ['.ts', '.tsx'],
		javascript: ['.js', '.jsx'],
		python: ['.py'],
		go: ['.go'],
		rust: ['.rs'],
		csharp: ['.cs'],
		php: ['.php'],
		ruby: ['.rb']
	};

	// 排除的目录
	private static readonly EXCLUDED_DIRS = [
		'node_modules',
		'dist',
		'build',
		'out',
		'target',
		'.git',
		'.svn',
		'.idea',
		'.vscode',
		'__pycache__',
		'.pytest_cache',
		'coverage',
		'.next',
		'.nuxt'
	];

	// 最大文件大小 (5MB)
	private static readonly MAX_FILE_SIZE = 5 * 1024 * 1024;

	// 最大扫描文件数
	private static readonly MAX_FILES = 1000;

	constructor(
		private readonly fileService: IFileService
	) { }

	/**
	 * 扫描项目代码文件
	 */
	async scanProject(
		workspaceFolder: URI,
		onProgress?: (progress: LearningProgress) => void,
		token?: CancellationToken
	): Promise<SourceFile[]> {
		const files: SourceFile[] = [];
		const allFiles: URI[] = [];

		console.log('[CodeScanner] Starting project scan:', workspaceFolder.fsPath);

		// 1. 收集所有文件路径
		await this.collectFiles(workspaceFolder, allFiles, token);

		console.log('[CodeScanner] Found', allFiles.length, 'files');

		// 2. 过滤支持的文件
		const supportedFiles = allFiles.filter(uri => this.isSupportedFile(uri));

		console.log('[CodeScanner] Supported files:', supportedFiles.length);

		// 限制文件数量
		const filesToScan = supportedFiles.slice(0, CodeScanner.MAX_FILES);

		// 3. 读取文件内容
		let scanned = 0;
		for (const fileUri of filesToScan) {
			if (token?.isCancellationRequested) {
				break;
			}

			try {
				const content = await this.readFile(fileUri);
				if (content) {
					files.push(content);
					scanned++;

					// 报告进度
					if (onProgress) {
						onProgress({
							status: 'scanning',
							progress: Math.floor((scanned / filesToScan.length) * 100),
							message: `正在扫描文件 ${scanned}/${filesToScan.length}`,
							filesScanned: scanned,
							totalFiles: filesToScan.length
						});
					}
				}
			} catch (error) {
				console.warn('[CodeScanner] Failed to read file:', fileUri.fsPath, error);
			}
		}

		console.log('[CodeScanner] Successfully scanned', files.length, 'files');

		return files;
	}

	/**
	 * 收集所有文件路径
	 */
	private async collectFiles(
		directory: URI,
		result: URI[],
		token?: CancellationToken
	): Promise<void> {
		if (token?.isCancellationRequested) {
			return;
		}

		// 检查是否是排除的目录
		const dirName = directory.path.split('/').pop() || '';
		if (CodeScanner.EXCLUDED_DIRS.includes(dirName)) {
			return;
		}

		try {
			const stat = await this.fileService.resolve(directory);

			if (!stat.children) {
				return;
			}

			for (const child of stat.children) {
				if (token?.isCancellationRequested) {
					break;
				}

				if (child.isDirectory) {
					// 递归扫描子目录
					await this.collectFiles(child.resource, result, token);
				} else if (child.isFile) {
					result.push(child.resource);
				}
			}
		} catch (error) {
			console.warn('[CodeScanner] Failed to read directory:', directory.fsPath, error);
		}
	}

	/**
	 * 判断是否是支持的文件
	 */
	private isSupportedFile(uri: URI): boolean {
		const path = uri.path.toLowerCase();

		// 检查扩展名
		for (const [, extensions] of Object.entries(CodeScanner.LANGUAGE_EXTENSIONS)) {
			for (const ext of extensions) {
				if (path.endsWith(ext)) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * 检测文件的编程语言
	 */
	private detectLanguage(uri: URI): string {
		const path = uri.path.toLowerCase();

		for (const [language, extensions] of Object.entries(CodeScanner.LANGUAGE_EXTENSIONS)) {
			for (const ext of extensions) {
				if (path.endsWith(ext)) {
					return language;
				}
			}
		}

		return 'unknown';
	}

	/**
	 * 读取文件内容
	 */
	private async readFile(uri: URI): Promise<SourceFile | null> {
		try {
			const stat = await this.fileService.resolve(uri, { resolveMetadata: true });

			// 检查文件大小
			if (stat.size && stat.size > CodeScanner.MAX_FILE_SIZE) {
				console.warn('[CodeScanner] File too large, skipping:', uri.fsPath);
				return null;
			}

			// 读取内容
			const fileContent = await this.fileService.readFile(uri);
			const content = fileContent.value.toString();

			return {
				path: uri.fsPath,
				language: this.detectLanguage(uri),
				content: content,
				size: stat.size || content.length
			};
		} catch (error) {
			console.error('[CodeScanner] Error reading file:', uri.fsPath, error);
			return null;
		}
	}

	/**
	 * 按语言分组文件
	 */
	static groupByLanguage(files: SourceFile[]): Map<string, SourceFile[]> {
		const groups = new Map<string, SourceFile[]>();

		for (const file of files) {
			const language = file.language;
			if (!groups.has(language)) {
				groups.set(language, []);
			}
			groups.get(language)!.push(file);
		}

		return groups;
	}

	/**
	 * 获取主要编程语言
	 */
	static getPrimaryLanguage(files: SourceFile[]): string {
		const groups = this.groupByLanguage(files);

		let maxCount = 0;
		let primaryLanguage = 'unknown';

		for (const [language, languageFiles] of groups.entries()) {
			if (languageFiles.length > maxCount) {
				maxCount = languageFiles.length;
				primaryLanguage = language;
			}
		}

		return primaryLanguage;
	}

	/**
	 * 计算代码统计信息
	 */
	static getStatistics(files: SourceFile[]): {
		fileCount: number;
		totalLines: number;
		totalSize: number;
		languageDistribution: Map<string, number>;
	} {
		const languageDistribution = new Map<string, number>();
		let totalLines = 0;
		let totalSize = 0;

		for (const file of files) {
			// 统计行数
			const lines = file.content.split('\n').length;
			totalLines += lines;

			// 统计大小
			totalSize += file.size;

			// 统计语言分布
			const count = languageDistribution.get(file.language) || 0;
			languageDistribution.set(file.language, count + 1);
		}

		return {
			fileCount: files.length,
			totalLines,
			totalSize,
			languageDistribution
		};
	}
}
