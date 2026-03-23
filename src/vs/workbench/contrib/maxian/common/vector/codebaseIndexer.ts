/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 代码库索引器
 * 扫描项目文件，分 chunk，生成向量，存入 vectorStore
 * 支持增量更新（基于文件 mtime）
 */

import { EmbeddingService } from './embeddingService.js';
import { getVectorStore, CodeChunkMetadata } from './vectorStore.js';

/**
 * 索引进度回调
 */
export interface IndexProgress {
	total: number;
	indexed: number;
	currentFile: string;
	phase: 'scanning' | 'indexing' | 'done';
}

/**
 * 索引配置
 */
export interface IndexConfig {
	/** 最大 token 数（每个 chunk） */
	maxTokensPerChunk?: number;
	/** 进度回调 */
	onProgress?: (progress: IndexProgress) => void;
	/** 是否强制重建索引（忽略 mtime 缓存） */
	forceRebuild?: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_MAX_TOKENS = 500;

/**
 * 跳过的目录（不索引）
 */
const SKIP_DIRS = new Set([
	'node_modules',
	'.git',
	'.svn',
	'out',
	'dist',
	'build',
	'.next',
	'.nuxt',
	'__pycache__',
	'.cache',
	'.vscode',
	'.maxian',
	'coverage',
	'.nyc_output',
	'vendor',
	'.turbo',
	'.DS_Store',
]);

/**
 * 索引的文件扩展名
 */
const INDEXABLE_EXTENSIONS = new Set([
	'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
	'.py', '.java', '.go', '.rs', '.c', '.cpp', '.cc', '.h', '.hpp',
	'.cs', '.php', '.rb', '.swift', '.kt', '.scala',
	'.vue', '.svelte', '.astro',
	'.json', '.yaml', '.yml', '.toml',
	'.md', '.mdx',
	'.html', '.css', '.scss', '.less',
	'.sh', '.bash', '.zsh', '.fish',
	'.sql',
	'.graphql', '.gql',
]);

/**
 * 跳过的文件模式
 */
const SKIP_FILE_PATTERNS = [
	/\.min\.(js|css)$/,
	/\.bundle\.js$/,
	/\.chunk\.js$/,
	/\.map$/,
	/\.lock$/,
	/package-lock\.json$/,
	/yarn\.lock$/,
	/pnpm-lock\.yaml$/,
	/\.d\.ts$/,
	/CHANGELOG/i,
	/LICENSE/i,
];

/**
 * 最大文件大小（字节），超过此大小跳过
 */
const MAX_FILE_SIZE = 512 * 1024; // 512KB

/**
 * chunk 类型
 */
type ChunkType = 'function' | 'class' | 'block';

/**
 * 代码 chunk
 */
interface CodeChunk {
	code: string;
	startLine: number;
	endLine: number;
	chunkType: ChunkType;
}

/**
 * CodebaseIndexer: 扫描工作区并建立向量索引
 */
export class CodebaseIndexer {
	private readonly embeddingService: EmbeddingService;

	constructor() {
		this.embeddingService = EmbeddingService.getInstance();
	}

	/**
	 * 索引整个工作区
	 * @param cwd 工作区根目录
	 * @param config 索引配置
	 */
	async indexWorkspace(cwd: string, config: IndexConfig = {}): Promise<void> {
		const startTime = Date.now();
		console.log('[CodebaseIndexer] 开始索引工作区:', cwd);

		// 扫描所有可索引文件
		const files = await this.scanFiles(cwd);
		console.log('[CodebaseIndexer] 扫描到文件数:', files.length);

		const { onProgress, forceRebuild } = config;

		// 通知扫描完成
		if (onProgress) {
			onProgress({ total: files.length, indexed: 0, currentFile: '', phase: 'scanning' });
		}

		const vectorStore = getVectorStore(cwd);

		// 过滤出需要重新索引的文件
		const filesToIndex: Array<{ path: string; mtime: number }> = [];
		const fs = await import('fs');

		for (const filePath of files) {
			try {
				const stat = await fs.promises.stat(filePath);
				const mtime = stat.mtimeMs;

				if (forceRebuild) {
					filesToIndex.push({ path: filePath, mtime });
				} else {
					const isUpToDate = await vectorStore.isFileIndexed(filePath, mtime);
					if (!isUpToDate) {
						filesToIndex.push({ path: filePath, mtime });
					}
				}
			} catch {
				// 文件可能已删除，跳过
			}
		}

		console.log('[CodebaseIndexer] 需要索引的文件数:', filesToIndex.length);

		// 逐文件索引
		for (let i = 0; i < filesToIndex.length; i++) {
			const { path: filePath, mtime } = filesToIndex[i];

			if (onProgress) {
				onProgress({
					total: filesToIndex.length,
					indexed: i,
					currentFile: filePath,
					phase: 'indexing'
				});
			}

			try {
				await this.indexFile(filePath, cwd, mtime);
			} catch (error) {
				console.warn('[CodebaseIndexer] 索引文件失败:', filePath, error);
			}
		}

		const elapsed = Date.now() - startTime;
		console.log('[CodebaseIndexer] 工作区索引完成，耗时:', elapsed, 'ms，索引文件数:', filesToIndex.length);

		if (onProgress) {
			onProgress({
				total: filesToIndex.length,
				indexed: filesToIndex.length,
				currentFile: '',
				phase: 'done'
			});
		}
	}

