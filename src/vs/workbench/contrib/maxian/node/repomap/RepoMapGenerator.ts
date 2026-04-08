/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * RepoMapGenerator - 代码库地图生成器
 * 整合 TagExtractor、ReferenceGraphBuilder 和 PageRankSorter
 * 实现二分搜索优化和格式化输出
 * 参考 Aider 的完整实现（848行）
 */

import * as path from 'path';
import * as fs from 'fs';
import { TagExtractor } from './TagExtractor.js';
import { ReferenceGraphBuilder } from './ReferenceGraphBuilder.js';
import { PageRankSorter } from './PageRankSorter.js';
import { Tag, RepoMapOptions, RepoMapContext } from './types.js';
import { estimateTokensFromChars } from '../../common/utils/tokenEstimate.js';

/**
 * P0优化: RepoMap缓存条目
 * 包含生成的map和文件mtime快照
 */
interface RepoMapCacheEntry {
	map: string;
	mtimeSnapshot: Map<string, number>;  // 文件路径 -> mtime
	timestamp: number;                    // 缓存创建时间
}

/**
 * RepoMapGenerator - 主类
 * P0优化：增强缓存机制（基于mtime失效 + Token采样估算）
 */
export class RepoMapGenerator {
	private tagExtractor: TagExtractor;
	private graphBuilder: ReferenceGraphBuilder;
	private pageRankSorter: PageRankSorter;

	// 配置
	private maxTokens: number;
	private mapMulNoFiles: number;
	private verbose: boolean;
	private readonly _workspaceRoot: string;

	// P0优化：增强缓存（基于mtime失效）
	private mapCache: Map<string, RepoMapCacheEntry> = new Map();
	private lastGeneratedMap: string | null = null;
	private readonly CACHE_TTL = 5 * 60 * 1000; // 缓存有效期5分钟
	private cacheHits = 0;
	private cacheMisses = 0;

	constructor(options: RepoMapOptions) {
		this.tagExtractor = new TagExtractor(options.workspaceRoot, options.verbose);
		this.graphBuilder = new ReferenceGraphBuilder();
		this.pageRankSorter = new PageRankSorter();

		this.maxTokens = options.maxTokens || 2048;
		this.mapMulNoFiles = options.mapMulNoFiles || 8;
		this.verbose = options.verbose || false;
		this._workspaceRoot = options.workspaceRoot;
	}

	/**
	 * 初始化（必须在使用前调用）
	 */
	async initialize(): Promise<void> {
		await this.tagExtractor.initialize();
		if (this.verbose) {
			console.log('[RepoMapGenerator] 初始化完成');
		}
	}

	/**
	 * 生成排序后的RepoMap
	 * 参考 Aider 的 get_ranked_tags_map 方法（第557-608行）
	 * P0优化：增强缓存机制（基于mtime失效）
	 */
	async generateRanked(context: RepoMapContext): Promise<string> {
		// 1. 生成缓存key
		const cacheKey = this.getCacheKey(context);
		const allFiles = [...context.chatFiles, ...context.otherFiles];

		// P0优化：检查缓存（带mtime验证）
		const cached = this.mapCache.get(cacheKey);
		if (cached) {
			const isCacheValid = this.isCacheValid(cached, allFiles);
			if (isCacheValid) {
				this.cacheHits++;
				if (this.verbose) {
					console.log(`[RepoMapGenerator] 使用缓存结果 (命中率: ${this.getCacheHitRate()}%)`);
				}
				return cached.map;
			} else {
				// 缓存失效，删除
				this.mapCache.delete(cacheKey);
				if (this.verbose) {
					console.log('[RepoMapGenerator] 缓存失效（文件已修改）');
				}
			}
		}

		this.cacheMisses++;
		const startTime = Date.now();

		// 2. 调整token预算（无chat files时扩大）
		let tokenBudget = context.tokenBudget;
		if (context.chatFiles.length === 0 && context.otherFiles.length > 0) {
			// 参考Aider第120-131行：无chat files时使用更大的预算
			tokenBudget = Math.min(
				tokenBudget * this.mapMulNoFiles,
				this.maxTokens
			);
			if (this.verbose) {
				console.log(`[RepoMapGenerator] 无chat files，扩大token预算到 ${tokenBudget}`);
			}
		}

		// 3. 生成RepoMap
		const result = await this.generateUncached(context, tokenBudget);

		const endTime = Date.now();
		if (this.verbose) {
			console.log(`[RepoMapGenerator] 生成耗时 ${endTime - startTime}ms (缓存命中率: ${this.getCacheHitRate()}%)`);
		}

		// 4. P0优化：缓存结果（带mtime快照）
		const mtimeSnapshot = this.createMtimeSnapshot(allFiles);
		this.mapCache.set(cacheKey, {
			map: result,
			mtimeSnapshot,
			timestamp: Date.now()
		});
		this.lastGeneratedMap = result;

		return result;
	}

