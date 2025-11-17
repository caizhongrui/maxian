/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	SourceFile,
	CodeStyleProfile,
	NamingConventions,
	StructurePatterns,
	CommentStyle,
	FrameworkPatterns,
	CodeExamples,
	LearningProgress
} from './styleTypes.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

/**
 * 风格分析器
 * 分析源代码文件，提取代码风格模式
 */
export class StyleAnalyzer {

	/**
	 * 分析项目代码风格
	 */
	async analyzeProject(
		files: SourceFile[],
		projectId: string,
		projectName: string,
		onProgress?: (progress: LearningProgress) => void,
		token?: CancellationToken
	): Promise<CodeStyleProfile> {
		console.log('[StyleAnalyzer] Starting project analysis...', files.length, 'files');

		if (files.length === 0) {
			throw new Error('没有文件可供分析');
		}

		const primaryLanguage = this.getPrimaryLanguage(files);
		console.log('[StyleAnalyzer] Primary language:', primaryLanguage);

		// 1. 分析命名约定
		onProgress?.({
			status: 'analyzing',
			progress: 20,
			message: '正在分析命名约定...',
			filesScanned: files.length,
			totalFiles: files.length
		});
		const naming = await this.analyzeNamingConventions(files, primaryLanguage, token);

		// 2. 分析代码结构
		onProgress?.({
			status: 'analyzing',
			progress: 40,
			message: '正在分析代码结构...',
			filesScanned: files.length,
			totalFiles: files.length
		});
		const structure = await this.analyzeStructurePatterns(files, primaryLanguage, token);

		// 3. 分析注释风格
		onProgress?.({
			status: 'analyzing',
			progress: 60,
			message: '正在分析注释风格...',
			filesScanned: files.length,
			totalFiles: files.length
		});
		const comments = await this.analyzeCommentStyle(files, primaryLanguage, token);

		// 4. 分析框架使用
		onProgress?.({
			status: 'analyzing',
			progress: 80,
			message: '正在分析框架使用模式...',
			filesScanned: files.length,
			totalFiles: files.length
		});
		const frameworks = await this.analyzeFrameworkPatterns(files, primaryLanguage, token);

		// 5. 提取代码示例
		onProgress?.({
			status: 'analyzing',
			progress: 90,
			message: '正在提取代码示例...',
			filesScanned: files.length,
			totalFiles: files.length
		});
		const examples = await this.extractCodeExamples(files, primaryLanguage, token);

		// 6. 计算统计信息
		const stats = this.calculateStatistics(files);

		// 7. 计算整体置信度
		const confidence = this.calculateConfidence(files.length, stats.totalLines);

		const profile: CodeStyleProfile = {
			projectId,
			projectName,
			primaryLanguage,
			naming,
			structure,
			comments,
			frameworks,
			examples,
			fileCount: files.length,
			totalLines: stats.totalLines,
			createdAt: new Date(),
			updatedAt: new Date(),
			confidence
		};

		console.log('[StyleAnalyzer] Analysis completed with confidence:', confidence);

		return profile;
	}

