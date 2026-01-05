/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Position } from '../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { Range } from '../../../../editor/common/core/range.js';

/**
 * Java 方法引用信息
 */
export interface JavaMethodReference {
	/** 类名 */
	className: string;
	/** 方法名前缀（用户已输入的部分） */
	methodPrefix: string;
	/** 在代码中的位置 */
	position: Position;
	/** 是否是静态方法引用 */
	isStatic: boolean;
}

/**
 * 类的方法信息
 */
export interface ClassMethodInfo {
	/** 类名 */
	className: string;
	/** 类的完整路径 */
	classPath?: string;
	/** 所有 getter 方法 */
	getterMethods: string[];
	/** 所有 setter 方法 */
	setterMethods: string[];
	/** 所有公共方法 */
	publicMethods: string[];
	/** 所有字段 */
	fields: FieldDefinition[];
}

/**
 * 字段定义
 */
export interface FieldDefinition {
	name: string;
	type: string;
	accessModifier: string;
}

/**
 * 缓存项
 */
interface ClassInfoCacheEntry {
	info: ClassMethodInfo;
	timestamp: number;
}

/**
 * Java 方法引用解析器
 * 专门处理 Java 中的方法引用语法（如 ClassName::methodName）
 */
export class JavaMethodReferenceParser {

	// 类信息缓存
	private classInfoCache: Map<string, ClassInfoCacheEntry> = new Map();
	private readonly maxCacheSize = 100;
	private readonly cacheTTL = 10 * 60 * 1000; // 10 分钟

	constructor(
		private readonly languageFeaturesService: ILanguageFeaturesService,
		private readonly modelService: IModelService
	) { }

	/**
	 * 检测当前位置是否在 Java 方法引用中
	 * 模式: ClassName::methodName 或 ClassName::
	 */
	detectMethodReference(
		model: ITextModel,
		position: Position
	): JavaMethodReference | undefined {
		const lineContent = model.getLineContent(position.lineNumber);
		const textBeforeCursor = lineContent.substring(0, position.column - 1);

		// 匹配 ClassName:: 或 ClassName::get 等模式
		// 支持: SomeClass::, SomeClass::get, SomeClass::getSome
		const methodRefPattern = /([A-Z][a-zA-Z0-9_]*)::([a-zA-Z0-9_]*)?$/;
		const match = textBeforeCursor.match(methodRefPattern);

		if (!match) {
			return undefined;
		}

		return {
			className: match[1],
			methodPrefix: match[2] || '',
			position: new Position(position.lineNumber, position.column - (match[2]?.length || 0)),
			isStatic: true // 默认假设是静态引用
		};
	}

	/**
	 * 获取类的方法信息
	 */
	async getClassMethodInfo(
		model: ITextModel,
		className: string,
		token: CancellationToken
	): Promise<ClassMethodInfo | undefined> {
		// 检查缓存
		const cacheKey = `${model.uri.toString()}:${className}`;
		const cached = this.getFromCache(cacheKey);
		if (cached) {
			return cached;
		}

		try {
			// 1. 在当前文件或导入中查找类名
			const classPosition = await this.findClassNamePosition(model, className);

			if (!classPosition) {
				console.log(`[JavaMethodReferenceParser] 未找到类: ${className}`);
				return undefined;
			}

			// 2. 使用 LSP 获取类定义
			const classDefinition = await this.getClassDefinition(model, classPosition, token);

			if (!classDefinition) {
				console.log(`[JavaMethodReferenceParser] 无法获取类定义: ${className}`);
				return undefined;
			}

			// 3. 解析类的方法和字段
			const classInfo = this.parseClassContent(className, classDefinition.content, classDefinition.filepath);

			// 4. 添加到缓存
			this.addToCache(cacheKey, classInfo);

			return classInfo;

		} catch (error) {
			console.error('[JavaMethodReferenceParser] 获取类方法信息失败:', error);
			return undefined;
		}
	}

