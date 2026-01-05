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

/**
 * 类型定义信息
 */
export interface TypeDefinitionInfo {
	/** 类型名称 */
	typeName: string;
	/** 文件路径 */
	filepath: string;
	/** 类型定义的源代码 */
	content: string;
	/** 字段列表 */
	fields: FieldInfo[];
	/** 方法列表 */
	methods: MethodInfo[];
	/** 范围 */
	range: Range;
}

/**
 * 字段信息
 */
export interface FieldInfo {
	name: string;
	type: string;
	accessModifier?: string;
}

/**
 * 方法信息
 */
export interface MethodInfo {
	name: string;
	returnType: string;
	parameters: string[];
	accessModifier?: string;
}

/**
 * 缓存项
 */
interface CacheEntry {
	info: TypeDefinitionInfo;
	timestamp: number;
}

/**
 * LSP 类型定义服务
 * 使用 VSCode 语言特性 API 获取类型定义
 */
export class TypeDefinitionService {

	// LRU 缓存，key 为 "filepath:typeName"
	private cache: Map<string, CacheEntry> = new Map();
	private readonly maxCacheSize = 200;
	private readonly cacheTTL = 5 * 60 * 1000; // 5 分钟

	constructor(
		private readonly languageFeaturesService: ILanguageFeaturesService
	) { }

	/**
	 * 获取光标位置的类型定义
	 */
	async getTypeDefinitionAtPosition(
		model: ITextModel,
		position: Position,
		token: CancellationToken
	): Promise<TypeDefinitionInfo | undefined> {
		try {
			// 1. 使用类型定义提供者
			const typeDefProviders = this.languageFeaturesService.typeDefinitionProvider.ordered(model);
			if (typeDefProviders.length === 0) {
				console.log('[TypeDefinitionService] 无类型定义提供者');
				return undefined;
			}

			// 2. 获取类型定义位置
			for (const provider of typeDefProviders) {
				try {
					const definitions = await provider.provideTypeDefinition(model, position, token);
					if (!definitions) {
						continue;
					}

					const defArray = Array.isArray(definitions) ? definitions : [definitions];
					if (defArray.length === 0) {
						continue;
					}

					// 取第一个定义
					const firstDef = defArray[0];
					// 安全地获取 targetUri 和 targetRange
					const targetUri = 'targetUri' in firstDef ? firstDef.targetUri as URI : ('uri' in firstDef ? firstDef.uri as URI : undefined);
					const targetRange = 'targetRange' in firstDef ? firstDef.targetRange as Range : ('range' in firstDef ? firstDef.range as Range : undefined);

					if (!targetUri || !targetRange) {
						continue;
					}

					// 3. 读取类型定义内容
					const typeInfo = await this.readTypeDefinition(targetUri, targetRange, token);
					if (typeInfo) {
						return typeInfo;
					}
				} catch (e) {
					console.warn('[TypeDefinitionService] 提供者调用失败:', e);
				}
			}

			// 4. 降级：使用定义提供者
			return await this.fallbackToDefinition(model, position, token);

		} catch (error) {
			console.error('[TypeDefinitionService] 获取类型定义失败:', error);
			return undefined;
		}
	}

	/**
	 * 通过类名获取类型定义
	 */
	async getTypeDefinitionByName(
		model: ITextModel,
		typeName: string,
		searchRange: Range,
		token: CancellationToken
	): Promise<TypeDefinitionInfo | undefined> {
		// 检查缓存
		const cacheKey = `${model.uri.toString()}:${typeName}`;
		const cached = this.getFromCache(cacheKey);
		if (cached) {
			return cached;
		}

		try {
			// 在搜索范围内查找类型名称的位置
			const text = model.getValueInRange(searchRange);
			const typeNameRegex = new RegExp(`\\b${this.escapeRegExp(typeName)}\\b`, 'g');
			const match = typeNameRegex.exec(text);

			if (!match) {
				return undefined;
			}

			// 计算类型名称在文档中的位置
			const offset = model.getOffsetAt(new Position(searchRange.startLineNumber, searchRange.startColumn));
			const typeOffset = offset + match.index;
			const typePosition = model.getPositionAt(typeOffset);

			// 获取类型定义
			const typeInfo = await this.getTypeDefinitionAtPosition(model, typePosition, token);

			if (typeInfo) {
				// 添加到缓存
				this.addToCache(cacheKey, typeInfo);
			}

			return typeInfo;

		} catch (error) {
			console.error('[TypeDefinitionService] 通过名称获取类型定义失败:', error);
			return undefined;
		}
	}