	/**
	 * 分析命名约定
	 */
	private async analyzeNamingConventions(
		files: SourceFile[],
		language: string,
		token?: CancellationToken
	): Promise<NamingConventions> {
		console.log('[StyleAnalyzer] Analyzing naming conventions...');

		const classNames: string[] = [];
		const methodNames: string[] = [];
		const variableNames: string[] = [];
		const constantNames: string[] = [];
		const interfaceNames: string[] = [];

		// 根据语言提取不同的命名模式
		for (const file of files) {
			if (token?.isCancellationRequested) {
				break;
			}

			const content = file.content;

			// 提取类名
			const classPattern = this.getClassPattern(language);
			const classMatches = content.matchAll(classPattern);
			for (const match of classMatches) {
				if (match[1]) {
					classNames.push(match[1]);
				}
			}

			// 提取方法名
			const methodPattern = this.getMethodPattern(language);
			const methodMatches = content.matchAll(methodPattern);
			for (const match of methodMatches) {
				if (match[1]) {
					methodNames.push(match[1]);
				}
			}

			// 提取变量名和常量名
			const varPattern = this.getVariablePattern(language);
			const varMatches = content.matchAll(varPattern);
			for (const match of varMatches) {
				if (match[1]) {
					const name = match[1];
					// 判断是否是常量（全大写或大写开头）
					if (name === name.toUpperCase() && name.length > 1) {
						constantNames.push(name);
					} else {
						variableNames.push(name);
					}
				}
			}

			// 提取接口名（TypeScript/Java）
			if (language === 'typescript' || language === 'java') {
				const interfacePattern = this.getInterfacePattern(language);
				const interfaceMatches = content.matchAll(interfacePattern);
				for (const match of interfaceMatches) {
					if (match[1]) {
						interfaceNames.push(match[1]);
					}
				}
			}
		}

		// 分析模式
		const classPattern = this.detectNamingPattern(classNames);
		const classPrefixes = this.extractPrefixes(classNames);
		const classSuffixes = this.extractSuffixes(classNames);

		const methodPattern = this.detectNamingPattern(methodNames);
		const methodPrefixes = this.extractCommonMethodPrefixes(methodNames);

		const variablePattern = this.detectNamingPattern(variableNames);
		const constantPattern = this.detectNamingPattern(constantNames);

		const interfacePattern = this.detectNamingPattern(interfaceNames);
		const interfacePrefix = this.detectInterfacePrefix(interfaceNames);

		return {
			classPattern,
			classPrefix: classPrefixes,
			classSuffix: classSuffixes,
			methodPattern,
			methodPrefix: methodPrefixes,
			variablePattern,
			constantPattern,
			interfacePattern,
			interfacePrefix
		};
	}