	/**
	 * 索引单个文件
	 * @param filePath 文件绝对路径
	 * @param cwd 工作区根目录（用于获取 VectorStore）
	 * @param mtime 文件 mtime（可选，不传则自动读取）
	 */
	async indexFile(filePath: string, cwd: string, mtime?: number): Promise<void> {
		const fs = await import('fs');

		// 读取文件内容
		let content: string;
		let fileMtime = mtime;

		try {
			if (fileMtime === undefined) {
				const stat = await fs.promises.stat(filePath);
				fileMtime = stat.mtimeMs;
			}
			const buffer = await fs.promises.readFile(filePath);
			content = buffer.toString('utf-8');
		} catch (error) {
			console.warn('[CodebaseIndexer] 读取文件失败:', filePath, error);
			return;
		}

		// 分 chunk
		const chunks = this.splitIntoChunks(content, DEFAULT_MAX_TOKENS);

		if (chunks.length === 0) {
			return;
		}

		const vectorStore = getVectorStore(cwd);

		// 先删除该文件的旧索引
		await vectorStore.deleteFileItems(filePath);

		// 生成向量并批量写入
		const items: Array<{ id: string; vector: number[]; metadata: CodeChunkMetadata }> = [];

		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];
			try {
				const vector = await this.embeddingService.embed(chunk.code);
				const id = `${filePath}:${chunk.startLine}`;
				const metadata: CodeChunkMetadata = {
					filePath,
					code: chunk.code.slice(0, 1000), // 存储最多 1000 字符用于展示
					startLine: chunk.startLine,
					endLine: chunk.endLine,
					chunkType: chunk.chunkType,
					mtime: fileMtime!,
				};
				items.push({ id, vector, metadata });
			} catch (error) {
				console.warn('[CodebaseIndexer] 向量化 chunk 失败:', filePath, chunk.startLine, error);
			}
		}

