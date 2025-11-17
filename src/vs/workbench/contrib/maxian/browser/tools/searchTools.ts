/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISearchService, QueryType, resultIsMatch } from '../../../../services/search/common/search.js';
import { URI } from '../../../../../base/common/uri.js';
import { SearchFilesToolUse, CodebaseSearchToolUse, ToolResponse } from '../../common/tools/toolTypes.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IRipgrepService } from '../../../../services/ripgrep/common/ripgrep.js';
import * as glob from '../../../../../base/common/glob.js';

/**
 * 搜索工具类
 * 实现文件搜索和代码库搜索功能
 */
export class SearchTool {
	constructor(
		private readonly searchService: ISearchService,
		// @ts-expect-error: ripgrepService保留以备将来使用
		private readonly _ripgrepService: IRipgrepService,
		private readonly workspaceRoot: string
	) { }

	/**
	 * 搜索文件
	 * @param toolUse 搜索文件工具使用信息
	 * @returns 搜索结果
	 */
	async searchFiles(toolUse: SearchFilesToolUse): Promise<ToolResponse> {
		const { path, regex, file_pattern } = toolUse.params;

		if (!regex && !file_pattern) {
			return '错误: 必须提供搜索模式(regex)或文件模式(file_pattern)';
		}

		try {
			// 如果没有提供path,使用workspaceRoot作为默认搜索路径
			const searchPath = path || this.workspaceRoot;
			const folderUri = URI.file(searchPath);
			const includePattern = file_pattern || '**/*';

			// 使用文件搜索
			const result = await this.searchService.fileSearch({
				type: QueryType.File,
				filePattern: includePattern,
				folderQueries: [{ folder: folderUri }],
				maxResults: 500
			}, CancellationToken.None);

			if (!result || !result.results || result.results.length === 0) {
				return '未找到匹配的文件';
			}

			const files = result.results.map(r => r.resource.fsPath);
			return files.join('\n');
		} catch (error) {
			return `搜索文件失败: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * 代码库搜索
	 * 智能搜索：将自然语言查询转换为多种搜索策略
	 * @param toolUse 代码库搜索工具使用信息
	 * @returns 搜索结果
	 */
	async codebaseSearch(toolUse: CodebaseSearchToolUse): Promise<ToolResponse> {
		const { query, path, file_pattern } = toolUse.params;

		if (!query) {
			return '错误: 未提供搜索查询';
		}

		try {
			// 如果没有提供path,使用workspaceRoot作为默认搜索路径
			const searchPath = path || this.workspaceRoot;
			const folderUri = URI.file(searchPath);

			// 将file_pattern字符串转换为glob.IExpression
			const includePattern: glob.IExpression | undefined = file_pattern
				? { [file_pattern]: true }
				: undefined;

			// 智能搜索：尝试多种策略
			const allResults: Map<string, { filePath: string; lineNumber: number; line: string }> = new Map();

			// 策略1: 直接文本搜索（非正则）
			await this.performTextSearch(folderUri, query, includePattern, allResults, false);

			// 策略2: 如果查询包含多个词，搜索每个关键词
			const keywords = query.split(/\s+/).filter(w => w.length > 2);
			if (keywords.length > 1) {
				for (const keyword of keywords.slice(0, 3)) { // 最多搜索前3个关键词
					await this.performTextSearch(folderUri, keyword, includePattern, allResults, false);
				}
			}

			// 策略3: 搜索驼峰命名变体（如：user_config -> userConfig, UserConfig）
			const camelCasePattern = this.toCamelCasePattern(query);
			if (camelCasePattern && camelCasePattern !== query) {
				await this.performTextSearch(folderUri, camelCasePattern, includePattern, allResults, false);
			}

			if (allResults.size === 0) {
				return `未找到与 "${query}" 相关的结果。\n\n建议：\n- 尝试使用 glob 工具按文件名搜索: glob(path, "**/*${query}*")\n- 尝试 search_files 进行正则表达式搜索\n- 尝试 list_files 查看目录结构`;
			}

			// 格式化并排序结果（按相关性）
			const sortedResults = Array.from(allResults.values())
				.slice(0, 50) // 限制结果数量
				.map(r => `${r.filePath}:${r.lineNumber}: ${r.line.trim()}`);

			return `找到 ${allResults.size} 个匹配 (显示前${sortedResults.length}个):\n\n${sortedResults.join('\n')}`;
		} catch (error) {
			return `代码库搜索失败: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * 执行文本搜索
	 */
	private async performTextSearch(
		folderUri: URI,
		pattern: string,
		includePattern: glob.IExpression | undefined,
		results: Map<string, { filePath: string; lineNumber: number; line: string }>,
		isRegExp: boolean
	): Promise<void> {
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
				CancellationToken.None
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
		} catch {
			// 忽略单次搜索失败
		}
	}

	/**
	 * 将查询转换为驼峰命名模式
	 */
	private toCamelCasePattern(query: string): string {
		// 移除特殊字符并转换为驼峰
		const words = query.toLowerCase().split(/[\s_-]+/);
		if (words.length <= 1) {
			return '';
		}
		return words[0] + words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
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
