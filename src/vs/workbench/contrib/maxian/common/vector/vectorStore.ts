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
					indexed: ['filePath', 'mtime']  // mtime 内联存储，用于增量索引的 mtime 比对
				}
			};
			await this._index.createIndex(config);
			console.log('[VectorStore] 索引已创建:', this._indexDir);
		} else {
			// 索引文件存在，验证完整性（防止因异常终止导致 index.json 损坏）
			const isValid = await this._validateIndex();
			if (!isValid) {
				console.warn('[VectorStore] index.json 损坏，自动重建索引:', this._indexDir);
				await this._rebuildIndex(fs);
			} else {
				console.log('[VectorStore] 索引已存在且完整:', this._indexDir);
			}
		}
	}

	/**
	 * 验证索引完整性（尝试读取 stats，失败则说明 index.json 损坏）
	 */
	private async _validateIndex(): Promise<boolean> {
		try {
			await this._index!.getIndexStats();
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * 重建损坏的索引（删除旧 index.json，重新创建空索引）
	 */
	private async _rebuildIndex(fs: typeof import('fs')): Promise<void> {
		// 删除损坏的 index.json（保留 UUID 元数据文件，但它们的向量数据已丢失，只能重建）
		const indexJsonPath = `${this._indexDir}/index.json`;
		try {
			await fs.promises.unlink(indexJsonPath);
		} catch { /* 文件可能不存在，忽略 */ }

		// 清理残留的 UUID JSON 文件（没有对应向量，留着会造成孤儿数据）
		try {
			const files = await fs.promises.readdir(this._indexDir);
			for (const file of files) {
				if (file !== 'index.json' && file.endsWith('.json')) {
					await fs.promises.unlink(`${this._indexDir}/${file}`).catch(() => { /* ignore */ });
				}
			}
		} catch { /* ignore */ }

		// 重新创建空索引
		const config: CreateIndexConfig = {
			version: 1,
			deleteIfExists: false,
			metadata_config: {
				indexed: ['filePath', 'mtime']
			}
		};
		await this._index!.createIndex(config);
		console.log('[VectorStore] 索引已重建（原索引已损坏）:', this._indexDir);
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

		if (items.length === 0) {
			return;
		}

		// 在一个 beginUpdate/endUpdate 事务中完成删除 + 插入，只写一次磁盘
		await index.beginUpdate();
		try {
			// 在内存中删除已存在的同 id 条目（不触发 endUpdate，无磁盘写入）
			for (const item of items) {
				await index.deleteItem(item.id);
			}
			// 在内存中插入所有新条目（upsertItem 检测到 _update 存在则只写内存）
			for (const item of items) {
				await index.upsertItem({
					id: item.id,
					vector: item.vector,
					metadata: item.metadata,
				} as Partial<IndexItem<CodeChunkMetadata>>);
			}
			// 一次性写磁盘
			await index.endUpdate();
		} catch (err) {
			try { await index.cancelUpdate(); } catch { /* ignore */ }
			throw err;
		}
	}

	// ── 批量模式（Bulk Mode）─────────────────────────────────────────────────────
	// 用于全量/增量工作区索引：beginBulkUpdate 开启事务，所有后续操作在内存进行，
	// 每 N 文件调用一次 commitBulkUpdate 写盘（checkpoint），避免每文件一次写盘。

	/** 是否处于批量模式 */
	private _inBulkMode = false;

	/**
	 * 开始批量更新事务（仅加载一次 index.json 到内存）
	 */
	async beginBulkUpdate(): Promise<void> {
		await this.initialize();
		if (this._inBulkMode) {
			return; // 已经在事务中
		}
		await this._index!.beginUpdate();
		this._inBulkMode = true;
	}

	/**
	 * 提交批量更新（写磁盘），然后立即重新开启事务继续后续操作
	 * @param reopen 是否写完后立即重新开启事务（默认 true）
	 */
	async commitBulkUpdate(reopen = true): Promise<void> {
		if (!this._inBulkMode) {
			return;
		}
		await this._index!.endUpdate();
		this._inBulkMode = false;
		if (reopen) {
			await this._index!.beginUpdate();
			this._inBulkMode = true;
		}
	}

	/**
	 * 回滚批量更新（丢弃内存中的变更）
	 */
	async rollbackBulkUpdate(): Promise<void> {
		if (!this._inBulkMode) {
			return;
		}
		try { await this._index!.cancelUpdate(); } catch { /* ignore */ }
		this._inBulkMode = false;
	}

	/**
	 * 在批量模式中删除某文件的所有条目（纯内存操作，不写磁盘）
	 * 必须在 beginBulkUpdate 之后调用
	 */
	async bulkDeleteFileItems(filePath: string): Promise<void> {
		if (!this._inBulkMode || !this._index) {
			return;
		}
		// deleteItem 检测到 _update 存在时仅在内存中操作，不写磁盘
		const index = this._index;
		// 从 _update.items 中找出所有属于该文件的条目并删除
		// vectra 的 deleteItem 在 bulk 模式下直接改 _update.items，时间复杂度 O(N)
		// 对于大索引，逐条删除效率低；改为直接过滤更高效
		// 但 vectra 没有暴露 _update，只能用 deleteItem
		// 先 listItemsByMetadata 找到所有该文件的 id，再逐一 deleteItem
		const items = await index.listItemsByMetadata({
			filePath: { '$eq': filePath }
		} as Record<string, unknown>);
		for (const item of items) {
			await index.deleteItem(item.id);
		}
	}

	/**
	 * 在批量模式中添加多个条目（纯内存操作，不写磁盘）
	 * 必须在 beginBulkUpdate 之后调用
	 */
	async bulkAddItems(items: Array<{ id: string; vector: number[]; metadata: CodeChunkMetadata }>): Promise<void> {
		if (!this._inBulkMode || !this._index || items.length === 0) {
			return;
		}
		const index = this._index;
		// upsertItem 在 _update 存在时只写内存
		for (const item of items) {
			await index.upsertItem({
				id: item.id,
				vector: item.vector,
				metadata: item.metadata,
			} as Partial<IndexItem<CodeChunkMetadata>>);
		}
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
	 * 一次性获取索引中所有文件的 filePath→mtime 映射
	 * 用于替代逐文件 isFileIndexed 调用，将 O(N×M) 降为 O(N+M)
	 */
	async getFileIndexMap(): Promise<Map<string, number>> {
		await this.initialize();
		const index = this._index!;
		const map = new Map<string, number>();
		try {
			// listItemsByMetadata({}) 返回全部条目（indexed 字段在内存中，无磁盘读取）
			const items = await index.listItemsByMetadata({} as Record<string, unknown>);
			for (const item of items) {
				const meta = item.metadata as CodeChunkMetadata;
				if (meta.filePath && !map.has(meta.filePath)) {
					// 只记录每个文件第一次出现的 mtime（同文件多个 chunk mtime 相同）
					map.set(meta.filePath, meta.mtime ?? -1);
				}
			}
		} catch {
			// 索引异常时返回空 map，触发全量重索引
		}
		return map;
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
				indexed: ['filePath', 'mtime']
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
				// 兼容旧索引：mtime 未存为 indexed 字段时为 undefined，
				// 视为"已是最新"（避免旧索引在每次启动时触发全量重索引）
				if (meta.mtime === undefined || meta.mtime === null) {
					return true;
				}
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
