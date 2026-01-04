/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISearchService, QueryType, resultIsMatch } from '../../../../services/search/common/search.js';
import { URI } from '../../../../../base/common/uri.js';
import { SearchFilesToolUse, CodebaseSearchToolUse, ToolResponse } from '../../common/tools/toolTypes.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { IRipgrepService } from '../../../../services/ripgrep/common/ripgrep.js';
import * as glob from '../../../../../base/common/glob.js';

/**
 * P1优化：搜索结果缓存条目
 */
interface SearchCacheEntry {
	result: string;
	timestamp: number;
}

/**
 * 搜索工具类
 * 实现文件搜索和代码库搜索功能
 * 优化：直接使用 ISearchService (底层使用 ripgrep)，简化搜索策略
 * P1优化：增加搜索结果缓存
 */
export class SearchTool {
	// P1优化：搜索结果缓存
	private readonly searchCache: Map<string, SearchCacheEntry> = new Map();
	private readonly CACHE_TTL = 30000; // 30秒缓存
	private readonly MAX_CACHE_SIZE = 100;
	private cacheHits = 0;
	private cacheMisses = 0;

	constructor(
		private readonly searchService: ISearchService,
		// @ts-expect-error: ripgrepService保留以备将来使用
		private readonly _ripgrepService: IRipgrepService,
		private readonly workspaceRoot: string
	) {
		console.log('[SearchTool] 初始化，工作区:', workspaceRoot);
	}