	/**
	 * 分析代码结构模式
	 */
	private async analyzeStructurePatterns(
		files: SourceFile[],
		language: string,
		token?: CancellationToken
	): Promise<StructurePatterns> {
		console.log('[StyleAnalyzer] Analyzing structure patterns...');

		let tabCount = 0;
		let spaceCount = 0;
		let space2Count = 0;
		let space4Count = 0;

		let sameLineBraceCount = 0;
		let newLineBraceCount = 0;

		let singleQuoteCount = 0;
		let doubleQuoteCount = 0;

		let semicolonLines = 0;
		let noSemicolonLines = 0;

		let trailingCommaCount = 0;
		let noTrailingCommaCount = 0;

		const totalLines: number[] = [];

		for (const file of files) {
			if (token?.isCancellationRequested) {
				break;
			}

			const lines = file.content.split('\n');
			const content = file.content;

			// 分析缩进
			for (const line of lines) {
				const leadingWhitespace = line.match(/^(\s+)/);
				if (leadingWhitespace) {
					const ws = leadingWhitespace[1];
					if (ws.includes('\t')) {
						tabCount++;
					} else {
						spaceCount++;
						if (ws.length === 2) {
							space2Count++;
						} else if (ws.length === 4) {
							space4Count++;
						}
					}
				}
			}

			// 分析大括号风格
			const sameLineBraces = content.match(/\)\s*\{/g);
			const newLineBraces = content.match(/\)\s*\n\s*\{/g);
			sameLineBraceCount += sameLineBraces?.length || 0;
			newLineBraceCount += newLineBraces?.length || 0;

			// 分析引号风格（JavaScript/TypeScript）
			if (language === 'javascript' || language === 'typescript') {
				const singleQuotes = content.match(/'/g);
				const doubleQuotes = content.match(/"/g);
				singleQuoteCount += singleQuotes?.length || 0;
				doubleQuoteCount += doubleQuotes?.length || 0;
			}

			// 分析分号使用
			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('/*')) {
					if (trimmed.endsWith(';')) {
						semicolonLines++;
					} else if (!trimmed.endsWith('{') && !trimmed.endsWith('}')) {
						noSemicolonLines++;
					}
				}
			}

			// 分析尾部逗号
			const trailingCommas = content.match(/,\s*\n\s*[\}\]]/g);
			const noTrailingCommas = content.match(/[^\,]\s*\n\s*[\}\]]/g);
			trailingCommaCount += trailingCommas?.length || 0;
			noTrailingCommaCount += noTrailingCommas?.length || 0;

			// 记录最大行长度
			for (const line of lines) {
				totalLines.push(line.length);
			}
		}

		// 确定缩进方式
		const indentation: 'tab' | 'space' = tabCount > spaceCount ? 'tab' : 'space';
		const indentSize = space4Count > space2Count ? 4 : 2;

		// 确定大括号风格
		const braceStyle: 'same-line' | 'new-line' = sameLineBraceCount > newLineBraceCount ? 'same-line' : 'new-line';

		// 确定引号风格
		const quoteStyle: 'single' | 'double' = singleQuoteCount > doubleQuoteCount ? 'single' : 'double';

		// 确定分号使用
		const useSemicolon = semicolonLines > noSemicolonLines;

		// 确定尾部逗号
		const trailingComma = trailingCommaCount > noTrailingCommaCount;

		// 计算最大行长度（取95%分位数）
		totalLines.sort((a, b) => a - b);
		const maxLineLength = totalLines[Math.floor(totalLines.length * 0.95)] || 120;

		return {
			indentation,
			indentSize,
			maxLineLength,
			braceStyle,
			quoteStyle,
			useSemicolon,
			trailingComma,
			spacing: {
				beforeFunctionParens: true,  // 默认值，需要更精细的分析
				beforeBraces: true,
				aroundOperators: true
			}
		};
	}

	/**
	 * 分析注释风格
	 */
	private async analyzeCommentStyle(
		files: SourceFile[],
		language: string,
		token?: CancellationToken
	): Promise<CommentStyle> {
		console.log('[StyleAnalyzer] Analyzing comment style...');

		let fileHeaderCount = 0;
		let classCommentCount = 0;
		let methodCommentCount = 0;
		let totalClasses = 0;
		let totalMethods = 0;

		let authorCount = 0;
		let dateCount = 0;
		let versionCount = 0;

		let chineseCommentCount = 0;
		let englishCommentCount = 0;

		const commentStyles: string[] = [];

		for (const file of files) {
			if (token?.isCancellationRequested) {
				break;
			}

			const lines = file.content.split('\n');

			// 检查文件头注释
			if (lines.length > 0 && (lines[0].includes('/*') || lines[0].includes('//'))) {
				fileHeaderCount++;
			}

			// 检查注释内容
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];

				// 检查是否包含作者、日期、版本信息
				if (line.includes('@author') || line.includes('Author:')) {
					authorCount++;
				}
				if (line.includes('@date') || line.includes('Date:')) {
					dateCount++;
				}
				if (line.includes('@version') || line.includes('Version:')) {
					versionCount++;
				}

				// 检测注释语言（简单的中英文判断）
				if (line.includes('//') || line.includes('/*') || line.includes('*')) {
					if (/[\u4e00-\u9fa5]/.test(line)) {
						chineseCommentCount++;
					} else if (/[a-zA-Z]/.test(line)) {
						englishCommentCount++;
					}
				}

				// 检测类注释
				if (line.includes('class ') || line.includes('interface ')) {
					totalClasses++;
					// 检查前面几行是否有注释
					for (let j = Math.max(0, i - 5); j < i; j++) {
						if (lines[j].includes('/**') || lines[j].includes('/*')) {
							classCommentCount++;
							commentStyles.push('JSDoc');
							break;
						}
					}
				}

				// 检测方法注释
				if (this.isMethodDeclaration(line, language)) {
					totalMethods++;
					// 检查前面几行是否有注释
					for (let j = Math.max(0, i - 5); j < i; j++) {
						if (lines[j].includes('/**') || lines[j].includes('/*')) {
							methodCommentCount++;
							break;
						}
					}
				}
			}
		}

		// 确定注释风格
		const classCommentStyle = this.getMostCommonCommentStyle(commentStyles) || 'JSDoc';
		const methodCommentStyle = classCommentStyle;

		// 确定是否要求注释
		const requireClassComment = totalClasses > 0 && (classCommentCount / totalClasses) > 0.5;
		const requireMethodComment = totalMethods > 0 && (methodCommentCount / totalMethods) > 0.3;

		// 确定是否包含元信息
		const includeAuthor = authorCount > files.length * 0.3;
		const includeDate = dateCount > files.length * 0.3;
		const includeVersion = versionCount > files.length * 0.3;

		// 确定注释语言偏好
		let commentLanguage: 'zh' | 'en' | 'mixed' = 'en';
		if (chineseCommentCount > englishCommentCount * 2) {
			commentLanguage = 'zh';
		} else if (chineseCommentCount > englishCommentCount * 0.3) {
			commentLanguage = 'mixed';
		}

		return {
			classCommentStyle,
			requireClassComment,
			methodCommentStyle,
			requireMethodComment,
			includeAuthor,
			includeDate,
			includeVersion,
			commentLanguage
		};
	}

	/**
	 * 分析框架使用模式
	 */
	private async analyzeFrameworkPatterns(
		files: SourceFile[],
		language: string,
		token?: CancellationToken
	): Promise<FrameworkPatterns> {
		console.log('[StyleAnalyzer] Analyzing framework patterns...');

		const imports: string[] = [];
		const libraries = new Map<string, number>();

		for (const file of files) {
			if (token?.isCancellationRequested) {
				break;
			}

			const content = file.content;

			// 提取 import 语句
			const importPattern = this.getImportPattern(language);
			const importMatches = content.matchAll(importPattern);

			for (const match of importMatches) {
				if (match[1]) {
					imports.push(match[1]);

					// 统计库的使用频率
					const libName = this.extractLibraryName(match[1]);
					libraries.set(libName, (libraries.get(libName) || 0) + 1);
				}
			}
		}

		// 获取最常用的库
		const sortedLibs = Array.from(libraries.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([name]) => name);

		// 检测主框架
		const primaryFramework = this.detectPrimaryFramework(sortedLibs, language);

		// 检测架构模式
		const architecturePattern = this.detectArchitecturePattern(files);

		// 检测依赖注入方式
		const dependencyInjection = this.detectDependencyInjection(files, language);

		return {
			primaryFramework,
			commonLibraries: sortedLibs,
			architecturePattern,
			dependencyInjection
		};
	}

	/**
	 * 提取代码示例
	 */
	private async extractCodeExamples(
		files: SourceFile[],
		language: string,
		token?: CancellationToken
	): Promise<CodeExamples> {
		console.log('[StyleAnalyzer] Extracting code examples...');

		const sampleClasses: string[] = [];
		const sampleMethods: string[] = [];
		const sampleComments: string[] = [];

		// 随机选择一些文件作为示例
		const sampleFiles = files.slice(0, Math.min(5, files.length));

		for (const file of sampleFiles) {
			if (token?.isCancellationRequested) {
				break;
			}

			const lines = file.content.split('\n');

			// 提取类示例
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];

				if (line.includes('class ')) {
					const classCode = this.extractCodeBlock(lines, i, 20);
					if (classCode && sampleClasses.length < 3) {
						sampleClasses.push(classCode);
					}
				}

				// 提取方法示例
				if (this.isMethodDeclaration(line, language)) {
					const methodCode = this.extractCodeBlock(lines, i, 15);
					if (methodCode && sampleMethods.length < 5) {
						sampleMethods.push(methodCode);
					}
				}

				// 提取注释示例
				if (line.includes('/**') || line.includes('/*')) {
					const commentCode = this.extractCommentBlock(lines, i);
					if (commentCode && sampleComments.length < 5) {
						sampleComments.push(commentCode);
					}
				}
			}
		}

		return {
			sampleClasses,
			sampleMethods,
			sampleComments
		};
	}

	// ==================== 辅助方法 ====================

	/**
	 * 获取主要编程语言
	 */
	private getPrimaryLanguage(files: SourceFile[]): string {
		const languageCount = new Map<string, number>();

		for (const file of files) {
			const count = languageCount.get(file.language) || 0;
			languageCount.set(file.language, count + 1);
		}

		let maxCount = 0;
		let primaryLanguage = 'unknown';

		for (const [language, count] of languageCount.entries()) {
			if (count > maxCount) {
				maxCount = count;
				primaryLanguage = language;
			}
		}

		return primaryLanguage;
	}

	/**
	 * 计算统计信息
	 */
	private calculateStatistics(files: SourceFile[]): { totalLines: number } {
		let totalLines = 0;

		for (const file of files) {
			totalLines += file.content.split('\n').length;
		}

		return { totalLines };
	}

	/**
	 * 计算置信度
	 */
	private calculateConfidence(fileCount: number, lineCount: number): number {
		// 基于文件数量和代码行数计算置信度
		let confidence = 0;

		// 文件数量贡献 (0-0.5)
		if (fileCount >= 50) {
			confidence += 0.5;
		} else if (fileCount >= 20) {
			confidence += 0.4;
		} else if (fileCount >= 10) {
			confidence += 0.3;
		} else if (fileCount >= 5) {
			confidence += 0.2;
		} else {
			confidence += 0.1;
		}

		// 代码行数贡献 (0-0.5)
		if (lineCount >= 10000) {
			confidence += 0.5;
		} else if (lineCount >= 5000) {
			confidence += 0.4;
		} else if (lineCount >= 2000) {
			confidence += 0.3;
		} else if (lineCount >= 1000) {
			confidence += 0.2;
		} else {
			confidence += 0.1;
		}

		return Math.min(1.0, confidence);
	}

	/**
	 * 获取类名匹配模式
	 */
	private getClassPattern(language: string): RegExp {
		switch (language) {
			case 'java':
			case 'typescript':
			case 'javascript':
				return /class\s+([A-Z][a-zA-Z0-9_]*)/g;
			case 'python':
				return /class\s+([A-Z][a-zA-Z0-9_]*)/g;
			case 'go':
				return /type\s+([A-Z][a-zA-Z0-9_]*)\s+struct/g;
			default:
				return /class\s+([A-Z][a-zA-Z0-9_]*)/g;
		}
	}

	/**
	 * 获取方法名匹配模式
	 */
	private getMethodPattern(language: string): RegExp {
		switch (language) {
			case 'java':
				return /\b(?:public|private|protected)\s+(?:static\s+)?(?:\w+)\s+([a-z][a-zA-Z0-9_]*)\s*\(/g;
			case 'typescript':
			case 'javascript':
				return /(?:function\s+([a-z][a-zA-Z0-9_]*)|([a-z][a-zA-Z0-9_]*)\s*:\s*function|\b([a-z][a-zA-Z0-9_]*)\s*\()/g;
			case 'python':
				return /def\s+([a-z][a-zA-Z0-9_]*)\s*\(/g;
			default:
				return /([a-z][a-zA-Z0-9_]*)\s*\(/g;
		}
	}

	/**
	 * 获取变量名匹配模式
	 */
	private getVariablePattern(language: string): RegExp {
		switch (language) {
			case 'java':
				return /\b(?:private|public|protected)?\s*(?:final\s+)?(?:static\s+)?(?:\w+)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g;
			case 'typescript':
			case 'javascript':
				return /\b(?:const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g;
			case 'python':
				return /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g;
			default:
				return /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g;
		}
	}

	/**
	 * 获取接口名匹配模式
	 */
	private getInterfacePattern(language: string): RegExp {
		if (language === 'typescript') {
			return /interface\s+([A-Z][a-zA-Z0-9_]*)/g;
		} else if (language === 'java') {
			return /interface\s+([A-Z][a-zA-Z0-9_]*)/g;
		}
		return /interface\s+([A-Z][a-zA-Z0-9_]*)/g;
	}

	/**
	 * 检测命名模式
	 */
	private detectNamingPattern(names: string[]): string {
		if (names.length === 0) {
			return 'camelCase';
		}

		let pascalCaseCount = 0;
		let camelCaseCount = 0;
		let snakeCaseCount = 0;
		let upperSnakeCaseCount = 0;

		for (const name of names) {
			if (/^[A-Z][a-z]/.test(name) && !name.includes('_')) {
				pascalCaseCount++;
			} else if (/^[a-z]/.test(name) && !name.includes('_')) {
				camelCaseCount++;
			} else if (name === name.toUpperCase() && name.includes('_')) {
				upperSnakeCaseCount++;
			} else if (name.includes('_')) {
				snakeCaseCount++;
			}
		}

		const max = Math.max(pascalCaseCount, camelCaseCount, snakeCaseCount, upperSnakeCaseCount);

		if (max === pascalCaseCount) {
			return 'PascalCase';
		} else if (max === camelCaseCount) {
			return 'camelCase';
		} else if (max === upperSnakeCaseCount) {
			return 'UPPER_SNAKE_CASE';
		} else {
			return 'snake_case';
		}
	}

	/**
	 * 提取前缀
	 */
	private extractPrefixes(names: string[]): string[] {
		const prefixes = new Map<string, number>();

		for (const name of names) {
			// 提取可能的前缀（2-5个字符）
			for (let len = 2; len <= Math.min(5, name.length - 1); len++) {
				const prefix = name.substring(0, len);
				if (/^[A-Z]/.test(prefix)) {
					prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
				}
			}
		}

		// 返回出现频率 > 10% 的前缀
		const threshold = names.length * 0.1;
		return Array.from(prefixes.entries())
			.filter(([, count]) => count >= threshold)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([prefix]) => prefix);
	}

	/**
	 * 提取后缀
	 */
	private extractSuffixes(names: string[]): string[] {
		const suffixes = new Map<string, number>();

		for (const name of names) {
			// 常见后缀列表
			const commonSuffixes = ['Service', 'Controller', 'Manager', 'Handler', 'Helper', 'Util', 'Factory', 'Builder', 'Impl'];

			for (const suffix of commonSuffixes) {
				if (name.endsWith(suffix)) {
					suffixes.set(suffix, (suffixes.get(suffix) || 0) + 1);
				}
			}
		}

		const threshold = names.length * 0.1;
		return Array.from(suffixes.entries())
			.filter(([, count]) => count >= threshold)
			.sort((a, b) => b[1] - a[1])
			.map(([suffix]) => suffix);
	}

	/**
	 * 提取常见方法前缀
	 */
	private extractCommonMethodPrefixes(names: string[]): string[] {
		const prefixes = new Map<string, number>();
		const commonPrefixes = ['get', 'set', 'is', 'has', 'create', 'update', 'delete', 'find', 'handle', 'process', 'validate', 'parse'];

		for (const name of names) {
			for (const prefix of commonPrefixes) {
				if (name.startsWith(prefix)) {
					prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
				}
			}
		}

		return Array.from(prefixes.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8)
			.map(([prefix]) => prefix);
	}

	/**
	 * 检测接口前缀
	 */
	private detectInterfacePrefix(names: string[]): string {
		if (names.length === 0) {
			return '';
		}

		let iCount = 0;
		for (const name of names) {
			if (name.startsWith('I') && name.length > 1 && /^I[A-Z]/.test(name)) {
				iCount++;
			}
		}

		return (iCount / names.length) > 0.5 ? 'I' : '';
	}

	/**
	 * 获取最常见的注释风格
	 */
	private getMostCommonCommentStyle(styles: string[]): string {
		if (styles.length === 0) {
			return 'JSDoc';
		}

		const counts = new Map<string, number>();
		for (const style of styles) {
			counts.set(style, (counts.get(style) || 0) + 1);
		}

		let maxCount = 0;
		let mostCommon = 'JSDoc';

		for (const [style, count] of counts.entries()) {
			if (count > maxCount) {
				maxCount = count;
				mostCommon = style;
			}
		}

		return mostCommon;
	}

	/**
	 * 判断是否是方法声明
	 */
	private isMethodDeclaration(line: string, language: string): boolean {
		const trimmed = line.trim();

		switch (language) {
			case 'java':
				return /\b(?:public|private|protected)\s+(?:static\s+)?(?:\w+)\s+\w+\s*\(/.test(trimmed);
			case 'typescript':
			case 'javascript':
				return /\b(?:function\s+\w+|(?:async\s+)?(?:\w+)\s*\(|(?:async\s+)?\w+\s*:\s*\()/.test(trimmed);
			case 'python':
				return /def\s+\w+\s*\(/.test(trimmed);
			default:
				return /\w+\s*\(/.test(trimmed);
		}
	}

	/**
	 * 获取 import 匹配模式
	 */
	private getImportPattern(language: string): RegExp {
		switch (language) {
			case 'java':
				return /import\s+([\w.]+)/g;
			case 'typescript':
			case 'javascript':
				return /import\s+.*?from\s+['"]([^'"]+)['"]/g;
			case 'python':
				return /(?:import|from)\s+([\w.]+)/g;
			case 'go':
				return /import\s+"([^"]+)"/g;
			default:
				return /import\s+.*?['"]([^'"]+)['"]/g;
		}
	}

	/**
	 * 提取库名称
	 */
	private extractLibraryName(importPath: string): string {
		// 提取包/库的主要名称
		const parts = importPath.split(/[./]/);
		return parts[0] || importPath;
	}

	/**
	 * 检测主框架
	 */
	private detectPrimaryFramework(libraries: string[], language: string): string | undefined {
		const frameworkKeywords = {
			'spring': 'Spring',
			'springboot': 'Spring Boot',
			'react': 'React',
			'vue': 'Vue',
			'angular': 'Angular',
			'express': 'Express',
			'django': 'Django',
			'flask': 'Flask',
			'gin': 'Gin',
			'fastapi': 'FastAPI'
		};

		for (const lib of libraries) {
			const lowerLib = lib.toLowerCase();
			for (const [keyword, framework] of Object.entries(frameworkKeywords)) {
				if (lowerLib.includes(keyword)) {
					return framework;
				}
			}
		}

		return undefined;
	}

	/**
	 * 检测架构模式
	 */
	private detectArchitecturePattern(files: SourceFile[]): string | undefined {
		let controllerCount = 0;
		let serviceCount = 0;
		let repositoryCount = 0;
		let modelCount = 0;

		for (const file of files) {
			const lowerPath = file.path.toLowerCase();
			if (lowerPath.includes('controller')) {
				controllerCount++;
			}
			if (lowerPath.includes('service')) {
				serviceCount++;
			}
			if (lowerPath.includes('repository') || lowerPath.includes('dao')) {
				repositoryCount++;
			}
			if (lowerPath.includes('model') || lowerPath.includes('entity')) {
				modelCount++;
			}
		}

		// 如果有明显的分层结构
		if (controllerCount > 0 && serviceCount > 0 && repositoryCount > 0) {
			return 'MVC/Layered';
		}

		return undefined;
	}

	/**
	 * 检测依赖注入方式
	 */
	private detectDependencyInjection(files: SourceFile[], language: string): string | undefined {
		let autowiredCount = 0;
		let constructorInjectionCount = 0;

		for (const file of files) {
			const content = file.content;

			if (content.includes('@Autowired') || content.includes('@Inject')) {
				autowiredCount++;
			}

			if (language === 'typescript' || language === 'javascript') {
				if (content.includes('constructor(') && content.includes('private readonly')) {
					constructorInjectionCount++;
				}
			}
		}

		if (autowiredCount > files.length * 0.2) {
			return 'Annotation-based DI';
		} else if (constructorInjectionCount > files.length * 0.2) {
			return 'Constructor Injection';
		}

		return undefined;
	}

	/**
	 * 提取代码块
	 */
	private extractCodeBlock(lines: string[], startLine: number, maxLines: number): string {
		const block: string[] = [];
		let braceCount = 0;
		let started = false;

		for (let i = startLine; i < Math.min(lines.length, startLine + maxLines); i++) {
			const line = lines[i];
			block.push(line);

			// 统计大括号
			for (const char of line) {
				if (char === '{') {
					braceCount++;
					started = true;
				} else if (char === '}') {
					braceCount--;
				}
			}

			// 如果大括号匹配完成，结束提取
			if (started && braceCount === 0) {
				break;
			}
		}

		return block.join('\n');
	}

	/**
	 * 提取注释块
	 */
	private extractCommentBlock(lines: string[], startLine: number): string {
		const block: string[] = [];

		for (let i = startLine; i < Math.min(lines.length, startLine + 20); i++) {
			const line = lines[i];
			block.push(line);

			// 如果遇到注释结束符，结束提取
			if (line.includes('*/')) {
				break;
			}
		}

		return block.join('\n');
	}
}
