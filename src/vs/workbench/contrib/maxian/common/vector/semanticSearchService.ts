/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 语义搜索服务
 * 对外提供 semanticSearch(query, cwd, maxResults) 接口
 * 内部负责：
 *   1. 触发索引（如果不存在或过期）
 *   2. 将 query 向量化
 *   3. vectorStore.search 找 TopK
 *   4. 返回包含文件路径、行号、代码片段的结果
 */

import { EmbeddingService } from './embeddingService.js';
import { getVectorStore, VectorSearchResult } from './vectorStore.js';
import { CodebaseIndexer } from './codebaseIndexer.js';

/**
 * 语义搜索结果
 */
export interface SemanticSearchResult {
	/** 文件相对路径（相对于 cwd） */
	relPath: string;
	/** 文件绝对路径 */
	filePath: string;
	/** 起始行号（1-based） */
	startLine: number;
	/** 结束行号（1-based） */
	endLine: number;
	/** 代码片段 */
	code: string;
	/** 相似度分数（0-1） */
	score: number;
}

/**
 * 索引状态追踪（按 cwd）
 */
interface IndexState {
	/** 是否正在索引中 */
	indexing: boolean;
	/** 索引完成时间 */
	lastIndexedAt: number;
	/** 索引中的 Promise */
	indexingPromise: Promise<void> | null;
}

const _indexStates = new Map<string, IndexState>();

/**
 * 获取或创建索引状态
 */
function getIndexState(cwd: string): IndexState {
	let state = _indexStates.get(cwd);
	if (!state) {
		state = {
			indexing: false,
			lastIndexedAt: 0,
			indexingPromise: null,
		};
		_indexStates.set(cwd, state);
	}
	return state;
}

/**
 * 索引过期时间：30 分钟
 */
const INDEX_TTL_MS = 30 * 60 * 1000;

/**
 * SemanticSearchService: 高层语义搜索 API
 */
export class SemanticSearchService {
	private static _instance: SemanticSearchService | null = null;

	private readonly embeddingService: EmbeddingService;
	private readonly indexer: CodebaseIndexer;

	static getInstance(): SemanticSearchService {
		if (!SemanticSearchService._instance) {
			SemanticSearchService._instance = new SemanticSearchService();
		}
		return SemanticSearchService._instance;
	}

	private constructor() {
		this.embeddingService = EmbeddingService.getInstance();
		this.indexer = new CodebaseIndexer();
	}

	/**
	 * 执行语义搜索
	 * @param query 查询文本（支持中文/英文）
	 * @param cwd 工作区根目录
	 * @param maxResults 返回最大结果数（默认 10）
	 * @returns 语义搜索结果数组
	 */
	async semanticSearch(
		query: string,
		cwd: string,
		maxResults: number = 10
	): Promise<SemanticSearchResult[]> {
		const normalizedCwd = cwd.replace(/\/$/, '');
		const startTime = Date.now();

		// 1. 确保索引存在（异步触发，不阻塞搜索）
		await this.ensureIndexed(normalizedCwd);

		// 2. 将 query 向量化
		let queryVector: number[];
		try {
			queryVector = await this.embeddingService.embedQuery(query);
		} catch (error) {
			console.error('[SemanticSearch] query 向量化失败:', error);
			throw new Error(`语义向量化失败: ${error instanceof Error ? error.message : String(error)}`);
		}

		// 3. 向量搜索
		const vectorStore = getVectorStore(normalizedCwd);
		let results: VectorSearchResult[];
		try {
			results = await vectorStore.search(queryVector, maxResults * 2, query); // 多取一些，后续去重过滤
		} catch (error) {
			console.error('[SemanticSearch] 向量搜索失败:', error);
			throw new Error(`向量搜索失败: ${error instanceof Error ? error.message : String(error)}`);
		}

		// 4. 格式化结果
		const path = await import('path');
		const searchResults: SemanticSearchResult[] = results
			.filter(r => r.score > 0.3) // 过滤低相似度结果
			.slice(0, maxResults)
			.map(r => ({
				relPath: path.relative(normalizedCwd, r.metadata.filePath),
				filePath: r.metadata.filePath,
				startLine: r.metadata.startLine,
				endLine: r.metadata.endLine,
				code: r.metadata.code,
				score: r.score,
			}));

		const elapsed = Date.now() - startTime;
		console.log(`[SemanticSearch] 搜索完成，查询: "${query}"，耗时: ${elapsed}ms，结果数: ${searchResults.length}`);

		return searchResults;
	}

