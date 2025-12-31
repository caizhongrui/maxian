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
import { TagExtractor } from './TagExtractor.js';
import { ReferenceGraphBuilder } from './ReferenceGraphBuilder.js';
import { PageRankSorter } from './PageRankSorter.js';
import { Tag, RepoMapOptions, RepoMapContext } from './types.js';

/**
 * RepoMapGenerator - 主类
 */
export class RepoMapGenerator {
	private tagExtractor: TagExtractor;
	private graphBuilder: ReferenceGraphBuilder;
	private pageRankSorter: PageRankSorter;

	// 配置
	private maxTokens: number;
	private mapMulNoFiles: number;
	private verbose: boolean;

	// 缓存
	private mapCache: Map<string, string> = new Map();
	private lastGeneratedMap: string | null = null;

	constructor(options: RepoMapOptions) {
		this.tagExtractor = new TagExtractor(options.workspaceRoot, options.verbose);
		this.graphBuilder = new ReferenceGraphBuilder();
		this.pageRankSorter = new PageRankSorter();

		this.maxTokens = options.maxTokens || 2048;
		this.mapMulNoFiles = options.mapMulNoFiles || 8;
		this.verbose = options.verbose || false;
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
	 */
	async generateRanked(context: RepoMapContext): Promise<string> {
		// 1. 生成缓存key
		const cacheKey = this.getCacheKey(context);

		// 检查缓存
		if (this.mapCache.has(cacheKey)) {
			if (this.verbose) {
				console.log('[RepoMapGenerator] 使用缓存结果');
			}
			return this.mapCache.get(cacheKey)!;
		}

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
			console.log(`[RepoMapGenerator] 生成耗时 ${endTime - startTime}ms`);
		}

		// 4. 缓存结果
		this.mapCache.set(cacheKey, result);
		this.lastGeneratedMap = result;

		return result;
	}

	/**
	 * 生成RepoMap（无缓存）
	 * 参考 Aider 的 get_ranked_tags_map_uncached 方法（第610-687行）
	 */
	private async generateUncached(context: RepoMapContext, tokenBudget: number): Promise<string> {
		const allFiles = [...context.chatFiles, ...context.otherFiles];

		if (allFiles.length === 0) {
			return '';
		}

		// 1. 提取所有tags
		if (this.verbose) {
			console.log(`[RepoMapGenerator] 提取tags，共 ${allFiles.length} 个文件`);
		}

		const allTags = await this.tagExtractor.extractTagsFromFiles(allFiles);

		if (allTags.length === 0) {
			if (this.verbose) {
				console.log('[RepoMapGenerator] 未找到任何tags');
			}
			return '';
		}

		// 2. 构建引用图
		const chatFilesSet = new Set(context.chatFiles.map(f => path.relative(this.tagExtractor['workspaceRoot'], f)));
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

		// 添加说明前缀（参考Aider的repo_content_prefix）
		lines.push('# 代码库地图（RepoMap）');
		lines.push('');
		lines.push('这是你的git仓库中的文件摘要。');
		lines.push('如果需要查看完整文件内容，使用 read_file 工具。');
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
	 * 估算token数
	 * 简化实现：1 token ≈ 4 个字符（英文）或 2 个字符（中文）
	 * 平均使用 3 个字符
	 */
	private estimateTokens(text: string): number {
		return Math.ceil(text.length / 3);
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
	 */
	getStats(): {
		mapCacheSize: number;
		tagCacheSize: number;
		lastMapLength: number;
	} {
		return {
			mapCacheSize: this.mapCache.size,
			tagCacheSize: this.tagExtractor.getCacheStats().size,
			lastMapLength: this.lastGeneratedMap?.length || 0
		};
	}
}