	/**
	 * 解析 Java 方法引用（如 OtaVersion::getXxx）
	 * 返回该类的所有 getter 方法
	 */
	async resolveJavaMethodReference(
		model: ITextModel,
		className: string,
		position: Position,
		token: CancellationToken
	): Promise<string[]> {
		try {
			// 查找类名位置
			const lineContent = model.getLineContent(position.lineNumber);
			const classIndex = lineContent.indexOf(className);

			if (classIndex === -1) {
				return [];
			}

			// 获取类的类型定义
			const classPosition = new Position(position.lineNumber, classIndex + 1);
			const typeInfo = await this.getTypeDefinitionAtPosition(model, classPosition, token);

			if (!typeInfo) {
				return [];
			}

			// 返回所有 getter 方法名
			return typeInfo.methods
				.filter(m => m.name.startsWith('get') || m.name.startsWith('is'))
				.map(m => m.name);

		} catch (error) {
			console.error('[TypeDefinitionService] 解析 Java 方法引用失败:', error);
			return [];
		}
	}

	/**
	 * 降级到定义提供者
	 */
	private async fallbackToDefinition(
		model: ITextModel,
		position: Position,
		token: CancellationToken
	): Promise<TypeDefinitionInfo | undefined> {
		const defProviders = this.languageFeaturesService.definitionProvider.ordered(model);
		if (defProviders.length === 0) {
			return undefined;
		}

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

				return await this.readTypeDefinition(targetUri, targetRange, token);
			} catch (e) {
				console.warn('[TypeDefinitionService] 定义提供者调用失败:', e);
			}
		}

		return undefined;
	}

	/**
	 * 读取类型定义内容
	 */
	private async readTypeDefinition(
		uri: URI,
		range: Range,
		_token: CancellationToken
	): Promise<TypeDefinitionInfo | undefined> {
		try {
			// 使用 monaco 的 model 服务读取文件
			// 这里我们需要返回一个基础信息，实际的文件读取由调用者处理
			const typeName = this.extractTypeName(uri.path);

			return {
				typeName,
				filepath: uri.fsPath,
				content: '', // 将由调用者填充
				fields: [],
				methods: [],
				range
			};
		} catch (error) {
			console.error('[TypeDefinitionService] 读取类型定义失败:', error);
			return undefined;
		}
	}

	/**
	 * 从文件路径提取类型名
	 */
	private extractTypeName(filepath: string): string {
		const filename = filepath.split('/').pop() || filepath.split('\\').pop() || '';
		return filename.replace(/\.(java|ts|tsx|js|jsx|py|go|rs)$/i, '');
	}

	/**
	 * 从缓存获取
	 */
	private getFromCache(key: string): TypeDefinitionInfo | undefined {
		const entry = this.cache.get(key);
		if (!entry) {
			return undefined;
		}

		// 检查是否过期
		if (Date.now() - entry.timestamp > this.cacheTTL) {
			this.cache.delete(key);
			return undefined;
		}

		// LRU: 移到末尾
		this.cache.delete(key);
		this.cache.set(key, entry);

		return entry.info;
	}

	/**
	 * 添加到缓存
	 */
	private addToCache(key: string, info: TypeDefinitionInfo): void {
		// 检查容量
		if (this.cache.size >= this.maxCacheSize) {
			// 删除最旧的条目
			const firstKey = this.cache.keys().next().value;
			if (firstKey) {
				this.cache.delete(firstKey);
			}
		}

		this.cache.set(key, {
			info,
			timestamp: Date.now()
		});
	}

	/**
	 * 清除缓存
	 */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * 转义正则表达式特殊字符
	 */
	private escapeRegExp(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
}