		if (items.length > 0) {
			await vectorStore.batchUpsert(items);
		}
	}

	/**
	 * 扫描工作区中所有可索引文件
	 * @param cwd 工作区根目录
	 * @returns 文件绝对路径列表
	 */
	async scanFiles(cwd: string): Promise<string[]> {
		const files: string[] = [];
		await this.walkDir(cwd, cwd, files);
		return files;
	}

	/**
	 * 递归遍历目录
	 */
	private async walkDir(dir: string, cwd: string, files: string[]): Promise<void> {
		const fs = await import('fs');
		const path = await import('path');

		let entries: import('fs').Dirent[];
		try {
			entries = await fs.promises.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				// 跳过特定目录
				if (SKIP_DIRS.has(entry.name)) {
					continue;
				}
				// 跳过以 . 开头的隐藏目录（除了 .maxian 已在 SKIP_DIRS 中）
				if (entry.name.startsWith('.')) {
					continue;
				}
				await this.walkDir(fullPath, cwd, files);
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name).toLowerCase();
				if (!INDEXABLE_EXTENSIONS.has(ext)) {
					continue;
				}

				// 检查跳过模式
				const shouldSkip = SKIP_FILE_PATTERNS.some(pattern => pattern.test(entry.name));
				if (shouldSkip) {
					continue;
				}

				// 检查文件大小
				try {
					const stat = await fs.promises.stat(fullPath);
					if (stat.size > MAX_FILE_SIZE) {
						continue;
					}
					files.push(fullPath);
				} catch {
					// 忽略
				}
			}
		}
	}

	/**
	 * 将代码文件内容分割为 chunk
	 * 优先按函数/类边界分割，必要时按行数分割
	 * @param content 文件内容
	 * @param maxTokens 每个 chunk 的最大 token 数（简单按字符估算：1 token ≈ 4 字符）
	 * @returns chunk 列表
	 */
	splitIntoChunks(content: string, maxTokens: number = DEFAULT_MAX_TOKENS): CodeChunk[] {
		const maxChars = maxTokens * 4; // 1 token ≈ 4 字符
		const lines = content.split('\n');

		if (lines.length === 0) {
			return [];
		}

		// 尝试按语义边界（函数、类）分割
		const semanticChunks = this.splitBySemantic(lines, maxChars);

		if (semanticChunks.length > 0) {
			return semanticChunks;
		}

		// Fallback: 按行数分割（每 chunk 约 50 行）
		return this.splitByLines(lines, maxChars);
	}

	/**
	 * 按语义边界分割（函数、类）
	 */
	private splitBySemantic(lines: string[], maxChars: number): CodeChunk[] {
		const chunks: CodeChunk[] = [];
		let currentChunkLines: string[] = [];
		let currentStartLine = 1;
		let braceDepth = 0;
		let inChunk = false;
		let chunkType: ChunkType = 'block';

		// 函数/类开始的模式
		const functionPattern = /^\s*(async\s+)?function\s+\w+|^\s*(export\s+)?(default\s+)?(async\s+)?function\s+\w+|^\s*(public|private|protected|static|async|\s)*(function\s+\w+|\w+\s*\()/;
		const classPattern = /^\s*(export\s+)?(default\s+)?class\s+\w+/;
		const arrowFunctionPattern = /^\s*(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s+)?(\([^)]*\)|[\w]+)\s*=>/;

		const isStartOfBlock = (line: string): { isStart: boolean; type: ChunkType } => {
			if (classPattern.test(line)) {
				return { isStart: true, type: 'class' };
			}
			if (functionPattern.test(line) || arrowFunctionPattern.test(line)) {
				return { isStart: true, type: 'function' };
			}
			return { isStart: false, type: 'block' };
		};

		const flushChunk = (endLine: number) => {
			if (currentChunkLines.length === 0) {
				return;
			}
			const code = currentChunkLines.join('\n').trim();
			if (code.length < 20) {
				// 太短的 chunk 忽略
				return;
			}
			// 如果 chunk 太长，进一步分割
			if (code.length > maxChars) {
				const subLines = currentChunkLines;
				const subChunks = this.splitByLines(subLines, maxChars, currentStartLine);
				chunks.push(...subChunks);
			} else {
				chunks.push({
					code,
					startLine: currentStartLine,
					endLine,
					chunkType,
				});
			}
		};

		for (let i = 0; i < lines.length; i++) {
			const lineNum = i + 1;
			const line = lines[i];

			if (!inChunk) {
				const { isStart, type } = isStartOfBlock(line);
				if (isStart) {
					inChunk = true;
					chunkType = type;
					currentStartLine = lineNum;
					currentChunkLines = [line];
					// 计算花括号深度
					const opens = (line.match(/{/g) || []).length;
					const closes = (line.match(/}/g) || []).length;
					braceDepth = opens - closes;
				} else {
					// 非函数/类代码，积累为 block chunk
					currentChunkLines.push(line);
					const currentCode = currentChunkLines.join('\n').trim();
					if (currentCode.length > maxChars) {
						// 当前 block 已经足够大，flush 出去
						flushChunk(lineNum - 1);
						currentChunkLines = [];
						currentStartLine = lineNum;
					}
				}
			} else {
				currentChunkLines.push(line);
				const opens = (line.match(/{/g) || []).length;
				const closes = (line.match(/}/g) || []).length;
				braceDepth += opens - closes;

				// 如果花括号深度回到 0，说明函数/类结束了
				if (braceDepth <= 0) {
					flushChunk(lineNum);
					currentChunkLines = [];
					currentStartLine = lineNum + 1;
					braceDepth = 0;
					inChunk = false;
					chunkType = 'block';
				}
			}
		}

		// flush 剩余内容
		if (currentChunkLines.length > 0) {
			flushChunk(lines.length);
		}

		return chunks;
	}

	/**
	 * 按行数分割
	 * @param lines 行数组
	 * @param maxChars 最大字符数
	 * @param startLineOffset 起始行号偏移（默认 1）
	 */
	private splitByLines(lines: string[], maxChars: number, startLineOffset: number = 1): CodeChunk[] {
		const chunks: CodeChunk[] = [];
		const linesPerChunk = Math.max(10, Math.floor(maxChars / 80)); // 估计每行 80 字符

		let i = 0;
		while (i < lines.length) {
			const chunkLines = lines.slice(i, i + linesPerChunk);
			const code = chunkLines.join('\n').trim();
			if (code.length >= 20) {
				chunks.push({
					code,
					startLine: startLineOffset + i,
					endLine: startLineOffset + i + chunkLines.length - 1,
					chunkType: 'block',
				});
			}
			i += linesPerChunk;
		}

		return chunks;
	}
}
