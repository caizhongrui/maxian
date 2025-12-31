/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ReferenceGraphBuilder - 引用图构建器
 * 构建文件间的引用关系图，用于PageRank排序
 * 参考 Aider 的 get_ranked_tags 实现
 */

import { Tag, GraphEdge, WeightFactors } from './types.js';

/**
 * 简化的图结构
 */
export class DirectedGraph {
	private nodes: Set<string> = new Set();
	private edges: Map<string, GraphEdge[]> = new Map();  // from -> edges[]
	private inEdges: Map<string, GraphEdge[]> = new Map(); // to -> edges[]

	/**
	 * 添加节点
	 */
	addNode(node: string): void {
		this.nodes.add(node);
		if (!this.edges.has(node)) {
			this.edges.set(node, []);
		}
		if (!this.inEdges.has(node)) {
			this.inEdges.set(node, []);
		}
	}

	/**
	 * 添加边
	 */
	addEdge(from: string, to: string, weight: number, ident: string): void {
		this.addNode(from);
		this.addNode(to);

		const edge: GraphEdge = { from, to, weight, ident };

		this.edges.get(from)!.push(edge);
		this.inEdges.get(to)!.push(edge);
	}

	/**
	 * 获取所有节点
	 */
	getNodes(): string[] {
		return Array.from(this.nodes);
	}

	/**
	 * 获取出边
	 */
	getOutEdges(node: string): GraphEdge[] {
		return this.edges.get(node) || [];
	}

	/**
	 * 获取入边
	 */
	getInEdges(node: string): GraphEdge[] {
		return this.inEdges.get(node) || [];
	}

	/**
	 * 获取节点的出度权重总和
	 */
	getOutWeightSum(node: string): number {
		const edges = this.getOutEdges(node);
		return edges.reduce((sum, edge) => sum + edge.weight, 0);
	}
}

/**
 * ReferenceGraphBuilder - 引用图构建器
 */
export class ReferenceGraphBuilder {
	private readonly defaultWeightFactors: WeightFactors = {
		mentionedIdent: 10,
		longNamedIdent: 10,
		privateIdent: 0.1,
		commonName: 0.1,
		chatFileReference: 50
	};

	/**
	 * 构建引用图
	 * 参考 Aider 的核心算法（第346-496行）
	 */
	buildGraph(
		tags: Tag[],
		chatFiles: Set<string>,
		mentionedIdents: Set<string>,
		weightFactors?: Partial<WeightFactors>
	): DirectedGraph {
		const factors = { ...this.defaultWeightFactors, ...weightFactors };
		const graph = new DirectedGraph();

		// 1. 收集定义和引用
		const defines = new Map<string, Set<string>>();      // ident -> Set<file>
		const references = new Map<string, string[]>();      // ident -> file[]
		const definitions = new Map<string, Set<Tag>>();     // (file, ident) -> Set<Tag>

		for (const tag of tags) {
			if (tag.kind === 'def') {
				// 收集定义
				if (!defines.has(tag.name)) {
					defines.set(tag.name, new Set());
				}
				defines.get(tag.name)!.add(tag.relFname);

				// 收集定义的详细信息
				const key = `${tag.relFname}::${tag.name}`;
				if (!definitions.has(key)) {
					definitions.set(key, new Set());
				}
				definitions.get(key)!.add(tag);
			} else if (tag.kind === 'ref') {
				// 收集引用
				if (!references.has(tag.name)) {
					references.set(tag.name, []);
				}
				references.get(tag.name)!.push(tag.relFname);
			}
		}

		// 2. 如果没有引用，使用定义作为引用（某些语言tree-sitter只提供定义）
		if (references.size === 0 && defines.size > 0) {
			for (const [ident, files] of defines) {
				references.set(ident, Array.from(files));
			}
		}

		// 3. 找到同时有定义和引用的标识符
		const idents = new Set<string>();
		for (const ident of defines.keys()) {
			if (references.has(ident)) {
				idents.add(ident);
			}
		}

		// 4. 为没有引用的定义添加自环（权重0.1）
		for (const ident of defines.keys()) {
			if (!references.has(ident)) {
				const definers = defines.get(ident)!;
				for (const definer of definers) {
					graph.addEdge(definer, definer, 0.1, ident);
				}
			}
		}

		// 5. 为每个标识符构建引用边
		for (const ident of idents) {
			const definers = defines.get(ident)!;
			const refs = references.get(ident)!;

			// 计算基础权重倍数
			const baseMul = this.calculateBaseMultiplier(ident, mentionedIdents, definers.size, factors);

			// 统计每个引用者的引用次数
			const refCounter = this.countReferences(refs);

			// 为每个引用者→定义者添加边
			for (const [referencer, numRefs] of refCounter) {
				for (const definer of definers) {
					let useMul = baseMul;

					// ⭐ 关键：chat文件中的引用权重×50
					if (chatFiles.has(referencer)) {
						useMul *= factors.chatFileReference;
					}

					// 引用次数取平方根（降低高频引用的支配性）
					const weight = useMul * Math.sqrt(numRefs);

					graph.addEdge(referencer, definer, weight, ident);
				}
			}
		}

		return graph;
	}

	/**
	 * 计算基础权重倍数
	 * 参考 Aider 第468-480行
	 */
	private calculateBaseMultiplier(
		ident: string,
		mentionedIdents: Set<string>,
		definerCount: number,
		factors: WeightFactors
	): number {
		let mul = 1.0;

		// 1. 用户提到的标识符 ×10
		if (mentionedIdents.has(ident)) {
			mul *= factors.mentionedIdent;
		}

		// 2. 命名风格（snake_case, camelCase, kebab-case）且长度>=8 ×10
		const isSnake = ident.includes('_') && /[a-zA-Z]/.test(ident);
		const isCamel = /[a-z]/.test(ident) && /[A-Z]/.test(ident);
		const isKebab = ident.includes('-') && /[a-zA-Z]/.test(ident);

		if ((isSnake || isCamel || isKebab) && ident.length >= 8) {
			mul *= factors.longNamedIdent;
		}

		// 3. 私有符号（_开头）×0.1
		if (ident.startsWith('_')) {
			mul *= factors.privateIdent;
		}

		// 4. 被太多文件定义（可能是通用名如 'id', 'name'）×0.1
		if (definerCount > 5) {
			mul *= factors.commonName;
		}

		return mul;
	}

	/**
	 * 统计引用次数
	 */
	private countReferences(refs: string[]): Map<string, number> {
		const counter = new Map<string, number>();
		for (const ref of refs) {
			counter.set(ref, (counter.get(ref) || 0) + 1);
		}
		return counter;
	}
}
