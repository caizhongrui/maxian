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
 * 搜索工具类
 * 实现文件搜索和代码库搜索功能
 * 优化：直接使用 ISearchService (底层使用 ripgrep)，简化搜索策略
 */
export class SearchTool {
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
	 * @param toolUse 代码库搜索工具使用信息
	 * @returns 搜索结果
	 */
	async codebaseSearch(toolUse: CodebaseSearchToolUse): Promise<ToolResponse> {
		const { query, path, file_pattern } = toolUse.params;

		if (!query) {
			return '错误: 未提供搜索查询';
		}

		const startTime = Date.now();

		try {
			const searchPath = path || this.workspaceRoot;
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
					return this.formatSearchResults(query, results, startTime);
				}

				// 策略2: 如果直接搜索无结果，尝试关键词分词搜索
				const keywords = query.split(/\s+/).filter(w => w.length > 2);
				if (keywords.length > 1) {
					console.log('[SearchTool] 直接搜索无结果，尝试关键词搜索:', keywords.slice(0, 2));
					const keywordStart = Date.now();

					// 只搜索前2个关键词
					for (const keyword of keywords.slice(0, 2)) {
						if (cts.token.isCancellationRequested) break;
						const keywordResults = await this.performTextSearchDirect(folderUri, keyword, includePattern, false, cts.token);
						keywordResults.forEach((v, k) => results.set(k, v));
					}

					const keywordElapsed = Date.now() - keywordStart;
					console.log('[SearchTool] 关键词搜索完成，耗时:', keywordElapsed, 'ms，累计结果:', results.size);
				}

				clearTimeout(timeoutId);
				return this.formatSearchResults(query, results, startTime);
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
}