	/**
	 * 确保工作区索引存在且不过期
	 * 如果索引不存在或已过期，触发重新索引
	 * 如果索引正在进行中，等待其完成
	 */
	async ensureIndexed(cwd: string): Promise<void> {
		const state = getIndexState(cwd);
		const now = Date.now();

		// 如果正在索引，等待完成
		if (state.indexing && state.indexingPromise) {
			await state.indexingPromise;
			return;
		}

		// 检查索引是否存在
		const vectorStore = getVectorStore(cwd);
		const itemCount = await vectorStore.getItemCount().catch(() => 0);
		const isExpired = now - state.lastIndexedAt > INDEX_TTL_MS;

		if (itemCount === 0 || isExpired) {
			// 触发索引
			console.log('[SemanticSearch] 触发工作区索引，itemCount:', itemCount, 'isExpired:', isExpired);
			state.indexing = true;
			state.indexingPromise = this.indexer.indexWorkspace(cwd, {
				onProgress: (progress) => {
					if (progress.phase === 'indexing' && progress.indexed % 10 === 0) {
						console.log(`[SemanticSearch] 索引进度: ${progress.indexed}/${progress.total}`);
					}
				}
			}).then(() => {
				state.lastIndexedAt = Date.now();
				state.indexing = false;
				state.indexingPromise = null;
				console.log('[SemanticSearch] 工作区索引完成');
			}).catch((error) => {
				console.error('[SemanticSearch] 工作区索引失败:', error);
				state.indexing = false;
				state.indexingPromise = null;
			});

			// 等待索引完成（第一次必须等待，后续可以异步）
			if (itemCount === 0) {
				// 索引为空时，必须等待索引完成再搜索
				await state.indexingPromise;
			}
			// 如果已有部分索引但过期，后台刷新，不阻塞本次搜索
		}
	}

	/**
	 * 格式化语义搜索结果为字符串（供工具返回使用）
	 * @param results 搜索结果
	 * @param query 原始查询
	 * @returns 格式化字符串
	 */
	formatResults(results: SemanticSearchResult[], query: string): string {
		if (results.length === 0) {
			return `语义搜索未找到与 "${query}" 相关的代码。\n\n建议：尝试使用 search_files 进行关键字搜索。`;
		}

		const lines: string[] = [
			`语义搜索找到 ${results.length} 个相关代码片段 (查询: "${query}"):\n`
		];

		for (const result of results) {
			// 规范化路径，使用正斜杠
			const normalizedPath = result.relPath.replace(/\\/g, '/');
			lines.push(`# ${normalizedPath} (相似度: ${(result.score * 100).toFixed(1)}%)`);
			lines.push(`行 ${result.startLine}-${result.endLine}:`);

			// 展示代码片段（限制显示行数）
			const codeLines = result.code.split('\n').slice(0, 20);
			for (let i = 0; i < codeLines.length; i++) {
				const lineNum = String(result.startLine + i).padStart(4, ' ');
				lines.push(`${lineNum} | ${codeLines[i]}`);
			}

			if (result.code.split('\n').length > 20) {
				lines.push('     ... (更多行省略)');
			}

			lines.push('----');
			lines.push('');
		}

		return lines.join('\n').trim();
	}

	/**
	 * 触发单个文件的增量索引更新
	 * （用于文件保存时触发）
	 * @param filePath 文件绝对路径
	 * @param cwd 工作区根目录
	 */
	async indexFile(filePath: string, cwd: string): Promise<void> {
		try {
			await this.indexer.indexFile(filePath, cwd);
			console.log('[SemanticSearch] 文件索引更新:', filePath);
		} catch (error) {
			console.warn('[SemanticSearch] 文件索引更新失败:', filePath, error);
		}
	}

	/**
	 * 重置工作区索引（强制重建）
	 * @param cwd 工作区根目录
	 */
	async resetIndex(cwd: string): Promise<void> {
		const vectorStore = getVectorStore(cwd);
		await vectorStore.clear();
		const state = getIndexState(cwd);
		state.lastIndexedAt = 0;
		console.log('[SemanticSearch] 工作区索引已重置:', cwd);
	}

	/**
	 * 获取索引统计信息
	 * @param cwd 工作区根目录
	 */
	async getIndexStats(cwd: string): Promise<{ itemCount: number; indexDir: string; isIndexing: boolean; lastIndexedAt: number }> {
		const normalizedCwd = cwd.replace(/\/$/, '');
		const vectorStore = getVectorStore(normalizedCwd);
		const state = getIndexState(normalizedCwd);

		const itemCount = await vectorStore.getItemCount().catch(() => 0);

		return {
			itemCount,
			indexDir: vectorStore.getIndexDir(),
			isIndexing: state.indexing,
			lastIndexedAt: state.lastIndexedAt,
		};
	}
}
