/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * RepoMap类型定义
 * 参考Aider的实现
 */

/**
 * 代码符号标签
 */
export interface Tag {
	relFname: string;    // 相对文件路径（相对于工作区根目录）
	fname: string;       // 绝对文件路径
	name: string;        // 符号名称（类名、函数名、方法名等）
	kind: 'def' | 'ref'; // 定义(definition)或引用(reference)
	line: number;        // 行号（0-based）
	signature?: string;  // 函数/方法签名（可选）
}

/**
 * 图的边（引用关系）
 */
export interface GraphEdge {
	from: string;        // 引用者文件
	to: string;          // 被引用文件
	weight: number;      // 权重
	ident: string;       // 标识符名称
}

/**
 * 排序后的文件
 */
export interface RankedFile {
	fname: string;       // 文件路径
	rank: number;        // PageRank得分
	tags: Tag[];         // 包含的tags
}

/**
 * Tag缓存条目
 */
export interface TagCacheEntry {
	mtime: number;       // 文件修改时间（毫秒时间戳）
	data: Tag[];         // 提取的tags
}

/**
 * Tree渲染缓存key
 */
export interface TreeCacheKey {
	relFname: string;    // 文件相对路径
	lois: number[];      // lines of interest（感兴趣的行号）
	mtime: number;       // 修改时间
}

/**
 * RepoMap配置选项
 */
export interface RepoMapOptions {
	workspaceRoot: string;           // 工作区根目录
	maxTokens?: number;              // 最大token预算（默认2048）
	mapMulNoFiles?: number;          // 无chat files时的倍数（默认8）
	cacheDir?: string;               // 缓存目录（默认.maxian/repomap-cache）
	supportedExtensions?: string[];  // 支持的文件扩展名
	verbose?: boolean;               // 是否输出详细日志
}

/**
 * RepoMap生成上下文
 */
export interface RepoMapContext {
	chatFiles: string[];             // 当前对话中的文件
	otherFiles: string[];            // 其他文件
	mentionedFiles?: Set<string>;    // 用户提到的文件
	mentionedIdents?: Set<string>;   // 用户提到的标识符
	tokenBudget: number;             // Token预算
}

/**
 * 支持的编程语言
 */
export enum SupportedLanguage {
	TypeScript = 'typescript',
	JavaScript = 'javascript',
	Python = 'python',
	Java = 'java',
	Go = 'go',
	Rust = 'rust',
	C = 'c',
	Cpp = 'cpp'
}

/**
 * 语言配置
 */
export interface LanguageConfig {
	extensions: string[];            // 文件扩展名
	treeSitterLanguage: string;      // tree-sitter语言名
	definitionQuery: string;         // 定义查询
	referenceQuery: string;          // 引用查询
}

/**
 * PageRank配置
 */
export interface PageRankConfig {
	damping: number;                 // 阻尼系数（默认0.85）
	maxIterations: number;           // 最大迭代次数（默认100）
	tolerance: number;               // 收敛容差（默认1e-6）
}

/**
 * 符号权重计算因子
 */
export interface WeightFactors {
	mentionedIdent: number;          // 用户提到的标识符（默认×10）
	longNamedIdent: number;          // 长命名标识符（默认×10）
	privateIdent: number;            // 私有标识符（默认×0.1）
	commonName: number;              // 常见名称（默认×0.1）
	chatFileReference: number;       // chat文件引用（默认×50）
}
