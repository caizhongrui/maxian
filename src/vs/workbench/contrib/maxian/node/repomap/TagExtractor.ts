/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TagExtractor - 代码符号提取器
 * 使用 tree-sitter 解析代码并提取定义和引用
 * 参考 Aider 的 get_tags_raw 实现
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as TreeSitter from 'web-tree-sitter';
import { Tag, TagCacheEntry, SupportedLanguage, LanguageConfig } from './types';

/**
 * 语言配置映射
 * 定义每种语言的 tree-sitter query
 */
const LANGUAGE_CONFIGS: Record<SupportedLanguage, LanguageConfig> = {
	[SupportedLanguage.TypeScript]: {
		extensions: ['.ts', '.tsx'],
		treeSitterLanguage: 'typescript',
		definitionQuery: `
			(class_declaration name: (type_identifier) @name.definition.class)
			(function_declaration name: (identifier) @name.definition.function)
			(method_definition name: (property_identifier) @name.definition.method)
			(interface_declaration name: (type_identifier) @name.definition.interface)
			(type_alias_declaration name: (type_identifier) @name.definition.type)
			(enum_declaration name: (identifier) @name.definition.enum)
		`,
		referenceQuery: `
			(call_expression function: (identifier) @name.reference.call)
			(call_expression function: (member_expression property: (property_identifier) @name.reference.call))
			(new_expression constructor: (identifier) @name.reference.call)
			(type_identifier) @name.reference.type
		`
	},
	[SupportedLanguage.JavaScript]: {
		extensions: ['.js', '.jsx', '.mjs', '.cjs'],
		treeSitterLanguage: 'javascript',
		definitionQuery: `
			(class_declaration name: (identifier) @name.definition.class)
			(function_declaration name: (identifier) @name.definition.function)
			(method_definition name: (property_identifier) @name.definition.method)
			(variable_declarator name: (identifier) @name.definition.variable)
		`,
		referenceQuery: `
			(call_expression function: (identifier) @name.reference.call)
			(call_expression function: (member_expression property: (property_identifier) @name.reference.call))
			(identifier) @name.reference
		`
	},
	[SupportedLanguage.Python]: {
		extensions: ['.py', '.pyi'],
		treeSitterLanguage: 'python',
		definitionQuery: `
			(class_definition name: (identifier) @name.definition.class)
			(function_definition name: (identifier) @name.definition.function)
		`,
		referenceQuery: `
			(call function: (identifier) @name.reference.call)
			(call function: (attribute attribute: (identifier) @name.reference.call))
			(identifier) @name.reference
		`
	},
	[SupportedLanguage.Java]: {
		extensions: ['.java'],
		treeSitterLanguage: 'java',
		definitionQuery: `
			(class_declaration name: (identifier) @name.definition.class)
			(method_declaration name: (identifier) @name.definition.method)
			(interface_declaration name: (identifier) @name.definition.interface)
			(enum_declaration name: (identifier) @name.definition.enum)
		`,
		referenceQuery: `
			(method_invocation name: (identifier) @name.reference.call)
			(object_creation_expression type: (type_identifier) @name.reference.call)
			(type_identifier) @name.reference.type
		`
	},
	[SupportedLanguage.Go]: {
		extensions: ['.go'],
		treeSitterLanguage: 'go',
		definitionQuery: `
			(type_declaration (type_spec name: (type_identifier) @name.definition.type))
			(function_declaration name: (identifier) @name.definition.function)
			(method_declaration name: (field_identifier) @name.definition.method)
		`,
		referenceQuery: `
			(call_expression function: (identifier) @name.reference.call)
			(call_expression function: (selector_expression field: (field_identifier) @name.reference.call))
		`
	},
	[SupportedLanguage.Rust]: {
		extensions: ['.rs'],
		treeSitterLanguage: 'rust',
		definitionQuery: `
			(struct_item name: (type_identifier) @name.definition.struct)
			(function_item name: (identifier) @name.definition.function)
			(impl_item type: (type_identifier) @name.definition.impl)
		`,
		referenceQuery: `
			(call_expression function: (identifier) @name.reference.call)
		`
	},
	[SupportedLanguage.C]: {
		extensions: ['.c', '.h'],
		treeSitterLanguage: 'c',
		definitionQuery: `
			(function_definition declarator: (function_declarator declarator: (identifier) @name.definition.function))
			(struct_specifier name: (type_identifier) @name.definition.struct)
		`,
		referenceQuery: `
			(call_expression function: (identifier) @name.reference.call)
		`
	},
	[SupportedLanguage.Cpp]: {
		extensions: ['.cpp', '.hpp', '.cc', '.hh', '.cxx', '.hxx'],
		treeSitterLanguage: 'cpp',
		definitionQuery: `
			(function_definition declarator: (function_declarator declarator: (identifier) @name.definition.function))
			(class_specifier name: (type_identifier) @name.definition.class)
			(struct_specifier name: (type_identifier) @name.definition.struct)
		`,
		referenceQuery: `
			(call_expression function: (identifier) @name.reference.call)
		`
	}
};

