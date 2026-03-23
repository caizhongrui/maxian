/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 向量存储层
 * 封装 vectra 的 LocalIndex，提供 addItem/search/clear 等操作
 * 索引文件存在 ${cwd}/.maxian/index/ 目录
 */

import type { LocalIndex as LocalIndexType, CreateIndexConfig } from 'vectra';
import type { IndexItem, MetadataTypes } from 'vectra/lib/types';

/**
 * 代码向量条目的 metadata 格式
 */
export interface CodeChunkMetadata extends Record<string, MetadataTypes> {
	/** 文件绝对路径 */
	filePath: string;
	/** 代码片段（最多 500 字符，用于展示） */
	code: string;
	/** 起始行号（1-based） */
	startLine: number;
	/** 结束行号（1-based） */
	endLine: number;
	/** chunk 类型: function / class / block */
	chunkType: string;
	/** 文件最后修改时间（ms since epoch） */
	mtime: number;
}

/**
 * 搜索结果条目
 */
export interface VectorSearchResult {
	/** 相似度分数（0-1，越高越相似） */
	score: number;
	/** 代码 chunk metadata */
	metadata: CodeChunkMetadata;
}

/**
 * vectra LocalIndex 类型（延迟加载）
 */
let _LocalIndexClass: typeof LocalIndexType | null = null;

/**
 * 获取 LocalIndex 类（延迟加载 vectra）
 */
async function getLocalIndexClass(): Promise<typeof LocalIndexType> {
	if (_LocalIndexClass) {
		return _LocalIndexClass;
	}
	const vectra = await import('vectra');
	_LocalIndexClass = vectra.LocalIndex as typeof LocalIndexType;
	return _LocalIndexClass;
}

/**
 * VectorStore: 向量索引的封装
 * 每个工作区 cwd 对应一个独立的 VectorStore 实例
 */
export class VectorStore {
	/** LocalIndex 实例 */
	private _index: LocalIndexType<CodeChunkMetadata> | null = null;
	/** 索引目录路径 */
	private readonly _indexDir: string;
	/** 是否已初始化 */
	private _initialized = false;
	/** 初始化 promise（防止并发初始化） */
	private _initPromise: Promise<void> | null = null;

	/**
	 * @param cwd 工作区根目录
	 */
	constructor(cwd: string) {
		// 使用 path.join 构建索引目录路径
		this._indexDir = `${cwd.replace(/\/$/, '')}/.maxian/index`;
	}

	/**
	 * 初始化索引（幂等）
	 */
	async initialize(): Promise<void> {
		if (this._initialized) {
			return;
		}
		if (this._initPromise) {
			return this._initPromise;
		}
		this._initPromise = this._doInitialize();
		await this._initPromise;
		this._initialized = true;
	}

	private async _doInitialize(): Promise<void> {
		const LocalIndexClass = await getLocalIndexClass();
		// 创建索引目录
		const fs = await import('fs');
		await fs.promises.mkdir(this._indexDir, { recursive: true });

		this._index = new LocalIndexClass<CodeChunkMetadata>(this._indexDir) as LocalIndexType<CodeChunkMetadata>;

		// 如果索引不存在，创建它
		const exists = await this._index.isIndexCreated();
		if (!exists) {
			const config: CreateIndexConfig = {
				version: 1,
				deleteIfExists: false,
				metadata_config: {
					indexed: ['filePath']
				}
			};
			await this._index.createIndex(config);
			console.log('[VectorStore] 索引已创建:', this._indexDir);
		} else {
			console.log('[VectorStore] 索引已存在:', this._indexDir);
		}
	}

	/**
	 * 向索引中添加或更新一条向量条目
	 * @param id 唯一标识符（如 filePath:startLine）
	 * @param vector 向量数组
	 * @param metadata 关联 metadata
	 */
	async upsertItem(id: string, vector: number[], metadata: CodeChunkMetadata): Promise<void> {
		await this.initialize();
		const index = this._index!;

		await index.upsertItem({
			id,
			vector,
			metadata,
		} as Partial<IndexItem<CodeChunkMetadata>>);
	}

