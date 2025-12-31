/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * PageRankSorter - PageRank排序器
 * 使用PageRank算法对文件进行排序
 * 参考 Aider 的实现（第506行 nx.pagerank）和后续的rank分配逻辑
 */

import { DirectedGraph } from './ReferenceGraphBuilder.js';
import { Tag, PageRankConfig } from './types.js';

/**
 * PageRankSorter - 实现PageRank算法
 */
export class PageRankSorter {
	private readonly defaultConfig: PageRankConfig = {
		damping: 0.85,       // 阻尼系数（Google PageRank标准值）
		maxIterations: 100,  // 最大迭代次数
		tolerance: 1e-6      // 收敛容差
	};

	/**
	 * 对文件进行PageRank排序
	 * 返回：(file, ident) -> rank 的映射
	 */
	rankFiles(
		graph: DirectedGraph,
		tags: Tag[],
		chatFiles: Set<string>,
		mentionedFiles: Set<string>,
		config?: Partial<PageRankConfig>
	): Map<string, number> {
		const cfg = { ...this.defaultConfig, ...config };

		// 1. 构建个性化权重
		const personalization = this.buildPersonalization(graph, chatFiles, mentionedFiles);

		// 2. 运行PageRank算法
		const fileRanks = this.pageRank(graph, personalization, cfg);

		// 3. 分配rank到定义（参考Aider第514-526行）
		const rankedDefinitions = this.distributeRankToDefinitions(graph, fileRanks, tags);

		return rankedDefinitions;
	}

	/**
	 * 构建个性化权重
	 * 参考 Aider 第362-426行
	 */
	private buildPersonalization(
		graph: DirectedGraph,
		chatFiles: Set<string>,
		mentionedFiles: Set<string>
	): Map<string, number> {
		const nodes = graph.getNodes();
		const personalize = 100 / nodes.length;  // 基础权重
		const personalization = new Map<string, number>();

		for (const node of nodes) {
			let pers = 0.0;

			// chat文件权重
			if (chatFiles.has(node)) {
				pers += personalize;
			}

			// 用户提到的文件权重（使用max避免重复计数）
			if (mentionedFiles.has(node)) {
				pers = Math.max(pers, personalize);
			}

			if (pers > 0) {
				personalization.set(node, pers);
			}
		}

		return personalization;
	}

	/**
	 * PageRank算法实现
	 * 参考 NetworkX 的 pagerank 实现
	 */
	private pageRank(
		graph: DirectedGraph,
		personalization: Map<string, number>,
		config: PageRankConfig
	): Map<string, number> {
		const nodes = graph.getNodes();
		const n = nodes.length;

		if (n === 0) {
			return new Map();
		}

		// 初始化rank（均匀分布）
		const rank = new Map<string, number>();
		for (const node of nodes) {
			rank.set(node, 1.0 / n);
		}

		// 计算personalization总和（用于归一化）
		let persSum = 0;
		for (const pers of personalization.values()) {
			persSum += pers;
		}

		// 如果没有personalization，使用均匀分布
		if (persSum === 0) {
			persSum = n;
			for (const node of nodes) {
				personalization.set(node, 1.0);
			}
		}

		// 迭代计算PageRank
		for (let iter = 0; iter < config.maxIterations; iter++) {
			const newRank = new Map<string, number>();
			let diff = 0.0;

			for (const node of nodes) {
				// 计算来自入边的rank贡献
				let sum = 0.0;
				const inEdges = graph.getInEdges(node);

				for (const edge of inEdges) {
					const from = edge.from;
					const fromRank = rank.get(from) || 0;
					const outWeightSum = graph.getOutWeightSum(from);

					if (outWeightSum > 0) {
						// 按边的权重分配rank
						sum += (fromRank * edge.weight) / outWeightSum;
					}
				}

				// PageRank公式：
				// PR(node) = (1-d) * personalization + d * sum
				const pers = (personalization.get(node) || 0) / persSum;
				const newValue = (1 - config.damping) * pers + config.damping * sum;

				newRank.set(node, newValue);

				// 计算变化量（用于检查收敛）
				const oldValue = rank.get(node) || 0;
				diff += Math.abs(newValue - oldValue);
			}

			// 更新rank
			for (const [node, value] of newRank) {
				rank.set(node, value);
			}

			// 检查收敛
			if (diff < config.tolerance) {
				console.log(`[PageRank] 在第 ${iter + 1} 次迭代后收敛`);
				break;
			}
		}

		return rank;
	}

	/**
	 * 分配rank到定义
	 * 参考 Aider 第514-539行
	 *
	 * 核心思想：
	 * 从每个源节点出发，将其rank按权重分配到所有出边的定义
	 */
	private distributeRankToDefinitions(
		graph: DirectedGraph,
		fileRanks: Map<string, number>,
		tags: Tag[]
	): Map<string, number> {
		const rankedDefs = new Map<string, number>();

		// 构建定义索引：(file, ident) -> Set<Tag>
		const definitions = new Map<string, Set<Tag>>();
		for (const tag of tags) {
			if (tag.kind === 'def') {
				const key = `${tag.relFname}::${tag.name}`;
				if (!definitions.has(key)) {
					definitions.set(key, new Set());
				}
				definitions.get(key)!.add(tag);
			}
		}

		// 为每个源节点分配rank
		for (const src of graph.getNodes()) {
			const srcRank = fileRanks.get(src) || 0;
			const outEdges = graph.getOutEdges(src);

			if (outEdges.length === 0) {
				continue;
			}

			// 计算总权重
			const totalWeight = outEdges.reduce((sum, edge) => sum + edge.weight, 0);

			if (totalWeight === 0) {
				continue;
			}

			// 按权重分配rank到每个目标定义
			for (const edge of outEdges) {
				const dst = edge.to;
				const ident = edge.ident;
				const edgeRank = (srcRank * edge.weight) / totalWeight;

				// (dst, ident) 组合作为key
				const key = `${dst}::${ident}`;
				rankedDefs.set(key, (rankedDefs.get(key) || 0) + edgeRank);
			}
		}

		return rankedDefs;
	}

	/**
	 * 排序tags
	 * 返回按rank从高到低排序的tags
	 */
	sortTagsByRank(
		tags: Tag[],
		rankedDefinitions: Map<string, number>,
		chatFiles: Set<string>
	): Tag[] {
		// 过滤掉chat files的tags（它们已经在上下文中）
		const filteredTags = tags.filter(tag =>
			tag.kind === 'def' && !chatFiles.has(tag.relFname)
		);

		// 为每个tag计算rank
		const tagRanks: Array<{ tag: Tag; rank: number }> = [];
		for (const tag of filteredTags) {
			const key = `${tag.relFname}::${tag.name}`;
			const rank = rankedDefinitions.get(key) || 0;
			tagRanks.push({ tag, rank });
		}

		// 按rank排序（从高到低）
		tagRanks.sort((a, b) => {
			// 先按rank排序
			if (b.rank !== a.rank) {
				return b.rank - a.rank;
			}
			// rank相同时按文件名和符号名排序（保证确定性）
			if (a.tag.relFname !== b.tag.relFname) {
				return a.tag.relFname.localeCompare(b.tag.relFname);
			}
			return a.tag.name.localeCompare(b.tag.name);
		});

		return tagRanks.map(item => item.tag);
	}
}