/**
 * TagExtractor - 提取代码符号
 */
export class TagExtractor {
	private parsers: Map<SupportedLanguage, TreeSitter.Parser> = new Map();
	private tagsCache: Map<string, TagCacheEntry> = new Map();
	private workspaceRoot: string;
	private verbose: boolean;

	// 扩展名到语言的映射
	private extToLanguage: Map<string, SupportedLanguage> = new Map();

	constructor(workspaceRoot: string, verbose: boolean = false) {
		this.workspaceRoot = workspaceRoot;
		this.verbose = verbose;

		// 构建扩展名映射
		for (const [lang, config] of Object.entries(LANGUAGE_CONFIGS)) {
			for (const ext of config.extensions) {
				this.extToLanguage.set(ext, lang as SupportedLanguage);
			}
		}
	}

	/**
	 * 初始化tree-sitter解析器
	 * 必须在使用前调用
	 */
	async initialize(): Promise<void> {
		try {
			await TreeSitter.Parser.init();

			// 获取wasm文件的基础路径
			// 在VSCode扩展中，使用node_modules相对路径
			const getWasmPath = (filename: string) => {
				// 使用相对路径，构建时会正确解析
				return `${this.workspaceRoot}/node_modules/${filename}`;
			};

			// 初始化TypeScript解析器
			const tsParser = new TreeSitter.Parser();
			try {
				const tsLang = await TreeSitter.Language.load(getWasmPath('tree-sitter-typescript/tree-sitter-typescript.wasm'));
				tsParser.setLanguage(tsLang);
				this.parsers.set(SupportedLanguage.TypeScript, tsParser);
				this.parsers.set(SupportedLanguage.JavaScript, tsParser);
			} catch (e) {
				console.warn('[TagExtractor] TypeScript解析器加载失败:', e);
			}

			// 初始化Python解析器
			const pyParser = new TreeSitter.Parser();
			try {
				const pyLang = await TreeSitter.Language.load(getWasmPath('tree-sitter-python/tree-sitter-python.wasm'));
				pyParser.setLanguage(pyLang);
				this.parsers.set(SupportedLanguage.Python, pyParser);
			} catch (e) {
				console.warn('[TagExtractor] Python解析器加载失败:', e);
			}

			// 初始化Java解析器
			const javaParser = new TreeSitter.Parser();
			try {
				const javaLang = await TreeSitter.Language.load(getWasmPath('tree-sitter-java/tree-sitter-java.wasm'));
				javaParser.setLanguage(javaLang);
				this.parsers.set(SupportedLanguage.Java, javaParser);
			} catch (e) {
				console.warn('[TagExtractor] Java解析器加载失败:', e);
			}

			if (this.verbose) {
				console.log('[TagExtractor] 初始化完成，支持语言:', Array.from(this.parsers.keys()));
			}
		} catch (error) {
			console.error('[TagExtractor] 初始化失败:', error);
			// 即使初始化失败，也不抛出错误，只是功能降级
		}
	}