	/**
	 * 批量添加向量条目（比逐一 upsert 更高效）
	 * @param items 条目数组
	 */
	async batchUpsert(items: Array<{ id: string; vector: number[]; metadata: CodeChunkMetadata }>): Promise<void> {
		await this.initialize();
		const index = this._index!;

		// vectra 的 batchInsertItems 要求没有进行中的 update
		// 我们先删除已存在的条目，再批量插入
		for (const item of items) {
			// 尝试删除已存在的（忽略错误）
			try {
				await index.deleteItem(item.id);
			} catch { /* item may not exist */ }
		}

		if (items.length === 0) {
			return;
		}

		await index.batchInsertItems(
			items.map(item => ({
				id: item.id,
				vector: item.vector,
				metadata: item.metadata,
			} as Partial<IndexItem<CodeChunkMetadata>>))
		);
	}

	/**
	 * 删除指定文件相关的所有向量条目
	 * @param filePath 文件绝对路径
	 */
	async deleteFileItems(filePath: string): Promise<void> {
		await this.initialize();
		const index = this._index!;

		// 列出所有 filePath 匹配的条目
		const items = await index.listItemsByMetadata({
			filePath: { '$eq': filePath }
		} as Record<string, unknown>);

		for (const item of items) {
			try {
				await index.deleteItem(item.id);
			} catch (error) {
				console.warn('[VectorStore] 删除条目失败:', item.id, error);
			}
		}
	}

	/**
	 * 向量相似度搜索
	 * @param vector 查询向量
	 * @param topK 返回前 K 个结果
	 * @param query 查询文本（用于 BM25 混合搜索）
	 * @returns 搜索结果（按相似度降序）
	 */
	async search(vector: number[], topK: number, query: string = ''): Promise<VectorSearchResult[]> {
		await this.initialize();
		const index = this._index!;

		try {
			const queryResults = await index.queryItems<CodeChunkMetadata>(vector, query, topK);

			return queryResults.map(r => ({
				score: r.score,
				metadata: r.item.metadata as CodeChunkMetadata,
			}));
		} catch (error) {
			console.warn('[VectorStore] 搜索失败:', error);
			return [];
		}
	}

	/**
	 * 获取索引中的条目总数
	 */
	async getItemCount(): Promise<number> {
		await this.initialize();
		const index = this._index!;
		try {
			const stats = await index.getIndexStats();
			return stats.items;
		} catch {
			return 0;
		}
	}

	/**
	 * 清空索引（删除所有条目，重新创建）
	 */
	async clear(): Promise<void> {
		if (!this._initialized || !this._index) {
			return;
		}
		const index = this._index;

		try {
			await index.deleteIndex();
		} catch { /* ignore */ }

		const config: CreateIndexConfig = {
			version: 1,
			deleteIfExists: true,
			metadata_config: {
				indexed: ['filePath']
			}
		};
		await index.createIndex(config);
		console.log('[VectorStore] 索引已清空并重建');
	}

	/**
	 * 检查指定文件的索引条目是否存在且是最新的
	 * @param filePath 文件路径
	 * @param currentMtime 文件当前的 mtime
	 * @returns true 表示索引是最新的，false 表示需要重新索引
	 */
	async isFileIndexed(filePath: string, currentMtime: number): Promise<boolean> {
		await this.initialize();
		const index = this._index!;

		try {
			const items = await index.listItemsByMetadata({
				filePath: { '$eq': filePath }
			} as Record<string, unknown>);

			if (items.length === 0) {
				return false;
			}

			// 检查 mtime 是否匹配（任意一条匹配即可）
			for (const item of items) {
				const meta = item.metadata as CodeChunkMetadata;
				if (meta.mtime === currentMtime) {
					return true;
				}
			}

			return false;
		} catch {
			return false;
		}
	}

	/**
	 * 获取索引目录路径
	 */
	getIndexDir(): string {
		return this._indexDir;
	}
}

/**
 * VectorStore 工厂：每个 cwd 维护一个独立实例
 */
const _storeCache = new Map<string, VectorStore>();

/**
 * 获取或创建工作区的 VectorStore 实例
 * @param cwd 工作区根目录
 */
export function getVectorStore(cwd: string): VectorStore {
	const normalizedCwd = cwd.replace(/\/$/, '');
	let store = _storeCache.get(normalizedCwd);
	if (!store) {
		store = new VectorStore(normalizedCwd);
		_storeCache.set(normalizedCwd, store);
	}
	return store;
}

/**
 * 清除指定工作区的 VectorStore 缓存
 * @param cwd 工作区根目录
 */
export function clearVectorStoreCache(cwd: string): void {
	const normalizedCwd = cwd.replace(/\/$/, '');
	_storeCache.delete(normalizedCwd);
}