	/**
	 * P0优化：验证缓存是否有效
	 * 检查：1. TTL未过期 2. 文件mtime未变化
	 */
	private isCacheValid(entry: RepoMapCacheEntry, files: string[]): boolean {
		// 检查TTL
		if (Date.now() - entry.timestamp > this.CACHE_TTL) {
			return false;
		}

		// 检查文件mtime（采样检查，避免全量检查）
		// 策略：检查最多20个文件，随机采样
		const filesToCheck = files.length <= 20
			? files
			: this.sampleFiles(files, 20);

		for (const file of filesToCheck) {
			try {
				const currentMtime = fs.statSync(file).mtimeMs;
				const cachedMtime = entry.mtimeSnapshot.get(file);

				if (cachedMtime === undefined || currentMtime !== cachedMtime) {
					return false;
				}
			} catch {
				// 文件不存在或无法访问，缓存失效
				return false;
			}
		}

		return true;
	}

	/**
	 * P0优化：创建文件mtime快照
	 */
	private createMtimeSnapshot(files: string[]): Map<string, number> {
		const snapshot = new Map<string, number>();

		for (const file of files) {
			try {
				const mtime = fs.statSync(file).mtimeMs;
				snapshot.set(file, mtime);
			} catch {
				// 忽略无法访问的文件
			}
		}

		return snapshot;
	}

	/**
	 * P0优化：随机采样文件列表
	 */
	private sampleFiles(files: string[], count: number): string[] {
		if (files.length <= count) {
			return files;
		}

		const sampled: string[] = [];
		const step = Math.floor(files.length / count);

		for (let i = 0; i < files.length && sampled.length < count; i += step) {
			sampled.push(files[i]);
		}

		return sampled;
	}

	/**
	 * P0优化：获取缓存命中率
	 */
	private getCacheHitRate(): string {
		const total = this.cacheHits + this.cacheMisses;
		if (total === 0) return '0';
		return ((this.cacheHits / total) * 100).toFixed(1);
	}

	/**
	 * 生成RepoMap（无缓存）
	 * 参考 Aider 的 get_ranked_tags_map_uncached 方法（第610-687行）
	 */
	private async generateUncached(context: RepoMapContext, tokenBudget: number): Promise<string> {
		const allFiles = [...context.chatFiles, ...context.otherFiles];

		console.log(`[RepoMapGenerator] 开始生成，文件数: ${allFiles.length}`);

		if (allFiles.length === 0) {
			console.warn('[RepoMapGenerator] 没有文件，返回空');
			return '';
		}

		// 1. 提取所有tags
		console.log(`[RepoMapGenerator] 提取tags，共 ${allFiles.length} 个文件`);

		const allTags = await this.tagExtractor.extractTagsFromFiles(allFiles);

		console.log(`[RepoMapGenerator] 提取到 ${allTags.length} 个tags`);

		if (allTags.length === 0) {
			if (this.verbose) {
				console.log('[RepoMapGenerator] 未找到任何tags');
			}
			return '';
		}

		// 2. 构建引用图
		const chatFilesSet = new Set(context.chatFiles.map(f => path.relative(this._workspaceRoot, f)));
		const graph = this.graphBuilder.buildGraph(
			allTags,
			chatFilesSet,
			context.mentionedIdents || new Set()
		);

		// 3. PageRank排序
		const rankedDefs = this.pageRankSorter.rankFiles(
			graph,
			allTags,
			chatFilesSet,
			context.mentionedFiles || new Set()
		);

		// 4. 排序tags
		const sortedTags = this.pageRankSorter.sortTagsByRank(allTags, rankedDefs, chatFilesSet);

		if (this.verbose) {
			console.log(`[RepoMapGenerator] 排序后共 ${sortedTags.length} 个tags`);
		}

		// 5. 二分搜索最佳数量（参考Aider第658-686行）
		const bestMap = await this.binarySearchBestMap(sortedTags, tokenBudget, chatFilesSet);

		return bestMap;
	}

