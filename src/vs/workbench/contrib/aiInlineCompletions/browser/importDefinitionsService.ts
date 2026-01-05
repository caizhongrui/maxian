/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Range } from '../../../../editor/common/core/range.js';
import { IModelService } from '../../../../editor/common/services/model.js';

/**
 * 导入定义信息
 */
export interface ImportDefinition {
	/** 导入的符号名称 */
	symbolName: string;
	/** 导入路径/模块 */
	modulePath: string;
	/** 定义文件路径 */
	definitionPath?: string;
	/** 定义内容（类/函数的源代码） */
	definitionContent?: string;
	/** 定义范围 */
	range?: Range;
	/** 导入类型：class, function, variable, type 等 */
	kind?: string;
}

/**
 * 缓存项
 */
interface CacheEntry {
	imports: ImportDefinition[];
	timestamp: number;
}

/**
 * Import 分析服务
 * 分析文件的 import 语句并获取被导入符号的定义
 */
export class ImportDefinitionsService {

	// 缓存，key 为文件 URI
	private cache: Map<string, CacheEntry> = new Map();
	private readonly maxCacheSize = 50;
	private readonly cacheTTL = 3 * 60 * 1000; // 3 分钟

	constructor(
		private readonly languageFeaturesService: ILanguageFeaturesService,
		private readonly modelService: IModelService
	) { }

	/**
	 * 获取文件的所有导入定义
	 */
	async getImportDefinitions(
		model: ITextModel,
		token: CancellationToken
	): Promise<ImportDefinition[]> {
		const uri = model.uri.toString();

		// 检查缓存
		const cached = this.getFromCache(uri);
		if (cached) {
			return cached;
		}

		const languageId = model.getLanguageId();
		let imports: ImportDefinition[] = [];

		try {
			// 根据语言类型解析 import 语句
			switch (languageId) {
				case 'java':
					imports = await this.parseJavaImports(model, token);
					break;
				case 'typescript':
				case 'typescriptreact':
				case 'javascript':
				case 'javascriptreact':
				case 'vue':  // Vue 文件使用 TypeScript/JavaScript 语法
				case 'html':  // HTML 中的 script 标签
					imports = await this.parseTypeScriptImports(model, token);
					break;
				case 'python':
					imports = await this.parsePythonImports(model, token);
					break;
				case 'go':
					imports = await this.parseGoImports(model, token);
					break;
				default:
					// 尝试通用解析
					imports = await this.parseGenericImports(model, token);
			}

			// 添加到缓存
			this.addToCache(uri, imports);

		} catch (error) {
			console.error('[ImportDefinitionsService] 解析导入失败:', error);
		}

		return imports;
	}

	/**
	 * 获取特定导入符号的定义内容
	 */
	async getImportDefinitionContent(
		model: ITextModel,
		symbolName: string,
		token: CancellationToken
	): Promise<string | undefined> {
		const imports = await this.getImportDefinitions(model, token);
		const targetImport = imports.find(imp => imp.symbolName === symbolName);

		if (targetImport?.definitionContent) {
			return targetImport.definitionContent;
		}

		return undefined;
	}

	/**
	 * 解析 Java import 语句
	 */
	private async parseJavaImports(
		model: ITextModel,
		token: CancellationToken
	): Promise<ImportDefinition[]> {
		const imports: ImportDefinition[] = [];
		const text = model.getValue();
		const lines = text.split('\n');

		// 匹配 Java import 语句
		const importRegex = /^import\s+(static\s+)?([a-zA-Z0-9_.]+)(?:\.\*)?;/;

		for (let lineNum = 0; lineNum < lines.length; lineNum++) {
			const line = lines[lineNum].trim();

			// 遇到类定义，停止解析 import
			if (line.startsWith('public class') || line.startsWith('class') ||
				line.startsWith('public interface') || line.startsWith('interface') ||
				line.startsWith('public enum') || line.startsWith('enum')) {
				break;
			}

			const match = line.match(importRegex);
			if (match) {
				const fullPath = match[2];
				const parts = fullPath.split('.');
				const symbolName = parts[parts.length - 1];

				const importDef: ImportDefinition = {
					symbolName,
					modulePath: fullPath,
					kind: match[1] ? 'static' : 'class'
				};

				// 尝试获取定义
				const definition = await this.resolveJavaImportDefinition(
					model,
					lineNum + 1,
					line.indexOf(symbolName) + 1,
					token
				);

				if (definition) {
					importDef.definitionPath = definition.filepath;
					importDef.definitionContent = definition.content;
					importDef.range = definition.range;
				}

				imports.push(importDef);
			}
		}

		return imports;
	}