	/**
	 * 获取文件的tags（带缓存）
	 * 参考 Aider 的 get_tags 方法
	 */
	async getTags(filePath: string): Promise<Tag[]> {
		try {
			// 获取文件修改时间
			const stat = await fs.stat(filePath);
			const mtime = stat.mtimeMs;

			// 检查缓存
			const cached = this.tagsCache.get(filePath);
			if (cached && cached.mtime === mtime) {
				if (this.verbose) {
					console.log('[TagExtractor] 使用缓存:', filePath);
				}
				return cached.data;
			}

			// 提取tags
			const tags = await this.extractTagsRaw(filePath);

			// 更新缓存
			this.tagsCache.set(filePath, { mtime, data: tags });

			return tags;
		} catch (error) {
			console.error('[TagExtractor] 提取tags失败:', filePath, error);
			return [];
		}
	}

	/**
	 * 原始tag提取（无缓存）
	 * 参考 Aider 的 get_tags_raw 方法
	 */
	private async extractTagsRaw(filePath: string): Promise<Tag[]> {
		// 1. 确定语言
		const ext = path.extname(filePath);
		const language = this.extToLanguage.get(ext);

		if (!language) {
			if (this.verbose) {
				console.log('[TagExtractor] 不支持的文件类型:', ext);
			}
			return [];
		}

		// 2. 获取解析器
		const parser = this.parsers.get(language);
		if (!parser) {
			console.error('[TagExtractor] 未找到解析器:', language);
			return [];
		}

		// 3. 读取文件内容
		const code = await fs.readFile(filePath, 'utf-8');
		if (!code) {
			return [];
		}

		// 4. 解析代码
		const tree = parser.parse(code);
		if (!tree) {
			console.error('[TagExtractor] 解析失败:', filePath);
			return [];
		}

		const relPath = path.relative(this.workspaceRoot, filePath);

		// 5. 提取定义和引用
		const config = LANGUAGE_CONFIGS[language];
		const defs = await this.extractWithQuery(tree, config.definitionQuery, 'def', relPath, filePath);
		const refs = await this.extractWithQuery(tree, config.referenceQuery, 'ref', relPath, filePath);

		if (this.verbose) {
			console.log(`[TagExtractor] ${filePath}: ${defs.length} 定义, ${refs.length} 引用`);
		}

		return [...defs, ...refs];
	}

	/**
	 * 使用query提取符号
	 */
	private async extractWithQuery(
		tree: TreeSitter.Tree,
		queryStr: string,
		kind: 'def' | 'ref',
		relPath: string,
		absPath: string
	): Promise<Tag[]> {
		const tags: Tag[] = [];

		try {
			// 创建query
			const query = tree.language.query(queryStr);

			// 执行query
			const captures = query.captures(tree.rootNode);

			// 处理每个捕获
			for (const capture of captures) {
				const node = capture.node;
				const name = node.text;

				// 过滤掉过短或无效的名称
				if (!name || name.length < 2) {
					continue;
				}

				tags.push({
					relFname: relPath,
					fname: absPath,
					name,
					kind,
					line: node.startPosition.row
				});
			}
		} catch (error) {
			console.error('[TagExtractor] Query执行失败:', error);
		}

		return tags;
	}

	/**
	 * 批量提取tags
	 */
	async extractTagsFromFiles(filePaths: string[]): Promise<Tag[]> {
		const allTags: Tag[] = [];

		for (const filePath of filePaths) {
			const tags = await this.getTags(filePath);
			allTags.push(...tags);
		}

		return allTags;
	}

	/**
	 * 清除缓存
	 */
	clearCache(): void {
		this.tagsCache.clear();
		if (this.verbose) {
			console.log('[TagExtractor] 缓存已清除');
		}
	}

	/**
	 * 获取缓存统计
	 */
	getCacheStats(): { size: number; hitRate: number } {
		return {
			size: this.tagsCache.size,
			hitRate: 0 // 简化实现，暂不跟踪命中率
		};
	}
}