	/**
	 * 获取方法引用的候选列表
	 */
	async getMethodReferenceCandidates(
		model: ITextModel,
		methodRef: JavaMethodReference,
		token: CancellationToken
	): Promise<string[]> {
		const classInfo = await this.getClassMethodInfo(model, methodRef.className, token);

		if (!classInfo) {
			return [];
		}

		// 根据前缀过滤
		let candidates: string[] = [];

		if (methodRef.methodPrefix.toLowerCase().startsWith('get')) {
			// 用户输入 get，只返回 getter 方法
			candidates = classInfo.getterMethods;
		} else if (methodRef.methodPrefix.toLowerCase().startsWith('set')) {
			// 用户输入 set，只返回 setter 方法
			candidates = classInfo.setterMethods;
		} else if (methodRef.methodPrefix.toLowerCase().startsWith('is')) {
			// 用户输入 is，返回 is 开头的方法
			candidates = classInfo.getterMethods.filter(m => m.startsWith('is'));
		} else if (methodRef.methodPrefix) {
			// 有其他前缀，搜索所有方法
			candidates = classInfo.publicMethods;
		} else {
			// 无前缀，返回所有 getter（最常用于 Lambda 表达式）
			candidates = classInfo.getterMethods;
		}

		// 按前缀过滤
		if (methodRef.methodPrefix) {
			candidates = candidates.filter(m =>
				m.toLowerCase().startsWith(methodRef.methodPrefix.toLowerCase())
			);
		}

		return candidates;
	}

	/**
	 * 生成方法引用的补全提示
	 * 返回类似: "可用的方法: getId, getName, getVersion, ..."
	 */
	async generateMethodReferenceHint(
		model: ITextModel,
		methodRef: JavaMethodReference,
		token: CancellationToken
	): Promise<string> {
		const candidates = await this.getMethodReferenceCandidates(model, methodRef, token);

		if (candidates.length === 0) {
			return '';
		}

		// 限制显示数量
		const displayCandidates = candidates.slice(0, 10);
		const hasMore = candidates.length > 10;

		return `【${methodRef.className} 可用方法】: ${displayCandidates.join(', ')}${hasMore ? ', ...' : ''}`;
	}

	/**
	 * 在文件中查找类名位置
	 */
	private async findClassNamePosition(
		model: ITextModel,
		className: string
	): Promise<Position | undefined> {
		const text = model.getValue();
		const lines = text.split('\n');

		// 方法1: 在 import 语句中查找
		const importPattern = new RegExp(`import\\s+[\\w.]+\\.${className}\\s*;`);
		for (let i = 0; i < lines.length; i++) {
			const match = lines[i].match(importPattern);
			if (match) {
				const classIndex = lines[i].indexOf(className);
				return new Position(i + 1, classIndex + 1);
			}
		}

		// 方法2: 在类型声明中查找
		const typePattern = new RegExp(`\\b${className}\\b`);
		for (let i = 0; i < lines.length; i++) {
			const match = lines[i].match(typePattern);
			if (match && match.index !== undefined) {
				return new Position(i + 1, match.index + 1);
			}
		}

		return undefined;
	}