	/**
	 * 解析 TypeScript/JavaScript import 语句
	 */
	private async parseTypeScriptImports(
		model: ITextModel,
		token: CancellationToken
	): Promise<ImportDefinition[]> {
		const imports: ImportDefinition[] = [];
		const text = model.getValue();
		const lines = text.split('\n');

		// 匹配各种 import 语句
		const namedImportRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/;
		const defaultImportRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/;
		const namespaceImportRegex = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/;

		for (let lineNum = 0; lineNum < lines.length; lineNum++) {
			const line = lines[lineNum];

			// 检查 named imports
			const namedMatch = line.match(namedImportRegex);
			if (namedMatch) {
				const symbols = namedMatch[1].split(',').map(s => s.trim().split(' as ')[0].trim());
				const modulePath = namedMatch[2];

				for (const symbol of symbols) {
					if (symbol) {
						imports.push({
							symbolName: symbol,
							modulePath,
							kind: 'named'
						});
					}
				}
				continue;
			}

			// 检查 namespace imports
			const nsMatch = line.match(namespaceImportRegex);
			if (nsMatch) {
				imports.push({
					symbolName: nsMatch[1],
					modulePath: nsMatch[2],
					kind: 'namespace'
				});
				continue;
			}

			// 检查 default imports
			const defaultMatch = line.match(defaultImportRegex);
			if (defaultMatch) {
				imports.push({
					symbolName: defaultMatch[1],
					modulePath: defaultMatch[2],
					kind: 'default'
				});
			}
		}

		// 尝试解析定义（限制数量避免性能问题）
		const limitedImports = imports.slice(0, 10);
		for (const imp of limitedImports) {
			const definition = await this.resolveImportDefinition(model, imp.symbolName, token);
			if (definition) {
				imp.definitionPath = definition.filepath;
				imp.definitionContent = definition.content;
			}
		}

		return imports;
	}

	/**
	 * 解析 Python import 语句
	 */
	private async parsePythonImports(
		model: ITextModel,
		_token: CancellationToken
	): Promise<ImportDefinition[]> {
		const imports: ImportDefinition[] = [];
		const text = model.getValue();
		const lines = text.split('\n');

		// 匹配 Python import 语句
		const fromImportRegex = /from\s+([\w.]+)\s+import\s+(.+)/;
		const simpleImportRegex = /^import\s+([\w.]+)(?:\s+as\s+(\w+))?/;

		for (const line of lines) {
			const trimmedLine = line.trim();

			// 遇到类/函数定义，停止解析
			if (trimmedLine.startsWith('class ') || trimmedLine.startsWith('def ') ||
				trimmedLine.startsWith('@')) {
				break;
			}

			// from ... import ...
			const fromMatch = trimmedLine.match(fromImportRegex);
			if (fromMatch) {
				const modulePath = fromMatch[1];
				const symbolsPart = fromMatch[2];

				// 处理括号包裹的多行 import
				const symbols = symbolsPart.replace(/[()]/g, '').split(',');
				for (const symbol of symbols) {
					const parts = symbol.trim().split(/\s+as\s+/);
					const symbolName = parts[0].trim();
					if (symbolName && symbolName !== '*') {
						imports.push({
							symbolName,
							modulePath,
							kind: 'from'
						});
					}
				}
				continue;
			}

			// import ...
			const simpleMatch = trimmedLine.match(simpleImportRegex);
			if (simpleMatch) {
				const modulePath = simpleMatch[1];
				const alias = simpleMatch[2];
				const parts = modulePath.split('.');
				imports.push({
					symbolName: alias || parts[parts.length - 1],
					modulePath,
					kind: 'import'
				});
			}
		}

		return imports;
	}

