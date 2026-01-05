/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 缓存条目接口
 */
export interface CacheEntry<T> {
	/** 缓存数据 */
	data: T;
	/** 创建时间戳 */
	timestamp: number;
	/** 访问次数（用于LFU） */
	accessCount: number;
	/** 最后访问时间（用于LRU） */
	lastAccess: number;
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
	/** L1命中次数 */
	l1Hits: number;
	/** L2命中次数 */
	l2Hits: number;
	/** L3命中次数 */
	l3Hits: number;
	/** 未命中次数 */
	misses: number;
	/** 总命中率 */
	hitRate: number;
}

/**
 * 补全结果缓存数据
 */
export interface CompletionCacheData {
	/** 补全结果列表 */
	completions: string[];
	/** 验证分数 */
	validationScore?: number;
	/** 框架上下文 */
	frameworkContext?: string;
}

/**
 * 三层缓存服务
 * L1: 内存缓存 - 100条，10分钟TTL，最快访问
 * L2: LocalStorage - 500条，24小时TTL，持久化
 * L3: IndexedDB - 10000条，7天TTL，大容量持久化
 */
export class CompletionCacheService {

	// L1 内存缓存
	private l1Cache: Map<string, CacheEntry<CompletionCacheData>> = new Map();
	private readonly l1MaxSize = 100;
	private readonly l1TTL = 10 * 60 * 1000; // 10分钟

	// L2 LocalStorage 配置
	private readonly l2Prefix = 'maxian_completion_cache_';
	private readonly l2MaxSize = 500;
	private readonly l2TTL = 24 * 60 * 60 * 1000; // 24小时

	// L3 IndexedDB 配置
	private readonly l3DBName = 'MaxianCompletionCache';
	private readonly l3StoreName = 'completions';
	private readonly l3MaxSize = 10000;
	private readonly l3TTL = 7 * 24 * 60 * 60 * 1000; // 7天
	private l3DB: IDBDatabase | null = null;
	private l3InitPromise: Promise<void> | null = null;

	// 统计信息
	private stats: CacheStats = {
		l1Hits: 0,
		l2Hits: 0,
		l3Hits: 0,
		misses: 0,
		hitRate: 0
	};

	constructor() {
		// 初始化 L3 IndexedDB
		this.initL3Cache();
		// 定期清理过期缓存
		this.startCleanupTimer();
	}

	/**
	 * 获取缓存
	 */
	async get(key: string): Promise<CompletionCacheData | undefined> {
		const now = Date.now();

		// 1. 尝试 L1 缓存
		const l1Entry = this.l1Cache.get(key);
		if (l1Entry && (now - l1Entry.timestamp) < this.l1TTL) {
			l1Entry.accessCount++;
			l1Entry.lastAccess = now;
			this.stats.l1Hits++;
			this.updateHitRate();
			return l1Entry.data;
		}

		// 2. 尝试 L2 缓存 (LocalStorage)
		try {
			const l2Data = this.getFromL2(key);
			if (l2Data) {
				// 提升到 L1
				this.setL1(key, l2Data);
				this.stats.l2Hits++;
				this.updateHitRate();
				return l2Data;
			}
		} catch (e) {
			// LocalStorage 可能不可用
		}

		// 3. 尝试 L3 缓存 (IndexedDB)
		try {
			const l3Data = await this.getFromL3(key);
			if (l3Data) {
				// 提升到 L1 和 L2
				this.setL1(key, l3Data);
				this.setL2(key, l3Data);
				this.stats.l3Hits++;
				this.updateHitRate();
				return l3Data;
			}
		} catch (e) {
			// IndexedDB 可能不可用
		}

		// 未命中
		this.stats.misses++;
		this.updateHitRate();
		return undefined;
	}

	/**
	 * 设置缓存（写入所有层级）
	 */
	async set(key: string, data: CompletionCacheData): Promise<void> {
		// 写入 L1
		this.setL1(key, data);

		// 写入 L2
		try {
			this.setL2(key, data);
		} catch (e) {
			// LocalStorage 可能已满或不可用
		}

		// 写入 L3
		try {
			await this.setL3(key, data);
		} catch (e) {
			// IndexedDB 可能不可用
		}
	}