	/**
	 * 搜索文件
	 * 使用 ISearchService.fileSearch()，底层由 Extension Host 的 ripgrep 实现
	 * @param toolUse 搜索文件工具使用信息
	 * @returns 搜索结果
	 */
	async searchFiles(toolUse: SearchFilesToolUse): Promise<ToolResponse> {
		const { path, regex, file_pattern } = toolUse.params;
		const startTime = Date.now();

		if (!regex && !file_pattern) {
			return '错误: 必须提供搜索模式(regex)或文件模式(file_pattern)';
		}

		try {
			// 如果没有提供path,使用workspaceRoot作为默认搜索路径
			const searchPath = path || this.workspaceRoot;
			const folderUri = URI.file(searchPath);
			const includePattern = file_pattern || '**/*';

			console.log('[SearchTool] searchFiles 开始，路径:', searchPath, '模式:', includePattern);

			// 创建可取消的 token（5秒超时）
			const cts = new CancellationTokenSource();
			const timeoutId = setTimeout(() => cts.cancel(), 5000);

			try {
				// 使用文件搜索（由 Extension Host ripgrep 实现）
				const result = await this.searchService.fileSearch({
					type: QueryType.File,
					filePattern: includePattern,
					folderQueries: [{ folder: folderUri }],
					maxResults: 500
				}, cts.token);

				clearTimeout(timeoutId);
				const elapsed = Date.now() - startTime;
				console.log('[SearchTool] searchFiles 完成，耗时:', elapsed, 'ms，结果数:', result?.results?.length || 0);

				if (!result || !result.results || result.results.length === 0) {
					return '未找到匹配的文件';
				}

				const files = result.results.map(r => r.resource.fsPath);
				return files.join('\n');
			} finally {
				clearTimeout(timeoutId);
				cts.dispose();
			}
		} catch (error) {
			const elapsed = Date.now() - startTime;
			console.error('[SearchTool] searchFiles 失败，耗时:', elapsed, 'ms，错误:', error);
			return `搜索文件失败: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * 代码库搜索
	 * 优化：直接使用 ISearchService.textSearch()（底层使用 ripgrep）
	 * 简化策略：先执行直接搜索，只在无结果时尝试回退
	 * P1优化：增加搜索结果缓存
	 * @param toolUse 代码库搜索工具使用信息
	 * @returns 搜索结果
	 */
	async codebaseSearch(toolUse: CodebaseSearchToolUse): Promise<ToolResponse> {
		let { query, path, file_pattern } = toolUse.params;

		if (!query) {
			return '错误: 未提供搜索查询';
		}

		// P1优化：清理query，移除AI错误传入的上下文标签
		const originalQuery = query;
		query = this.cleanSearchQuery(query);

		if (query !== originalQuery) {
			console.log('[SearchTool] Query已清理，原始长度:', originalQuery.length, '清理后:', query.length);
		}

		const startTime = Date.now();
		const searchPath = path || this.workspaceRoot;

		// P1优化：检查缓存
		const cacheKey = this.getCacheKey(query, searchPath, file_pattern);
		const cachedResult = this.getFromCache(cacheKey);
		if (cachedResult) {
			this.cacheHits++;
			console.log(`[SearchTool] 使用缓存结果 (命中率: ${this.getCacheHitRate()}%)`);
			return cachedResult;
		}
		this.cacheMisses++;

		try {
			const folderUri = URI.file(searchPath);

			const includePattern: glob.IExpression | undefined = file_pattern
				? { [file_pattern]: true }
				: undefined;

			console.log('[SearchTool] codebaseSearch 开始，查询:', query, '路径:', searchPath);

			// 创建可取消的 token（5秒超时）
			const cts = new CancellationTokenSource();
			const timeoutId = setTimeout(() => cts.cancel(), 5000);

			try {
				// 策略1: 直接文本搜索（使用 ripgrep）
				const searchStart = Date.now();
				const results = await this.performTextSearchDirect(folderUri, query, includePattern, false, cts.token);
				const searchElapsed = Date.now() - searchStart;
				console.log('[SearchTool] 直接搜索完成，耗时:', searchElapsed, 'ms，结果数:', results.size);

				// 如果直接搜索有结果，直接返回
				if (results.size > 0) {
					clearTimeout(timeoutId);
					const result = this.formatSearchResults(query, results, startTime);
					this.setCache(cacheKey, result);
					return result;
				}

				// 策略2: 如果直接搜索无结果，使用智能关键词提取（支持中文）
				const keywords = this.extractSearchKeywords(query);
				if (keywords.length > 0) {
					console.log('[SearchTool] 直接搜索无结果，尝试关键词搜索:', keywords.slice(0, 5));
					const keywordStart = Date.now();

					// 搜索提取的关键词（最多5个）
					for (const keyword of keywords.slice(0, 5)) {
						if (cts.token.isCancellationRequested) break;
						if (results.size >= 50) break; // 足够结果就停止
						const keywordResults = await this.performTextSearchDirect(folderUri, keyword, includePattern, false, cts.token);
						keywordResults.forEach((v, k) => results.set(k, v));
					}

					const keywordElapsed = Date.now() - keywordStart;
					console.log('[SearchTool] 关键词搜索完成，耗时:', keywordElapsed, 'ms，累计结果:', results.size);
				}

				clearTimeout(timeoutId);
				const result = this.formatSearchResults(query, results, startTime);
				this.setCache(cacheKey, result);
				return result;
			} finally {
				clearTimeout(timeoutId);
				cts.dispose();
			}
		} catch (error) {
			const elapsed = Date.now() - startTime;
			console.error('[SearchTool] codebaseSearch 失败，耗时:', elapsed, 'ms，错误:', error);
			return `代码库搜索失败: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * 格式化搜索结果
	 */
	private formatSearchResults(
		query: string,
		results: Map<string, { filePath: string; lineNumber: number; line: string }>,
		startTime: number
	): string {
		const elapsed = Date.now() - startTime;
		console.log('[SearchTool] codebaseSearch 完成，总耗时:', elapsed, 'ms，最终结果:', results.size);

		if (results.size === 0) {
			return `未找到与 "${query}" 相关的结果。\n\n建议：\n- 尝试使用 glob 工具按文件名搜索\n- 尝试 search_files 进行正则表达式搜索`;
		}

		const sortedResults = Array.from(results.values())
			.slice(0, 50)
			.map(r => `${r.filePath}:${r.lineNumber}: ${r.line.trim()}`);

		return `找到 ${results.size} 个匹配 (显示前${sortedResults.length}个，耗时${elapsed}ms):\n\n${sortedResults.join('\n')}`;
	}

	/**
	 * 执行直接文本搜索（返回新的 Map）
	 */
	private async performTextSearchDirect(
		folderUri: URI,
		pattern: string,
		includePattern: glob.IExpression | undefined,
		isRegExp: boolean,
		token: CancellationToken
	): Promise<Map<string, { filePath: string; lineNumber: number; line: string }>> {
		const results = new Map<string, { filePath: string; lineNumber: number; line: string }>();

		try {
			const searchResult = await this.searchService.textSearch(
				{
					type: QueryType.Text,
					contentPattern: {
						pattern,
						isRegExp,
						isCaseSensitive: false,
						isWordMatch: false
					},
					includePattern,
					maxResults: 100,
					folderQueries: [{ folder: folderUri }]
				},
				token
			);

			if (searchResult && searchResult.results) {
				for (const fileMatch of searchResult.results) {
					if ('results' in fileMatch && fileMatch.results) {
						const filePath = fileMatch.resource.fsPath;

						for (const textResult of fileMatch.results) {
							if (resultIsMatch(textResult)) {
								const line = textResult.previewText;
								const lineNumber = textResult.rangeLocations[0]?.source.startLineNumber ?? 0;
								const key = `${filePath}:${lineNumber}`;

								if (!results.has(key)) {
									results.set(key, { filePath, lineNumber, line });
								}
							}
						}
					}
				}
			}
		} catch (error) {
			// 搜索被取消或失败
			if (!(error instanceof Error && error.message.includes('cancel'))) {
				console.warn('[SearchTool] 文本搜索失败:', error);
			}
		}

		return results;
	}

	/**
	 * 列出代码定义名称
	 * 使用符号搜索功能
	 */
	async listCodeDefinitionNames(path: string): Promise<ToolResponse> {
		try {
			// TODO: 实现符号搜索
			// 需要使用IWorkspaceSymbolProvider或语言服务
			return '代码定义列表功能暂未实现';
		} catch (error) {
			return `列出代码定义失败: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * P1优化：清理搜索查询
	 * 移除AI错误传入的environment_details和repo_map标签
	 */
	private cleanSearchQuery(query: string): string {
		let cleaned = query;

		// 移除 <environment_details> 标签及其内容
		cleaned = cleaned.replace(/<environment_details>[\s\S]*?<\/environment_details>/g, '');

		// 移除 <repo_map> 标签及其内容
		cleaned = cleaned.replace(/<repo_map>[\s\S]*?<\/repo_map>/g, '');

		// 移除 <preloaded_code> 标签及其内容（预加载的代码）
		cleaned = cleaned.replace(/<preloaded_code>[\s\S]*?<\/preloaded_code>/g, '');

		// 移除多余的空行
		cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

		// trim
		cleaned = cleaned.trim();

		// 移除换行符，避免正则表达式解析错误
		// ripgrep 不支持换行符作为搜索内容
		cleaned = cleaned.replace(/[\r\n]+/g, ' ').trim();

		// 如果清理后为空，尝试提取第一行
		if (!cleaned && query) {
			const firstLine = query.split('\n')[0];
			cleaned = firstLine.replace(/<[^>]+>/g, '').trim();
		}

		return cleaned || query;
	}

	/**
	 * 提取搜索关键词
	 * 支持中文分词和英文单词提取
	 */
	private extractSearchKeywords(query: string): string[] {
		const keywords: string[] = [];

		// 1. 提取英文单词（驼峰命名、下划线命名等）
		const englishWords = query.match(/[a-zA-Z][a-zA-Z0-9_]*[a-zA-Z0-9]/g) || [];
		keywords.push(...englishWords.filter(w => w.length >= 3));

		// 2. 中文关键词提取 - 基于常见编程术语
		const chineseTerms = [
			'登录', '注册', '验证', '验证码', '短信', '用户', '密码',
			'接口', '服务', '控制器', '配置', '参数', '请求', '响应',
			'数据', '查询', '新增', '修改', '删除', '列表', '详情',
			'权限', '角色', '菜单', '日志', '缓存', '任务', '定时',
			'上传', '下载', '导入', '导出', '审核', '流程', '工作流',
			'支付', '订单', '商品', '库存', '会员', '积分', '优惠',
			'消息', '通知', '推送', '邮件', '模板', '配置', '系统'
		];

		for (const term of chineseTerms) {
			if (query.includes(term)) {
				keywords.push(term);
			}
		}

		// 3. 如果没有找到关键词，尝试按常见分隔符分割中文
		if (keywords.length === 0) {
			const chineseWords = query.split(/[，。、；：！？\s]+/).filter(w => w.length >= 2 && w.length <= 10);
			keywords.push(...chineseWords.slice(0, 5));
		}

		// 去重
		return [...new Set(keywords)];
	}

	// ========== P1优化：搜索缓存方法 ==========

	/**
	 * 生成缓存键
	 */
	private getCacheKey(query: string, path: string, filePattern?: string): string {
		return `${query}:${path}:${filePattern || ''}`;
	}

	/**
	 * 从缓存获取结果
	 */
	private getFromCache(key: string): string | null {
		const entry = this.searchCache.get(key);
		if (!entry) {
			return null;
		}

		// 检查TTL
		if (Date.now() - entry.timestamp > this.CACHE_TTL) {
			this.searchCache.delete(key);
			return null;
		}

		return entry.result;
	}

	/**
	 * 设置缓存
	 */
	private setCache(key: string, result: string): void {
		// 清理过期缓存和限制大小
		if (this.searchCache.size >= this.MAX_CACHE_SIZE) {
			this.cleanCache();
		}

		this.searchCache.set(key, {
			result,
			timestamp: Date.now()
		});
	}

	/**
	 * 清理过期缓存
	 */
	private cleanCache(): void {
		const now = Date.now();
		const keysToDelete: string[] = [];

		this.searchCache.forEach((entry, key) => {
			if (now - entry.timestamp > this.CACHE_TTL) {
				keysToDelete.push(key);
			}
		});

		keysToDelete.forEach(key => this.searchCache.delete(key));

		// 如果仍然超过限制，删除最旧的
		if (this.searchCache.size >= this.MAX_CACHE_SIZE) {
			const entries = Array.from(this.searchCache.entries())
				.sort((a, b) => a[1].timestamp - b[1].timestamp);

			const toDelete = entries.slice(0, Math.floor(this.MAX_CACHE_SIZE / 2));
			toDelete.forEach(([key]) => this.searchCache.delete(key));
		}
	}

	/**
	 * 获取缓存命中率
	 */
	private getCacheHitRate(): string {
		const total = this.cacheHits + this.cacheMisses;
		if (total === 0) return '0';
		return ((this.cacheHits / total) * 100).toFixed(1);
	}

	/**
	 * 获取缓存统计
	 */
	public getCacheStats(): { size: number; hitRate: string; hits: number; misses: number } {
		return {
			size: this.searchCache.size,
			hitRate: this.getCacheHitRate(),
			hits: this.cacheHits,
			misses: this.cacheMisses
		};
	}

	/**
	 * 清除缓存
	 */
	public clearCache(): void {
		this.searchCache.clear();
		this.cacheHits = 0;
		this.cacheMisses = 0;
		console.log('[SearchTool] 搜索缓存已清除');
	}
}