	/**
	 * 解析 Go import 语句
	 */
	private async parseGoImports(
		model: ITextModel,
		_token: CancellationToken
	): Promise<ImportDefinition[]> {
		const imports: ImportDefinition[] = [];
		const text = model.getValue();

		// 匹配 Go import 语句
		const singleImportRegex = /import\s+"([^"]+)"/g;
		const blockImportRegex = /import\s*\(\s*([\s\S]*?)\s*\)/g;

		// 单个 import
		let match;
		while ((match = singleImportRegex.exec(text)) !== null) {
			const modulePath = match[1];
			const parts = modulePath.split('/');
			imports.push({
				symbolName: parts[parts.length - 1],
				modulePath,
				kind: 'import'
			});
		}

		// import 块
		while ((match = blockImportRegex.exec(text)) !== null) {
			const block = match[1];
			const lines = block.split('\n');
			for (const line of lines) {
				const trimmed = line.trim();
				const pathMatch = trimmed.match(/(?:(\w+)\s+)?"([^"]+)"/);
				if (pathMatch) {
					const alias = pathMatch[1];
					const modulePath = pathMatch[2];
					const parts = modulePath.split('/');
					imports.push({
						symbolName: alias || parts[parts.length - 1],
						modulePath,
						kind: 'import'
					});
				}
			}
		}

		return imports;
	}

	/**
	 * 通用 import 解析
	 */
	private async parseGenericImports(
		model: ITextModel,
		_token: CancellationToken
	): Promise<ImportDefinition[]> {
		const imports: ImportDefinition[] = [];
		const text = model.getValue();
		const lines = text.split('\n').slice(0, 50); // 只检查前50行

		// 通用 import 模式
		const patterns = [
			/import\s+[\w{},*\s]+\s+from\s+['"]([^'"]+)['"]/,
			/import\s+['"]([^'"]+)['"]/,
			/require\s*\(\s*['"]([^'"]+)['"]\s*\)/
		];

		for (const line of lines) {
			for (const pattern of patterns) {
				const match = line.match(pattern);
				if (match) {
					const modulePath = match[1];
					const parts = modulePath.split('/');
					imports.push({
						symbolName: parts[parts.length - 1].replace(/\.(js|ts|jsx|tsx)$/, ''),
						modulePath,
						kind: 'import'
					});
					break;
				}
			}
		}

		return imports;
	}

	/**
	 * 解析 Java import 的定义
	 */
	private async resolveJavaImportDefinition(
		model: ITextModel,
		lineNumber: number,
		column: number,
		token: CancellationToken
	): Promise<{ filepath: string; content: string; range: Range } | undefined> {
		try {
			const position = new Position(lineNumber, column);
			const defProviders = this.languageFeaturesService.definitionProvider.ordered(model);

			for (const provider of defProviders) {
				try {
					const definitions = await provider.provideDefinition(model, position, token);
					if (!definitions) {
						continue;
					}

					const defArray = Array.isArray(definitions) ? definitions : [definitions];
					if (defArray.length === 0) {
						continue;
					}

					const firstDef = defArray[0];
					// 安全地获取 targetUri 和 targetRange
					const targetUri = 'targetUri' in firstDef ? firstDef.targetUri as URI : ('uri' in firstDef ? firstDef.uri as URI : undefined);
					const targetRange = 'targetRange' in firstDef ? firstDef.targetRange as Range : ('range' in firstDef ? firstDef.range as Range : undefined);

					if (!targetUri || !targetRange) {
						continue;
					}

					// 读取定义文件内容
					const content = await this.readRangeContent(targetUri, targetRange);
					if (content) {
						return {
							filepath: targetUri.fsPath,
							content,
							range: targetRange
						};
					}
				} catch (e) {
					// 继续尝试下一个提供者
				}
			}
		} catch (error) {
			console.warn('[ImportDefinitionsService] 解析 Java import 定义失败:', error);
		}

		return undefined;
	}

	/**
	 * 解析 import 符号的定义
	 */
	private async resolveImportDefinition(
		model: ITextModel,
		symbolName: string,
		token: CancellationToken
	): Promise<{ filepath: string; content: string } | undefined> {
		try {
			// 在文件中查找符号的使用位置
			const text = model.getValue();
			const symbolIndex = text.indexOf(symbolName);

			if (symbolIndex === -1) {
				return undefined;
			}

			const position = model.getPositionAt(symbolIndex);
			const defProviders = this.languageFeaturesService.definitionProvider.ordered(model);

			for (const provider of defProviders) {
				try {
					const definitions = await provider.provideDefinition(model, position, token);
					if (!definitions) {
						continue;
					}

					const defArray = Array.isArray(definitions) ? definitions : [definitions];
					if (defArray.length === 0) {
						continue;
					}

					const firstDef = defArray[0];
					// 安全地获取 targetUri 和 targetRange
					const targetUri = 'targetUri' in firstDef ? firstDef.targetUri as URI : ('uri' in firstDef ? firstDef.uri as URI : undefined);
					const targetRange = 'targetRange' in firstDef ? firstDef.targetRange as Range : ('range' in firstDef ? firstDef.range as Range : undefined);

					if (!targetUri || !targetRange) {
						continue;
					}

					const content = await this.readRangeContent(targetUri, targetRange);
					if (content) {
						return {
							filepath: targetUri.fsPath,
							content
						};
					}
				} catch (e) {
					// 继续尝试下一个提供者
				}
			}
		} catch (error) {
			console.warn('[ImportDefinitionsService] 解析 import 定义失败:', error);
		}

		return undefined;
	}

	/**
	 * 读取范围内的内容
	 */
	private async readRangeContent(uri: URI, range: Range): Promise<string | undefined> {
		try {
			const targetModel = this.modelService.getModel(uri);
			if (targetModel) {
				// 扩展范围以获取完整的类/函数定义
				const expandedRange = this.expandRange(targetModel, range);
				return targetModel.getValueInRange(expandedRange);
			}
		} catch (error) {
			console.warn('[ImportDefinitionsService] 读取范围内容失败:', error);
		}
		return undefined;
	}

	/**
	 * 扩展范围以获取完整的定义
	 */
	private expandRange(model: ITextModel, range: Range): Range {
		// 向下扩展到类/函数定义结束
		let endLine = range.endLineNumber;
		let braceCount = 0;
		let foundOpenBrace = false;

		for (let line = range.startLineNumber; line <= model.getLineCount() && line < range.startLineNumber + 100; line++) {
			const content = model.getLineContent(line);

			for (const char of content) {
				if (char === '{') {
					braceCount++;
					foundOpenBrace = true;
				} else if (char === '}') {
					braceCount--;
					if (foundOpenBrace && braceCount === 0) {
						endLine = line;
						break;
					}
				}
			}

			if (foundOpenBrace && braceCount === 0) {
				break;
			}
		}

		// 限制最大行数
		const maxLines = 50;
		endLine = Math.min(endLine, range.startLineNumber + maxLines);

		return new Range(
			range.startLineNumber,
			1,
			endLine,
			model.getLineMaxColumn(endLine)
		);
	}

	/**
	 * 从缓存获取
	 */
	private getFromCache(key: string): ImportDefinition[] | undefined {
		const entry = this.cache.get(key);
		if (!entry) {
			return undefined;
		}

		if (Date.now() - entry.timestamp > this.cacheTTL) {
			this.cache.delete(key);
			return undefined;
		}

		// LRU: 移到末尾
		this.cache.delete(key);
		this.cache.set(key, entry);

		return entry.imports;
	}

	/**
	 * 添加到缓存
	 */
	private addToCache(key: string, imports: ImportDefinition[]): void {
		if (this.cache.size >= this.maxCacheSize) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey) {
				this.cache.delete(firstKey);
			}
		}

		this.cache.set(key, {
			imports,
			timestamp: Date.now()
		});
	}

	/**
	 * 清除缓存
	 */
	clearCache(): void {
		this.cache.clear();
	}
}