	/**
	 * 删除缓存
	 */
	async delete(key: string): Promise<void> {
		// 从 L1 删除
		this.l1Cache.delete(key);

		// 从 L2 删除
		try {
			if (typeof localStorage !== 'undefined') {
				localStorage.removeItem(this.l2Prefix + key);
			}
		} catch (e) { }

		// 从 L3 删除
		try {
			await this.deleteFromL3(key);
		} catch (e) { }
	}

	/**
	 * 清除所有缓存
	 */
	async clear(): Promise<void> {
		// 清除 L1
		this.l1Cache.clear();

		// 清除 L2
		try {
			if (typeof localStorage !== 'undefined') {
				const keysToRemove: string[] = [];
				for (let i = 0; i < localStorage.length; i++) {
					const key = localStorage.key(i);
					if (key && key.startsWith(this.l2Prefix)) {
						keysToRemove.push(key);
					}
				}
				keysToRemove.forEach(k => localStorage.removeItem(k));
			}
		} catch (e) { }

		// 清除 L3
		try {
			await this.clearL3();
		} catch (e) { }

		// 重置统计
		this.stats = { l1Hits: 0, l2Hits: 0, l3Hits: 0, misses: 0, hitRate: 0 };
	}

	/**
	 * 获取缓存统计
	 */
	getStats(): CacheStats {
		return { ...this.stats };
	}

	/**
	 * 预热缓存 - 加载常用补全
	 */
	async warmup(keys: string[]): Promise<void> {
		for (const key of keys.slice(0, 50)) { // 最多预热50个
			await this.get(key); // 触发从 L3 提升到 L1/L2
		}
	}

	/**
	 * 根据前缀批量失效缓存
	 */
	async invalidateByPrefix(prefix: string): Promise<void> {
		// L1
		for (const key of this.l1Cache.keys()) {
			if (key.startsWith(prefix)) {
				this.l1Cache.delete(key);
			}
		}

		// L2
		try {
			if (typeof localStorage !== 'undefined') {
				const keysToRemove: string[] = [];
				for (let i = 0; i < localStorage.length; i++) {
					const key = localStorage.key(i);
					if (key && key.startsWith(this.l2Prefix + prefix)) {
						keysToRemove.push(key);
					}
				}
				keysToRemove.forEach(k => localStorage.removeItem(k));
			}
		} catch (e) { }

		// L3 - 需要遍历，性能较低，仅在必要时调用
	}

	// ========== L1 内存缓存操作 ==========

	private setL1(key: string, data: CompletionCacheData): void {
		// LRU + LFU 混合淘汰
		if (this.l1Cache.size >= this.l1MaxSize) {
			this.evictL1();
		}

		this.l1Cache.set(key, {
			data,
			timestamp: Date.now(),
			accessCount: 1,
			lastAccess: Date.now()
		});
	}

	private evictL1(): void {
		// 混合策略：优先淘汰访问次数少且最久未访问的
		let worstKey: string | null = null;
		let worstScore = Infinity;

		for (const [key, entry] of this.l1Cache.entries()) {
			// 分数 = 访问次数 * 0.3 + (1 / 距上次访问时间) * 0.7
			const recency = Date.now() - entry.lastAccess;
			const score = entry.accessCount * 0.3 + (1 / Math.max(recency, 1)) * 0.7 * 10000;

			if (score < worstScore) {
				worstScore = score;
				worstKey = key;
			}
		}

		if (worstKey) {
			this.l1Cache.delete(worstKey);
		}
	}

	// ========== L2 LocalStorage 操作 ==========

	private getFromL2(key: string): CompletionCacheData | undefined {
		if (typeof localStorage === 'undefined') {
			return undefined;
		}

		try {
			const raw = localStorage.getItem(this.l2Prefix + key);
			if (!raw) {
				return undefined;
			}

			const entry: CacheEntry<CompletionCacheData> = JSON.parse(raw);
			if ((Date.now() - entry.timestamp) > this.l2TTL) {
				localStorage.removeItem(this.l2Prefix + key);
				return undefined;
			}

			return entry.data;
		} catch (e) {
			return undefined;
		}
	}

