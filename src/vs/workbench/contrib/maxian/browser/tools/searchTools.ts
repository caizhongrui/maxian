/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISearchService, QueryType, resultIsMatch } from '../../../../services/search/common/search.js';
import { URI } from '../../../../../base/common/uri.js';
import { SearchFilesToolUse, CodebaseSearchToolUse, ToolResponse } from '../../common/tools/toolTypes.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { IRipgrepService } from '../../../../services/ripgrep/common/ripgrep.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import * as path from '../../../../../base/common/path.js';
import * as glob from '../../../../../base/common/glob.js';
import { TOOL_SEARCH_EXCLUDE_GLOBS, isLikelyNoisePath, shouldApplyNoiseFiltering } from '../../common/services/globConstants.js';

/**
 * P1优化：搜索结果缓存条目
 */
interface SearchCacheEntry {
	result: string;
	timestamp: number;
	searchPath: string;
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
	private readonly MAX_CONTENT_OUTPUT_FILES = 8;
	private readonly MAX_CONTENT_OUTPUT_MATCHES = 50;
	private readonly MAX_PREVIEW_LINE_CHARS = 400;
	private readonly verboseLogs = false;
	private cacheHits = 0;
	private cacheMisses = 0;

	constructor(
		private readonly searchService: ISearchService,
		// @ts-expect-error: ripgrepService保留以备将来使用
		private readonly _ripgrepService: IRipgrepService,
		private readonly workspaceRoot: string,
		private readonly fileService?: IFileService
	) {
		this.debugLog('[SearchTool] 初始化，工作区:', workspaceRoot);
	}

	private debugLog(...args: any[]): void {
		if (!this.verboseLogs) {
			return;
		}
		console.log(...args);
	}

	private truncatePreviewLine(line: string): string {
		const trimmed = line.trim();
		if (trimmed.length <= this.MAX_PREVIEW_LINE_CHARS) {
			return trimmed;
		}
		return `${trimmed.slice(0, this.MAX_PREVIEW_LINE_CHARS)}...`;
	}

	private getNoiseExcludePattern(searchPath: string): glob.IExpression | undefined {
		return shouldApplyNoiseFiltering(searchPath, this.workspaceRoot) ? TOOL_SEARCH_EXCLUDE_GLOBS : undefined;
	}

	private filterNoiseFilePaths(filePaths: string[], searchPath: string): string[] {
		if (!shouldApplyNoiseFiltering(searchPath, this.workspaceRoot)) {
			return filePaths;
		}
		return filePaths.filter(filePath => !isLikelyNoisePath(filePath));
	}

	private filterNoiseTextResults(
		results: Map<string, { filePath: string; lineNumber: number; line: string }>,
		searchPath: string
	): Map<string, { filePath: string; lineNumber: number; line: string }> {
		if (!shouldApplyNoiseFiltering(searchPath, this.workspaceRoot)) {
			return results;
		}
		const filtered = new Map<string, { filePath: string; lineNumber: number; line: string }>();
		for (const [key, value] of results.entries()) {
			if (!isLikelyNoisePath(value.filePath)) {
				filtered.set(key, value);
			}
		}
		return filtered;
	}

	/**
	 * 归一化 file_pattern:
	 * - 裸文件名/扩展名模式（如 *.java / package.json）自动补全为递归匹配前缀
	 * - 已包含路径层级（含 / 或双星前缀）的模式保持不变
	 */
	private normalizeFilePattern(pattern: string | undefined): string | undefined {
		if (!pattern) {
			return undefined;
		}
		const normalized = pattern.trim().replace(/\\/g, '/');
		if (!normalized) {
			return undefined;
		}
		if (normalized.startsWith('**/') || normalized.includes('/')) {
			return normalized;
		}
		return `**/${normalized}`;
	}