	/**
	 * 二分搜索最佳RepoMap
	 * 参考 Aider 第658-686行
	 *
	 * 目标：在不超过token预算的前提下，包含尽可能多的tags
	 */
	private async binarySearchBestMap(
		sortedTags: Tag[],
		maxTokens: number,
		chatFiles: Set<string>
	): Promise<string> {
		const numTags = sortedTags.length;

		if (numTags === 0) {
			return '';
		}

		let lower = 0;
		let upper = numTags;
		let bestMap = '';
		let bestTokens = 0;

		// 初始中点：估算每个tag约25个tokens
		let middle = Math.min(Math.floor(maxTokens / 25), numTags);

		while (lower <= upper) {
			// 生成当前数量的map
			const currentMap = this.formatRepoMap(sortedTags.slice(0, middle), chatFiles);
			const currentTokens = this.estimateTokens(currentMap);

			if (this.verbose) {
				console.log(`[RepoMapGenerator] 二分搜索: middle=${middle}, tokens=${currentTokens}/${maxTokens}`);
			}

			// 计算误差百分比
			const errorPct = Math.abs(currentTokens - maxTokens) / maxTokens;

			// 更新最佳结果
			if ((currentTokens <= maxTokens && currentTokens > bestTokens) || errorPct < 0.15) {
				bestMap = currentMap;
				bestTokens = currentTokens;

				// 误差足够小，提前结束
				if (errorPct < 0.15) {
					if (this.verbose) {
						console.log(`[RepoMapGenerator] 找到最佳匹配: ${currentTokens} tokens (误差 ${(errorPct * 100).toFixed(1)}%)`);
					}
					break;
				}
			}

			// 调整搜索范围
			if (currentTokens < maxTokens) {
				lower = middle + 1;
			} else {
				upper = middle - 1;
			}

			middle = Math.floor((lower + upper) / 2);

			// 防止无限循环
			if (middle === lower || middle === upper) {
				break;
			}
		}

		if (this.verbose) {
			console.log(`[RepoMapGenerator] 最终选择: ${bestTokens} tokens`);
		}

		return bestMap;
	}

	/**
	 * 格式化RepoMap
	 * 参考 Aider 的 to_tree 方法（第729-749行）
	 */
	private formatRepoMap(tags: Tag[], chatFiles: Set<string>): string {
		const lines: string[] = [];

		// 添加醒目的使用说明
		lines.push('# 代码库地图（RepoMap）- ⚠️ 必读！');
		lines.push('');
		lines.push('⚠️ **重要**: 这是通过 PageRank 算法智能排序的代码库结构！');
		lines.push('');
		lines.push('**使用策略（必须遵守）**：');
		lines.push('1. 📍 下面列出的文件和类已经是最相关的（PageRank排序）');
		lines.push('2. 🚫 禁止使用 list_files 逐层探索目录');
		lines.push('3. ✅ 直接从下面的列表选择文件，使用 batch + read_file 批量读取');
		lines.push('4. ✅ 下面的类名和方法名可以直接用于理解代码结构');
		lines.push('');
		lines.push('**示例正确用法**：');
		lines.push('看到 LoginHelper.java 有 getUserId 方法');
		lines.push('→ 直接 read_file("boyo-common/src/main/java/com/boyo/common/helper/LoginHelper.java")');
		lines.push('');
		lines.push('**错误用法（禁止）**：');
		lines.push('❌ list_files(".") → list_files("src") → list_files("src/main") → ...');
		lines.push('');
		lines.push('---');
		lines.push('');

		// 按文件分组
		const byFile = new Map<string, Tag[]>();
		for (const tag of tags) {
			// 跳过chat files（它们已经在上下文中）
			if (chatFiles.has(tag.relFname)) {
				continue;
			}

			if (!byFile.has(tag.relFname)) {
				byFile.set(tag.relFname, []);
			}
			byFile.get(tag.relFname)!.push(tag);
		}

		// 按文件路径排序
		const sortedFiles = Array.from(byFile.keys()).sort();

		// 生成输出
		for (const file of sortedFiles) {
			const fileTags = byFile.get(file)!;

			lines.push(`${file}:`);

			// 只显示定义（不显示引用，减少噪音）
			const defs = fileTags.filter(t => t.kind === 'def');

			// 按行号排序
			defs.sort((a, b) => a.line - b.line);

			for (const tag of defs) {
				// 格式：  函数名 (行123)
				lines.push(`  ${tag.name}${tag.signature ? tag.signature : ''} (L${tag.line + 1})`);
			}

			lines.push('');  // 文件之间空行
		}

		// 如果没有任何内容
		if (sortedFiles.length === 0) {
			return '';
		}

		return `<repo_map>\n${lines.join('\n')}\n</repo_map>`;
	}