	/**
	 * 获取类定义内容
	 */
	private async getClassDefinition(
		model: ITextModel,
		position: Position,
		token: CancellationToken
	): Promise<{ content: string; filepath: string } | undefined> {
		// 使用定义提供者
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

				// 读取类定义文件
				const targetModel = this.modelService.getModel(targetUri);
				if (targetModel) {
					// 扩展范围获取整个类
					const expandedRange = this.expandToFullClass(targetModel, targetRange);
					const content = targetModel.getValueInRange(expandedRange);

					return {
						content,
						filepath: targetUri.fsPath
					};
				}
			} catch (e) {
				// 继续尝试下一个提供者
			}
		}

		return undefined;
	}

	/**
	 * 扩展范围以获取完整的类定义
	 */
	private expandToFullClass(model: ITextModel, range: Range): Range {
		let startLine = range.startLineNumber;
		let endLine = range.endLineNumber;

		// 向上查找类声明
		for (let i = startLine; i >= 1; i--) {
			const line = model.getLineContent(i);
			if (/^\s*(public\s+)?(class|interface|enum)\s+/.test(line)) {
				startLine = i;
				break;
			}
		}

		// 向下查找类结束（匹配大括号）
		let braceCount = 0;
		let foundOpenBrace = false;

		for (let i = startLine; i <= model.getLineCount(); i++) {
			const line = model.getLineContent(i);

			for (const char of line) {
				if (char === '{') {
					braceCount++;
					foundOpenBrace = true;
				} else if (char === '}') {
					braceCount--;
					if (foundOpenBrace && braceCount === 0) {
						endLine = i;
						break;
					}
				}
			}

			if (foundOpenBrace && braceCount === 0) {
				break;
			}
		}

		// 限制最大行数
		const maxLines = 200;
		endLine = Math.min(endLine, startLine + maxLines);

		return new Range(startLine, 1, endLine, model.getLineMaxColumn(endLine));
	}

	/**
	 * 解析类内容，提取方法和字段
	 */
	private parseClassContent(
		className: string,
		content: string,
		classPath?: string
	): ClassMethodInfo {
		const getterMethods: string[] = [];
		const setterMethods: string[] = [];
		const publicMethods: string[] = [];
		const fields: FieldDefinition[] = [];

		const lines = content.split('\n');

		for (const line of lines) {
			const trimmedLine = line.trim();

			// 解析字段
			const fieldMatch = trimmedLine.match(
				/^\s*(private|protected|public)?\s*(final\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*[;=]/
			);
			if (fieldMatch) {
				fields.push({
					accessModifier: fieldMatch[1] || 'package',
					type: fieldMatch[3],
					name: fieldMatch[4]
				});
				continue;
			}

			// 解析方法
			const methodMatch = trimmedLine.match(
				/^\s*(public|protected|private)?\s*(static\s+)?(\w+(?:<[^>]+>)?)\s+(\w+)\s*\(/
			);
			if (methodMatch) {
				const accessModifier = methodMatch[1] || 'package';
				const methodName = methodMatch[4];

				// 跳过构造函数
				if (methodName === className) {
					continue;
				}

				// 分类方法
				if (methodName.startsWith('get') || methodName.startsWith('is')) {
					getterMethods.push(methodName);
				} else if (methodName.startsWith('set')) {
					setterMethods.push(methodName);
				}

				if (accessModifier === 'public') {
					publicMethods.push(methodName);
				}
			}
		}

		// 基于字段名生成可能的 getter 方法名（如果没有解析到）
		if (getterMethods.length === 0 && fields.length > 0) {
			for (const field of fields) {
				const capitalizedName = field.name.charAt(0).toUpperCase() + field.name.slice(1);

				if (field.type === 'boolean' || field.type === 'Boolean') {
					getterMethods.push(`is${capitalizedName}`);
				}
				getterMethods.push(`get${capitalizedName}`);
				setterMethods.push(`set${capitalizedName}`);
			}
		}

		return {
			className,
			classPath,
			getterMethods: [...new Set(getterMethods)].sort(),
			setterMethods: [...new Set(setterMethods)].sort(),
			publicMethods: [...new Set(publicMethods)].sort(),
			fields
		};
	}

	/**
	 * 从缓存获取
	 */
	private getFromCache(key: string): ClassMethodInfo | undefined {
		const entry = this.classInfoCache.get(key);
		if (!entry) {
			return undefined;
		}

		if (Date.now() - entry.timestamp > this.cacheTTL) {
			this.classInfoCache.delete(key);
			return undefined;
		}

		// LRU: 移到末尾
		this.classInfoCache.delete(key);
		this.classInfoCache.set(key, entry);

		return entry.info;
	}

	/**
	 * 添加到缓存
	 */
	private addToCache(key: string, info: ClassMethodInfo): void {
		if (this.classInfoCache.size >= this.maxCacheSize) {
			const firstKey = this.classInfoCache.keys().next().value;
			if (firstKey) {
				this.classInfoCache.delete(firstKey);
			}
		}

		this.classInfoCache.set(key, {
			info,
			timestamp: Date.now()
		});
	}

	/**
	 * 清除缓存
	 */
	clearCache(): void {
		this.classInfoCache.clear();
	}
}