	/**
	 * 搜索文件
	 * 使用 ISearchService.fileSearch()，底层由 Extension Host 的 ripgrep 实现
	 * @param toolUse 搜索文件工具使用信息
	 * @returns 搜索结果
	 */
	async searchFiles(toolUse: SearchFilesToolUse): Promise<ToolResponse> {
		const { path, regex, file_pattern, output_mode, head_limit, offset } = toolUse.params;
		const startTime = Date.now();

		// output_mode 默认 'files_with_matches'（减少 token 消耗），可选 'content' / 'count'
		const outputMode = (output_mode as 'content' | 'files_with_matches' | 'count') || 'files_with_matches';
		const headLimit = head_limit ? parseInt(head_limit, 10) : 100;
		const offsetVal = offset ? parseInt(offset, 10) : 0;

		if (!regex && !file_pattern) {
			return '错误: 必须提供搜索模式(regex)或文件模式(file_pattern)';
		}

		try {
			// 如果没有提供path,使用workspaceRoot作为默认搜索路径
			// 将相对路径解析为绝对路径（避免使用 Node.js path 模块，兼容 browser/extension 环境）
			const rawPath = path || this.workspaceRoot;
			const searchPath = rawPath.startsWith('/')
				? rawPath
				: `${this.workspaceRoot.replace(/\/$/, '')}/${rawPath}`;

			// 判断 path 是否指向文件（最后一段包含 '.' 且不以 '/' 结尾视为文件路径）
			// 当 path 指向文件时，用其父目录作为 folderUri，文件名作为额外的 includePattern
			const lastSegment = searchPath.split('/').pop() || '';
			const isFilePath = lastSegment.includes('.') && !rawPath.endsWith('/');
			const folderPath = isFilePath
				? searchPath.substring(0, searchPath.lastIndexOf('/'))
				: searchPath;
			const fileNameFilter = isFilePath ? lastSegment : undefined;
			const folderUri = URI.file(folderPath);

			// 创建可取消的 token（30秒超时，大型项目 ripgrep 需要时间）
			const cts = new CancellationTokenSource();
			const timeoutId = setTimeout(() => cts.cancel(), 30000);

			try {
				// 如果提供了 regex，执行内容搜索（QueryType.Text，底层使用 ripgrep 搜索文件内容）
				if (regex) {
					this.debugLog('[SearchTool] searchFiles 内容搜索，路径:', searchPath, 'regex:', regex, 'file_pattern:', file_pattern, 'isFilePath:', isFilePath);

					// 合并文件过滤：若path指向文件则用文件名，否则用file_pattern参数
					const effectiveFilePattern = this.normalizeFilePattern(fileNameFilter || file_pattern);
					const includePattern: glob.IExpression | undefined = effectiveFilePattern
						? { [effectiveFilePattern]: true }
						: undefined;

					const excludePattern = this.getNoiseExcludePattern(searchPath);
					const rawResults = await this.performTextSearchDirect(folderUri, regex, includePattern, excludePattern, true, cts.token);
					const results = this.filterNoiseTextResults(rawResults, searchPath);

					clearTimeout(timeoutId);
					const elapsed = Date.now() - startTime;
					this.debugLog('[SearchTool] searchFiles 内容搜索完成，耗时:', elapsed, 'ms，匹配文件数:', new Set(Array.from(results.values()).map(r => r.filePath)).size);

					if (results.size === 0) {
						if (rawResults.size > 0) {
							return `未找到匹配正则表达式 "${regex}" 的可用结果（原始命中 ${rawResults.size} 条均位于噪音目录，已自动过滤）。\n\n📁 搜索路径: "${searchPath}"${file_pattern ? '\n📄 文件模式: ' + file_pattern : ''}\n\n💡 提示：如需搜索构建产物目录，请把 path 明确指向该目录后重试。`;
						}
						return `未找到匹配正则表达式 "${regex}" 的内容。\n\n📁 搜索路径: "${searchPath}"${file_pattern ? '\n📄 文件模式: ' + file_pattern : ''}\n\n💡 建议：\n1. 检查正则表达式语法是否正确\n2. 或使用 codebase_search 进行关键词搜索\n3. 或使用 glob 工具按文件名搜索`;
					}

					// 按文件分组
					const resultsByFile = new Map<string, { lineNumber: number; line: string }[]>();
					for (const { filePath, lineNumber, line } of results.values()) {
						if (!resultsByFile.has(filePath)) {
							resultsByFile.set(filePath, []);
						}
						resultsByFile.get(filePath)!.push({ lineNumber, line });
					}
					const sortedFiles = await this.sortFilesByMtime([...resultsByFile.keys()]);

					// count 模式：只返回统计
					if (outputMode === 'count') {
						return `${results.size} matches across ${resultsByFile.size} files`;
					}

					// files_with_matches 模式（默认）：只返回文件路径，大幅减少 token
					if (outputMode === 'files_with_matches') {
						const filePaths = sortedFiles.slice(offsetVal, offsetVal + headLimit);
						return filePaths.join('\n');
					}

					if (!isFilePath && !effectiveFilePattern && resultsByFile.size > this.MAX_CONTENT_OUTPUT_FILES) {
						const filePaths = sortedFiles.slice(0, headLimit);
						return `检测到 content 模式会跨 ${resultsByFile.size} 个文件返回大量内容，已自动降级为文件路径列表以避免主线程卡住。\n\n请先从这些候选文件中选择目标文件再 read_file：\n\n${filePaths.join('\n')}`;
					}

					// content 模式：返回完整内容（filePath:lineNumber: content）
					const allResults: string[] = [];
					for (const filePath of sortedFiles) {
						const fileResults = resultsByFile.get(filePath)!;
						for (const { lineNumber, line } of fileResults) {
							allResults.push(`${filePath}:${lineNumber}: ${this.truncatePreviewLine(line)}`);
						}
					}
					const contentLimit = Math.min(headLimit, this.MAX_CONTENT_OUTPUT_MATCHES);
					const paged = allResults.slice(offsetVal, offsetVal + contentLimit);
					return `找到 ${results.size} 个匹配 (显示 ${offsetVal + 1}-${offsetVal + paged.length} / ${allResults.length}):\n\n${paged.join('\n')}`;
				}

				// 只有 file_pattern，执行文件名搜索（QueryType.File）
				const includePattern = this.normalizeFilePattern(file_pattern) || '**/*';
				this.debugLog('[SearchTool] searchFiles 文件名搜索，路径:', folderPath, '模式:', includePattern);

				const excludePattern = this.getNoiseExcludePattern(searchPath);
				const result = await this.searchService.fileSearch({
					type: QueryType.File,
					filePattern: includePattern,
					excludePattern,
					folderQueries: [{ folder: folderUri }],
					maxResults: 500
				}, cts.token);

				clearTimeout(timeoutId);
				const elapsed = Date.now() - startTime;
				this.debugLog('[SearchTool] searchFiles 文件名搜索完成，耗时:', elapsed, 'ms，结果数:', result?.results?.length || 0);

				const allFilesRaw = result?.results?.map(r => r.resource.fsPath) ?? [];
				const allFiles = this.filterNoiseFilePaths(allFilesRaw, searchPath);

				if (allFiles.length === 0) {
					const dirExists = await this.checkDirectoryExists(searchPath);
					if (!dirExists) {
						return `未找到匹配的文件。\n\n📁 目录 "${searchPath}" 不存在。\n\n💡 建议：如果你需要创建文件，请逐步使用 write_to_file 创建，并在关键步骤后验证结果。`;
					} else {
						if (allFilesRaw.length > 0) {
							return `未找到匹配的文件（原始命中 ${allFilesRaw.length} 项均位于噪音目录，已自动过滤）。\n\n📁 搜索路径: "${searchPath}"\n📄 文件模式: "${includePattern}"\n\n💡 提示：如需搜索构建产物目录，请把 path 明确指向该目录后重试。`;
						}
						return `未找到匹配的文件。\n\n📁 目录 "${searchPath}" 存在但为空或没有匹配 "${includePattern}" 的文件。\n\n💡 建议：\n1. 检查目录路径是否正确\n2. 或使用 list_files 查看目录内容\n3. 或逐步创建所需文件并验证`;
					}
				}

				if (outputMode === 'count') {
					return `${allFiles.length} files`;
				}
				const paged = allFiles.slice(offsetVal, offsetVal + headLimit);
				return paged.join('\n');
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
		let { query, path, file_pattern, output_mode, head_limit, offset } = toolUse.params;

		if (!query) {
			return '错误: 未提供搜索查询';
		}

		const outputMode = (output_mode as 'content' | 'files_with_matches' | 'count') || 'files_with_matches';
		const headLimit = head_limit ? parseInt(head_limit, 10) : 100;
		const offsetVal = offset ? parseInt(offset, 10) : 0;

		// P1优化：清理query，移除AI错误传入的上下文标签
		const originalQuery = query;
		query = this.cleanSearchQuery(query);

		if (query !== originalQuery) {
			this.debugLog('[SearchTool] Query已清理，原始长度:', originalQuery.length, '清理后:', query.length);
		}

		const startTime = Date.now();
		// 将相对路径解析为绝对路径（避免使用 Node.js path 模块，兼容 browser/extension 环境）
		const rawPath = path || this.workspaceRoot;
		const searchPath = rawPath.startsWith('/')
			? rawPath
			: `${this.workspaceRoot.replace(/\/$/, '')}/${rawPath}`;

			const normalizedFilePattern = this.normalizeFilePattern(file_pattern);

			// P1优化：检查缓存
			const cacheKey = this.getCacheKey({
				query,
				path: searchPath,
				filePattern: normalizedFilePattern,
				outputMode,
				headLimit,
				offset: offsetVal
			});
			const cachedResult = this.getFromCache(cacheKey);
			if (cachedResult) {
				this.cacheHits++;
				this.debugLog(`[SearchTool] 使用缓存结果 (命中率: ${this.getCacheHitRate()}%)`);
				return cachedResult;
			}
			this.cacheMisses++;

			try {
				const folderUri = URI.file(searchPath);

				const includePattern: glob.IExpression | undefined = normalizedFilePattern
					? { [normalizedFilePattern]: true }
					: undefined;

			this.debugLog('[SearchTool] codebaseSearch 开始，查询:', query, '路径:', searchPath);

			// 创建可取消的 token（30秒超时，大型项目 ripgrep 需要时间）
			const cts = new CancellationTokenSource();
			const timeoutId = setTimeout(() => cts.cancel(), 30000);

			try {
				// 对齐 Claude Code / OpenCode：codebase_search 作为自然语言兜底搜索，不再在运行时二次拆词猜测。
				const searchStart = Date.now();
				const excludePattern = this.getNoiseExcludePattern(searchPath);
				const rawResults = await this.performTextSearchDirect(folderUri, query, includePattern, excludePattern, false, cts.token);
				const results = this.filterNoiseTextResults(rawResults, searchPath);
				const searchElapsed = Date.now() - searchStart;
				this.debugLog('[SearchTool] 直接搜索完成，耗时:', searchElapsed, 'ms，结果数:', results.size);

				clearTimeout(timeoutId);
				if (results.size === 0 && rawResults.size > 0) {
					return `未找到与 "${query}" 相关的可用结果（原始命中 ${rawResults.size} 条均位于噪音目录，已自动过滤）。\n\n建议：\n- 如需搜索构建产物目录，请把 path 明确指向该目录后重试\n- 或继续在源码目录内检索`;
				}
				const result = await this.formatSearchResults(query, results, startTime, outputMode, headLimit, offsetVal);
				if (results.size > 0) {
					this.setCache(cacheKey, result);
				}
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
	private async formatSearchResults(
		query: string,
		results: Map<string, { filePath: string; lineNumber: number; line: string }>,
		startTime: number,
		outputMode: 'content' | 'files_with_matches' | 'count',
		headLimit: number,
		offsetVal: number
	): Promise<string> {
		const elapsed = Date.now() - startTime;
		this.debugLog('[SearchTool] codebaseSearch 完成，总耗时:', elapsed, 'ms，最终结果:', results.size);

		if (results.size === 0) {
			return `未找到与 "${query}" 相关的结果。\n\n建议：\n- 尝试使用 glob 工具按文件名搜索\n- 尝试 search_files 进行正则表达式搜索`;
		}

		// 按文件分组结果
		const resultsByFile = new Map<string, { lineNumber: number; line: string }[]>();
		for (const { filePath, lineNumber, line } of results.values()) {
			if (!resultsByFile.has(filePath)) {
				resultsByFile.set(filePath, []);
			}
			resultsByFile.get(filePath)!.push({ lineNumber, line });
		}

		// 按 mtime 排序文件（最近修改的在前，参考 OpenCode grep.ts）
		const sortedFiles = await this.sortFilesByMtime([...resultsByFile.keys()]);

		if (outputMode === 'count') {
			return `${results.size} matches across ${resultsByFile.size} files`;
		}

		if (outputMode === 'files_with_matches') {
			const pagedFiles = sortedFiles.slice(offsetVal, offsetVal + headLimit);
			return pagedFiles.join('\n');
		}

		if (resultsByFile.size > this.MAX_CONTENT_OUTPUT_FILES) {
			const pagedFiles = sortedFiles.slice(0, headLimit);
			return `检测到语义搜索 content 模式会跨 ${resultsByFile.size} 个文件返回大量内容，已自动降级为文件路径列表以避免主线程卡住。\n\n请先选定候选文件再 read_file：\n\n${pagedFiles.join('\n')}`;
		}

		// 按文件 mtime 顺序展开结果
		const allResults: string[] = [];
		for (const filePath of sortedFiles) {
			const fileResults = resultsByFile.get(filePath)!;
			for (const { lineNumber, line } of fileResults) {
				allResults.push(`${filePath}:${lineNumber}: ${this.truncatePreviewLine(line)}`);
			}
		}

		const contentLimit = Math.min(headLimit, this.MAX_CONTENT_OUTPUT_MATCHES);
		const paged = allResults.slice(offsetVal, offsetVal + contentLimit);
		return `找到 ${results.size} 个匹配 (显示 ${offsetVal + 1}-${offsetVal + paged.length} / ${allResults.length}，耗时${elapsed}ms):\n\n${paged.join('\n')}`;
	}

	/**
	 * 按文件修改时间排序（最近修改的在前）
	 * 参考 OpenCode grep.ts / glob.ts 实现：files.sort((a, b) => b.mtime - a.mtime)
	 */
	private async sortFilesByMtime(filePaths: string[]): Promise<string[]> {
		try {
			const fsModule = await import('fs');
			const pathsWithMtime = await Promise.all(
				filePaths.map(async (filePath) => {
					try {
						const stat = await fsModule.promises.stat(filePath);
						return { path: filePath, mtime: stat.mtimeMs };
					} catch {
						return { path: filePath, mtime: 0 };
					}
				})
			);
			// mtime 降序：最近修改的文件优先（最相关）
			pathsWithMtime.sort((a, b) => b.mtime - a.mtime);
			return pathsWithMtime.map(p => p.path);
		} catch {
			// fs 不可用时（如纯浏览器环境）返回原始顺序
			return filePaths;
		}
	}

	/**
	 * 执行直接文本搜索（返回新的 Map）
	 */
	private async performTextSearchDirect(
		folderUri: URI,
		pattern: string,
		includePattern: glob.IExpression | undefined,
		excludePattern: glob.IExpression | undefined,
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
					excludePattern,
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
								const line = this.truncatePreviewLine(textResult.previewText);
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
			// 搜索被取消或失败（Canceled 大小写不敏感匹配）
			const msg = error instanceof Error ? error.message : String(error);
			if (!msg.toLowerCase().includes('cancel')) {
				console.warn('[SearchTool] 文本搜索失败:', error);
			}
		}

		return results;
	}

	/**
	 * F1: 列出代码定义名称（函数/类/接口/方法等）
	 *
	 * 使用正则解析，支持 TypeScript/JavaScript/Python/Java/Go/Rust/C/C++ 等常见语言。
	 * 对齐 Claude Code list_code_definition_names 功能，
	 * 帮助 AI 快速了解文件结构而无需读取完整内容（节省 5-20x Token）。
	 */
	async listCodeDefinitionNames(filePath: string): Promise<ToolResponse> {
		if (!filePath) {
			return '错误: 未提供文件路径';
		}

		const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(this.workspaceRoot, filePath);

		try {
			// 读取文件内容
			let text: string;
			if (this.fileService) {
				const uri = URI.file(absolutePath);
				const exists = await this.fileService.exists(uri);
				if (!exists) {
					return `错误: 文件不存在: ${absolutePath}`;
				}
				const content = await this.fileService.readFile(uri);
				text = content.value.toString();
			} else {
				return '错误: 文件服务未初始化';
			}

			const lines = text.split(/\r?\n/);
			const symbols: Array<{ line: number; kind: string; name: string }> = [];

			// 根据文件扩展名选择解析策略
			const ext = absolutePath.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? '';

			if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
				// TypeScript / JavaScript
				const patterns: Array<{ kind: string; regex: RegExp }> = [
					{ kind: 'class',     regex: /^(?:export\s+(?:default\s+)?|abstract\s+)?class\s+(\w+)/ },
					{ kind: 'interface', regex: /^(?:export\s+)?interface\s+(\w+)/ },
					{ kind: 'type',      regex: /^(?:export\s+)?type\s+(\w+)\s*[=<]/ },
					{ kind: 'enum',      regex: /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/ },
					{ kind: 'function',  regex: /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*(\w+)\s*[(<]/ },
					{ kind: 'function',  regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>)/ },
					{ kind: 'method',    regex: /^\s+(?:(?:public|private|protected|static|async|override|abstract)\s+)*(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/ },
					{ kind: 'decorator', regex: /^@(\w+)/ },
				];
				for (let i = 0; i < lines.length; i++) {
					const trimmed = lines[i].trimStart();
					for (const { kind, regex } of patterns) {
						const m = trimmed.match(regex);
						if (m && m[1] && m[1] !== 'if' && m[1] !== 'for' && m[1] !== 'while' && m[1] !== 'return') {
							symbols.push({ line: i + 1, kind, name: m[1] });
							break;
						}
					}
				}
			} else if (ext === 'py') {
				// Python
				for (let i = 0; i < lines.length; i++) {
					const m = lines[i].match(/^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/) ??
						lines[i].match(/^(\s*)class\s+(\w+)\s*[:(]/);
					if (m) {
						const indent = m[1].length;
						const kind = lines[i].match(/\bclass\b/) ? 'class' : 'function';
						symbols.push({ line: i + 1, kind: indent > 0 ? 'method' : kind, name: m[2] });
					}
				}
			} else if (['java', 'kt', 'scala'].includes(ext)) {
				// Java / Kotlin / Scala
				for (let i = 0; i < lines.length; i++) {
					const trimmed = lines[i].trimStart();
					const classM = trimmed.match(/(?:public|private|protected|internal|abstract|sealed|data|open|)?\s*(?:class|interface|enum|object|record)\s+(\w+)/);
					if (classM) { symbols.push({ line: i + 1, kind: 'class', name: classM[1] }); continue; }
					const methodM = trimmed.match(/(?:(?:public|private|protected|internal|static|final|override|suspend|abstract)\s+)*(?:fun|void|int|long|double|float|boolean|String|[A-Z]\w*)\s+(\w+)\s*\([^)]*\)/);
					if (methodM && methodM[1] && methodM[1] !== 'if' && methodM[1] !== 'for') {
						symbols.push({ line: i + 1, kind: 'method', name: methodM[1] });
					}
				}
			} else if (['go'].includes(ext)) {
				// Go
				for (let i = 0; i < lines.length; i++) {
					const funcM = lines[i].match(/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/);
					const typeM = lines[i].match(/^type\s+(\w+)\s+(?:struct|interface)/);
					if (funcM) { symbols.push({ line: i + 1, kind: 'function', name: funcM[1] }); }
					else if (typeM) { symbols.push({ line: i + 1, kind: 'type', name: typeM[1] }); }
				}
			} else if (['rs'].includes(ext)) {
				// Rust
				for (let i = 0; i < lines.length; i++) {
					const trimmed = lines[i].trimStart();
					const m = trimmed.match(/^(?:pub(?:\s*\(\w+\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*[<(]/) ??
						trimmed.match(/^(?:pub(?:\s*\(\w+\))?\s+)?(?:struct|enum|trait|impl|type)\s+(\w+)/);
					if (m) {
						const kind = trimmed.match(/\bfn\b/) ? 'function' :
							trimmed.match(/\bstruct\b/) ? 'struct' :
							trimmed.match(/\benum\b/) ? 'enum' :
							trimmed.match(/\btrait\b/) ? 'trait' :
							trimmed.match(/\bimpl\b/) ? 'impl' : 'type';
						symbols.push({ line: i + 1, kind, name: m[1] });
					}
				}
			} else if (['c', 'cpp', 'cc', 'cxx', 'h', 'hpp'].includes(ext)) {
				// C / C++
				for (let i = 0; i < lines.length; i++) {
					const trimmed = lines[i].trimStart();
					const classM = trimmed.match(/^(?:class|struct|namespace|enum)\s+(\w+)/);
					if (classM) { symbols.push({ line: i + 1, kind: 'class', name: classM[1] }); continue; }
					// 函数定义（返回值 + 函数名 + 括号，排除 if/for/while）
					const funcM = trimmed.match(/^(?:static\s+|inline\s+|virtual\s+|override\s+)?(?:[\w:*&<>]+\s+)+(\w+)\s*\([^;]*\)\s*(?:const\s*)?\{/);
					if (funcM && funcM[1] && !['if', 'for', 'while', 'switch', 'catch'].includes(funcM[1])) {
						symbols.push({ line: i + 1, kind: 'function', name: funcM[1] });
					}
				}
			} else {
				// 通用：提取常见模式（function/class/def）
				for (let i = 0; i < lines.length; i++) {
					const m = lines[i].match(/(?:function|class|def|func|fn|sub|procedure)\s+(\w+)/i);
					if (m) {
						symbols.push({ line: i + 1, kind: 'symbol', name: m[1] });
					}
				}
			}

			if (symbols.length === 0) {
				return `<definitions path="${absolutePath}">\n(未找到符号定义，文件可能不含顶层定义或不支持该语言)\n</definitions>`;
			}

			// 格式化输出（对齐 Claude Code 格式）
			const lines2 = symbols.map(s => `${s.line.toString().padStart(4)}: ${s.kind.padEnd(10)} ${s.name}`);
			return `<definitions path="${absolutePath}">\n${lines2.join('\n')}\n</definitions>`;

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

	// ========== P1优化：搜索缓存方法 ==========

	/**
	 * 生成缓存键
	 */
	private getCacheKey(params: {
		query: string;
		path: string;
		filePattern?: string;
		outputMode?: 'content' | 'files_with_matches' | 'count';
		headLimit?: number;
		offset?: number;
	}): string {
		return JSON.stringify({
			query: params.query,
			path: params.path,
			filePattern: params.filePattern || '',
			outputMode: params.outputMode || 'files_with_matches',
			headLimit: params.headLimit ?? 100,
			offset: params.offset ?? 0
		});
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
			timestamp: Date.now(),
			searchPath: this.extractSearchPathFromKey(key),
		});
	}

	private extractSearchPathFromKey(key: string): string {
		try {
			const parsed = JSON.parse(key);
			return typeof parsed?.path === 'string' ? parsed.path : '';
		} catch {
			return '';
		}
	}

	private normalizeComparablePath(rawPath: string): string {
		const trimmed = (rawPath || '').replace(/^file:\/\//, '').replace(/\/+$/, '');
		if (!trimmed) {
			return '';
		}
		return path.normalize(trimmed);
	}

	private isPathRelated(a: string, b: string): boolean {
		return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
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
		this.debugLog('[SearchTool] 搜索缓存已清除');
	}

	public invalidatePaths(paths: string[]): void {
		if (paths.length === 0) {
			return;
		}

		const normalizedPaths = paths
			.map(p => this.normalizeComparablePath(p))
			.filter(Boolean);
		const keysToDelete: string[] = [];

		for (const [key, entry] of this.searchCache.entries()) {
			const cachedPath = this.normalizeComparablePath(entry.searchPath);
			if (!cachedPath) {
				keysToDelete.push(key);
				continue;
			}

			const shouldInvalidate = normalizedPaths.some(affectedPath =>
				this.isPathRelated(affectedPath, cachedPath)
			);

			if (shouldInvalidate) {
				keysToDelete.push(key);
			}
		}

		for (const key of keysToDelete) {
			this.searchCache.delete(key);
		}
	}

	/**
	 * 检查目录是否存在
	 * 🔥 优化：用于在搜索返回0结果时，判断是"目录不存在"还是"目录为空"
	 * @param dirPath 目录路径
	 * @returns 目录是否存在
	 */
	private async checkDirectoryExists(dirPath: string): Promise<boolean> {
		try {
			const fs = await import('fs');
			const stats = await fs.promises.stat(dirPath);
			return stats.isDirectory();
		} catch (error) {
			// 如果stat失败（ENOENT等），说明目录不存在
			return false;
		}
	}
}