	/**
	 * P0优化：Token采样估算（借鉴Aider）
	 * 对于小文本：精确计算
	 * 对于大文本：1%采样后线性外推，大幅减少计算量
	 */
	private estimateTokens(text: string): number {
		const textLength = text.length;

		// 小文本直接计算
		if (textLength < 500) {
			return estimateTokensFromChars(textLength);
		}

		// 大文本采样估算
		const lines = text.split('\n');
		const numLines = lines.length;

		// 每100行采样1行（1%采样率）
		const step = Math.max(1, Math.floor(numLines / 100));
		const sampledLines: string[] = [];

		for (let i = 0; i < numLines; i += step) {
			sampledLines.push(lines[i]);
		}

		const sampleText = sampledLines.join('\n');
		const sampleTokens = estimateTokensFromChars(sampleText.length);

		// 线性外推
		const estimatedTokens = Math.ceil(sampleTokens / sampleText.length * textLength);

		if (this.verbose) {
			console.log(`[RepoMapGenerator] Token采样估算: 文本${textLength}字符, 采样${sampleText.length}字符, 估算${estimatedTokens}tokens`);
		}

		return estimatedTokens;
	}

	/**
	 * 生成缓存key
	 */
	private getCacheKey(context: RepoMapContext): string {
		const chatFilesSorted = [...context.chatFiles].sort();
		const otherFilesSorted = [...context.otherFiles].sort();
		const mentionedFilesSorted = context.mentionedFiles
			? Array.from(context.mentionedFiles).sort()
			: [];
		const mentionedIdentsSorted = context.mentionedIdents
			? Array.from(context.mentionedIdents).sort()
			: [];

		return JSON.stringify({
			chat: chatFilesSorted,
			other: otherFilesSorted,
			mentionedFiles: mentionedFilesSorted,
			mentionedIdents: mentionedIdentsSorted,
			budget: context.tokenBudget
		});
	}

	/**
	 * 清除缓存
	 */
	clearCache(): void {
		this.mapCache.clear();
		this.tagExtractor.clearCache();
		if (this.verbose) {
			console.log('[RepoMapGenerator] 所有缓存已清除');
		}
	}

	/**
	 * 获取统计信息
	 * P0优化：增加缓存命中率统计
	 */
	getStats(): {
		mapCacheSize: number;
		tagCacheSize: number;
		lastMapLength: number;
		cacheHitRate: string;
		cacheHits: number;
		cacheMisses: number;
	} {
		return {
			mapCacheSize: this.mapCache.size,
			tagCacheSize: this.tagExtractor.getCacheStats().size,
			lastMapLength: this.lastGeneratedMap?.length || 0,
			cacheHitRate: this.getCacheHitRate(),
			cacheHits: this.cacheHits,
			cacheMisses: this.cacheMisses
		};
	}
}