	private setL2(key: string, data: CompletionCacheData): void {
		if (typeof localStorage === 'undefined') {
			return;
		}

		// 检查容量
		this.ensureL2Capacity();

		const entry: CacheEntry<CompletionCacheData> = {
			data,
			timestamp: Date.now(),
			accessCount: 1,
			lastAccess: Date.now()
		};

		try {
			localStorage.setItem(this.l2Prefix + key, JSON.stringify(entry));
		} catch (e) {
			// 存储已满，尝试清理
			this.cleanupL2();
			try {
				localStorage.setItem(this.l2Prefix + key, JSON.stringify(entry));
			} catch (e2) {
				// 仍然失败，忽略
			}
		}
	}

	private ensureL2Capacity(): void {
		if (typeof localStorage === 'undefined') {
			return;
		}

		let count = 0;
		const entries: { key: string; timestamp: number }[] = [];

		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key && key.startsWith(this.l2Prefix)) {
				count++;
				try {
					const raw = localStorage.getItem(key);
					if (raw) {
						const entry = JSON.parse(raw);
						entries.push({ key, timestamp: entry.timestamp || 0 });
					}
				} catch (e) { }
			}
		}

		// 如果超过容量，删除最旧的
		if (count >= this.l2MaxSize) {
			entries.sort((a, b) => a.timestamp - b.timestamp);
			const toRemove = entries.slice(0, Math.floor(this.l2MaxSize * 0.2)); // 删除20%
			toRemove.forEach(e => localStorage.removeItem(e.key));
		}
	}

	private cleanupL2(): void {
		if (typeof localStorage === 'undefined') {
			return;
		}

		const now = Date.now();
		const keysToRemove: string[] = [];

		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key && key.startsWith(this.l2Prefix)) {
				try {
					const raw = localStorage.getItem(key);
					if (raw) {
						const entry = JSON.parse(raw);
						if ((now - entry.timestamp) > this.l2TTL) {
							keysToRemove.push(key);
						}
					}
				} catch (e) {
					keysToRemove.push(key!);
				}
			}
		}

		keysToRemove.forEach(k => localStorage.removeItem(k));
	}

	// ========== L3 IndexedDB 操作 ==========

	private async initL3Cache(): Promise<void> {
		if (this.l3InitPromise) {
			return this.l3InitPromise;
		}

		this.l3InitPromise = new Promise((resolve, reject) => {
			if (typeof indexedDB === 'undefined') {
				resolve();
				return;
			}

			const request = indexedDB.open(this.l3DBName, 1);

			request.onerror = () => {
				console.warn('[CompletionCache] Failed to open IndexedDB');
				resolve();
			};

			request.onsuccess = () => {
				this.l3DB = request.result;
				resolve();
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;
				if (!db.objectStoreNames.contains(this.l3StoreName)) {
					const store = db.createObjectStore(this.l3StoreName, { keyPath: 'key' });
					store.createIndex('timestamp', 'timestamp', { unique: false });
				}
			};
		});

		return this.l3InitPromise;
	}

	private async getFromL3(key: string): Promise<CompletionCacheData | undefined> {
		await this.initL3Cache();

		if (!this.l3DB) {
			return undefined;
		}

		return new Promise((resolve) => {
			try {
				const transaction = this.l3DB!.transaction([this.l3StoreName], 'readonly');
				const store = transaction.objectStore(this.l3StoreName);
				const request = store.get(key);

				request.onsuccess = () => {
					const result = request.result;
					if (!result) {
						resolve(undefined);
						return;
					}

					// 检查过期
					if ((Date.now() - result.timestamp) > this.l3TTL) {
						this.deleteFromL3(key);
						resolve(undefined);
						return;
					}

					resolve(result.data);
				};

				request.onerror = () => resolve(undefined);
			} catch (e) {
				resolve(undefined);
			}
		});
	}

	private async setL3(key: string, data: CompletionCacheData): Promise<void> {
		await this.initL3Cache();

		if (!this.l3DB) {
			return;
		}

		// 检查容量并清理
		await this.ensureL3Capacity();

		return new Promise((resolve) => {
			try {
				const transaction = this.l3DB!.transaction([this.l3StoreName], 'readwrite');
				const store = transaction.objectStore(this.l3StoreName);

				store.put({
					key,
					data,
					timestamp: Date.now(),
					accessCount: 1,
					lastAccess: Date.now()
				});

				transaction.oncomplete = () => resolve();
				transaction.onerror = () => resolve();
			} catch (e) {
				resolve();
			}
		});
	}

	private async deleteFromL3(key: string): Promise<void> {
		await this.initL3Cache();

		if (!this.l3DB) {
			return;
		}

		return new Promise((resolve) => {
			try {
				const transaction = this.l3DB!.transaction([this.l3StoreName], 'readwrite');
				const store = transaction.objectStore(this.l3StoreName);
				store.delete(key);

				transaction.oncomplete = () => resolve();
				transaction.onerror = () => resolve();
			} catch (e) {
				resolve();
			}
		});
	}

	private async clearL3(): Promise<void> {
		await this.initL3Cache();

		if (!this.l3DB) {
			return;
		}

		return new Promise((resolve) => {
			try {
				const transaction = this.l3DB!.transaction([this.l3StoreName], 'readwrite');
				const store = transaction.objectStore(this.l3StoreName);
				store.clear();

				transaction.oncomplete = () => resolve();
				transaction.onerror = () => resolve();
			} catch (e) {
				resolve();
			}
		});
	}

	private async ensureL3Capacity(): Promise<void> {
		if (!this.l3DB) {
			return;
		}

		return new Promise((resolve) => {
			try {
				const transaction = this.l3DB!.transaction([this.l3StoreName], 'readonly');
				const store = transaction.objectStore(this.l3StoreName);
				const countRequest = store.count();

				countRequest.onsuccess = () => {
					const count = countRequest.result;
					if (count >= this.l3MaxSize) {
						// 超过容量，删除最旧的 20%
						this.evictOldestFromL3(Math.floor(this.l3MaxSize * 0.2)).then(() => resolve());
					} else {
						resolve();
					}
				};

				countRequest.onerror = () => resolve();
			} catch (e) {
				resolve();
			}
		});
	}

	private async evictOldestFromL3(count: number): Promise<void> {
		if (!this.l3DB) {
			return;
		}

		return new Promise((resolve) => {
			try {
				const transaction = this.l3DB!.transaction([this.l3StoreName], 'readwrite');
				const store = transaction.objectStore(this.l3StoreName);
				const index = store.index('timestamp');
				const keysToDelete: string[] = [];

				const cursorRequest = index.openCursor();
				let deleted = 0;

				cursorRequest.onsuccess = (event) => {
					const cursor = (event.target as IDBRequest).result;
					if (cursor && deleted < count) {
						keysToDelete.push(cursor.value.key);
						deleted++;
						cursor.continue();
					} else {
						// 删除收集到的键
						keysToDelete.forEach(key => store.delete(key));
					}
				};

				transaction.oncomplete = () => resolve();
				transaction.onerror = () => resolve();
			} catch (e) {
				resolve();
			}
		});
	}

	// ========== 定期清理 ==========

	private startCleanupTimer(): void {
		// 每5分钟清理一次过期缓存
		setInterval(() => {
			this.cleanupExpired();
		}, 5 * 60 * 1000);
	}

	private cleanupExpired(): void {
		const now = Date.now();

		// 清理 L1
		for (const [key, entry] of this.l1Cache.entries()) {
			if ((now - entry.timestamp) > this.l1TTL) {
				this.l1Cache.delete(key);
			}
		}

		// 清理 L2
		this.cleanupL2();

		// L3 清理在访问时进行，避免频繁遍历
	}

	private updateHitRate(): void {
		const total = this.stats.l1Hits + this.stats.l2Hits + this.stats.l3Hits + this.stats.misses;
		if (total > 0) {
			this.stats.hitRate = (this.stats.l1Hits + this.stats.l2Hits + this.stats.l3Hits) / total;
		}
	}
}

// 单例导出
export const completionCacheService = new CompletionCacheService();
