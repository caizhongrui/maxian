/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileService } from '../../../../../platform/files/common/files.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ReadFileToolUse, WriteToFileToolUse, ListFilesToolUse, GlobToolUse, ApplyDiffToolUse, ToolResponse, ToolUse } from '../../common/tools/toolTypes.js';
import * as glob from '../../../../../base/common/glob.js';
import { MultiSearchReplaceDiffStrategy } from '../../common/diff/MultiSearchReplaceDiffStrategy.js';
import { addLineNumbers, stripLineNumbers, everyLineHasLineNumbers } from '../../common/utils/lineNumbers.js';
import { normalizeString } from '../../common/utils/textNormalization.js';
import * as path from '../../../../../base/common/path.js';
import { trackFileRead, assertFileWritable, withFileLock, updateFileAfterWrite } from '../../common/file/fileTimeTracker.js';
import { FileStateCache, FILE_UNCHANGED_STUB } from '../../common/file/fileStateCache.js';
import { isLikelyNoisePath, shouldApplyNoiseFiltering } from '../../common/services/globConstants.js';

interface PreparedWriteToFile {
	absolutePath: string;
	exists: boolean;
	processedContent: string;
	actualLineCount: number;
	predictedLineCount?: number;
}

type FileWriteVisibility = 'full' | 'derived' | 'internal';

/**
 * apply_diff 工具专用错误类
 * 抛出此错误 → TaskService catch → is_error: true → Qwen 知道真正失败，停止重试
 */
export class DiffApplicationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DiffApplicationError';
	}
}

/**
 * 检测文件是否为二进制文件（基于扩展名）
 * 注意：这是一个简化的实现，仅用于浏览器环境
 */
function isBinaryFileByExtension(filePath: string): boolean {
	const binaryExtensions = [
		// Images
		'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg',
		// Archives
		'zip', 'tar', 'gz', 'rar', '7z', 'bz2',
		// Executables
		'exe', 'dll', 'so', 'dylib', 'bin',
		// Documents
		'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
		// Media
		'mp3', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'wav',
		// Fonts
		'ttf', 'otf', 'woff', 'woff2', 'eot',
		// Others
		'pyc', 'class', 'o', 'obj', 'a', 'lib'
	];

	const extMatch = filePath.match(/\.([^.]+)$/);
	const extension = extMatch ? extMatch[1].toLowerCase() : '';

	return binaryExtensions.includes(extension);
}

/**
 * 解析并应用 git unified diff 格式
 * 支持 @@ -X,Y +X,Y @@ hunk 格式
 * @returns 应用后的新内容，如果不是git diff格式则返回 null
 */
function applyGitUnifiedDiff(originalContent: string, diff: string): string | null {
	// 检测是否为git unified diff格式（含有 @@ -数字 ... @@ 的hunk头）
	if (!/^@@[ \t]+-\d+/m.test(diff)) {
		return null;
	}

	const resultLines = originalContent.split('\n');
	const diffLines = diff.split('\n');
	let i = 0;
	let lineOffset = 0; // 累积行偏移（前面hunk的增删差值）

	// 跳过文件头行（--- a/...  +++ b/...  diff --git ...  index ...）
	while (i < diffLines.length &&
		(diffLines[i].startsWith('--- ') || diffLines[i].startsWith('+++ ') ||
		diffLines[i].startsWith('diff ') || diffLines[i].startsWith('index '))) {
		i++;
	}

	while (i < diffLines.length) {
		// 解析 hunk 头：@@ -origStart,origCount +newStart,newCount @@
		const hunkMatch = diffLines[i].match(/^@@[ \t]+-([\d]+)(?:,([\d]+))?[ \t]\+([\d]+)(?:,([\d]+))?[ \t]@@/);
		if (!hunkMatch) {
			i++;
			continue;
		}

		const origStart = parseInt(hunkMatch[1]) - 1; // 转为 0-based 索引
		const origCount = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2]) : 1;
		i++; // 跳过 hunk 头

		// 从 hunk 行中提取新内容（context 行 + added 行）
		const insertLines: string[] = [];
		while (i < diffLines.length && !diffLines[i].match(/^@@[ \t]+-\d+/)) {
			const line = diffLines[i];
			if (line.startsWith('+')) {
				insertLines.push(line.substring(1));
			} else if (line.startsWith('-')) {
				// 删除的行，不加入 insertLines
			} else if (line.startsWith(' ')) {
				insertLines.push(line.substring(1)); // 上下文行
			} else if (line.startsWith('\\\\')) {
				// \\ No newline at end of file，忽略
			}
			i++;
		}

		// 将 resultLines 中从 startInResult 开始的 origCount 行替换为 insertLines
		const startInResult = origStart + lineOffset;
		resultLines.splice(startInResult, origCount, ...insertLines);
		lineOffset += insertLines.length - origCount;
	}

	return resultLines.join('\n');
}

/**
 * 文件操作工具类
 * 实现文件读取、写入、列表等功能
 */
export class FileOperationsTool {
	private readonly diffStrategy: MultiSearchReplaceDiffStrategy;
	private sessionId: string;
	/** D2: 文件内容内存缓存，读后写后均更新，避免重复磁盘 IO */
	private readonly fileStateCache: FileStateCache;

	constructor(
		private readonly fileService: IFileService,
		private readonly workspaceRoot: string = '',
		sessionId?: string,
		_modelService?: IModelService,
		fileStateCache?: FileStateCache,
		private readonly textFileService?: import('../../../../services/textfile/common/textfiles.js').ITextFileService
	) {
		// 初始化Diff策略（完整Kilocode实现）
		this.diffStrategy = new MultiSearchReplaceDiffStrategy(0.9, 40); // 90%匹配阈值，40行缓冲（对齐 OpenCode 容错策略）
		// P1-8: 会话ID用于文件时间戳追踪
		this.sessionId = sessionId || 'default';
		// D2: 内存缓存（外部注入或自建，跨工具共享）
		this.fileStateCache = fileStateCache ?? new FileStateCache();
	}

	/**
	 * 更新会话ID
	 */
	setSessionId(sessionId: string): void {
		this.sessionId = sessionId;
	}

	/**
	 * 写入文件并同步刷新可能打开的编辑器模型。
	 * 避免：fileService.writeFile 直接改盘，而编辑器模型仍持有旧内容（tab 显示未保存 ●）
	 */
	private async writeFileAndSyncEditor(uri: import('../../../../../base/common/uri.js').URI, buffer: import('../../../../../base/common/buffer.js').VSBuffer): Promise<void> {
		await this.fileService.writeFile(uri, buffer);
		// 若文件在编辑器中已打开（textFileService 持有 working copy），
		// 调用 revert 让它从磁盘重新加载 → 清除 dirty 标记
		try {
			const wc = this.textFileService?.files?.get(uri);
			if (wc) {
				await wc.revert({ force: true });
			}
		} catch { /* 编辑器未打开或 revert 失败都不阻塞工具结果 */ }
	}

	/**
	 * 解析路径（统一路径处理）
	 * 模仿 Kilocode 的实现：使用 path.resolve(cwd, relPath)
	 * @param inputPath 输入的路径（可能是相对路径或绝对路径）
	 * @returns 绝对路径
	 */
	public resolveFilePath(inputPath: string): string {
		if (!inputPath) {
			return this.workspaceRoot;
		}

		// 使用 path.resolve
		// - 如果 inputPath 是绝对路径，会直接返回
		// - 如果 inputPath 是相对路径，会相对于 workspaceRoot 解析
		return path.resolve(this.workspaceRoot, inputPath);
	}

	private resolveWriteVisibility(toolUse: WriteToFileToolUse): FileWriteVisibility {
		const explicitVisibility = (toolUse.params as any).write_visibility;
		if (explicitVisibility === 'full' || explicitVisibility === 'derived' || explicitVisibility === 'internal') {
			return explicitVisibility;
		}

		const legacyModelVisible = (toolUse.params as any).model_visible !== false && (toolUse.params as any).model_visible !== 'false';
		return legacyModelVisible ? 'full' : 'derived';
	}

	private recordWrittenFileState(
		absolutePath: string,
		content: string,
		mtime: number,
		size: number,
		visibility: FileWriteVisibility
	): void {
		const entry = { content, mtime, size };
		switch (visibility) {
			case 'full':
				this.fileStateCache.recordWrite(absolutePath, entry, true);
				return;
			case 'derived':
				this.fileStateCache.recordWrite(absolutePath, entry, 'derived');
				return;
			case 'internal':
				this.fileStateCache.recordInternalRefresh(absolutePath, entry);
				return;
		}
	}

	private async getPathSuggestions(targetPath: string, maxSuggestions: number = 3): Promise<string[]> {
		const suggestions = new Set<string>();

		for (const suggestion of await this.getSimilarFiles(targetPath, maxSuggestions)) {
			suggestions.add(suggestion);
		}

		for (const suggestion of await this.getSimilarPathVariants(targetPath, maxSuggestions)) {
			suggestions.add(suggestion);
		}

		return Array.from(suggestions).slice(0, maxSuggestions);
	}

	/**
	 * 读取文件内容（增强版）
	 * 支持：行范围、行号、二进制检测、大文件限制
	 * @param toolUse 读取文件工具使用信息
	 * @returns 文件内容
	 */
	async readFile(toolUse: ReadFileToolUse): Promise<ToolResponse> {
		const { path, start_line, end_line } = toolUse.params;

		if (!path) {
			return '错误: 未提供文件路径';
		}

		// 使用统一的路径解析（模仿 Kilocode）
		const absolutePath = this.resolveFilePath(path);

		try {
			const uri = URI.file(absolutePath);

			// 检查文件是否存在
			const exists = await this.fileService.exists(uri);
			if (!exists) {
				const suggestions = await this.getPathSuggestions(absolutePath);
				if (suggestions.length > 0) {
					return `错误: 文件不存在\n路径: ${absolutePath}\n\n你是否要找:\n${suggestions.map(s => `  - ${s}`).join('\n')}`;
				}
				return `错误: 文件不存在\n路径: ${absolutePath}`;
			}

			// 检查是否为二进制文件（基于扩展名）
			const isBinary = isBinaryFileByExtension(absolutePath);
			if (isBinary) {
				// 获取文件扩展名
				const extMatch = absolutePath.match(/\.([^.]+)$/);
				const extension = extMatch ? extMatch[1] : 'unknown';

				// 常见的可读取二进制格式
				const readableBinaryFormats = ['pdf', 'docx', 'ipynb', 'png', 'jpg', 'jpeg', 'gif', 'webp'];

				if (readableBinaryFormats.includes(extension.toLowerCase())) {
					return `<binary_file format="${extension}">\n提示: 这是一个 ${extension.toUpperCase()} 文件。\n当前版本暂不支持直接读取此格式的内容。\n</binary_file>`;
				} else {
					return `<binary_file format="${extension}">\n二进制文件 - 无法显示内容\n</binary_file>`;
				}
			}

			// D2/B3: 全量读取时，只有“模型已看过当前版本全文”才允许返回 FILE_UNCHANGED_STUB
			const isPartialRead = start_line !== undefined || end_line !== undefined;
			const cached = this.fileStateCache.get(absolutePath);
			if (cached) {
				try {
					const statForCache = await this.fileService.resolve(uri);
					const diskMtime = statForCache.mtime ?? 0;
					const diskSize = statForCache.size ?? 0;
					if (this.fileStateCache.isFresh(absolutePath, diskMtime, diskSize)) {
						if (!isPartialRead) {
							if (this.fileStateCache.shouldReturnUnchangedStub(absolutePath, diskMtime, diskSize)) {
								return FILE_UNCHANGED_STUB;
							}

							this.fileStateCache.recordFullModelRead(absolutePath, {
								content: cached.content,
								mtime: diskMtime,
								size: diskSize,
							});
							return this.formatFullFileContent(absolutePath, cached.content);
						}

						const partialFromCache = this.formatPartialFileContent(absolutePath, cached.content, start_line, end_line);
						if (partialFromCache) {
							const cachedLines = cached.content.split(/\r?\n/);
							if (cachedLines.length > 0 && cachedLines[cachedLines.length - 1] === '' && cached.content.endsWith('\n')) {
								cachedLines.pop();
							}
							const totalLines = cachedLines.length;
							const startIdx = start_line ? Math.max(0, parseInt(start_line, 10) - 1) : 0;
							const endIdx = end_line ? Math.min(totalLines, parseInt(end_line, 10)) : totalLines;
							this.fileStateCache.recordPartialModelRead(absolutePath, {
								content: cached.content,
								mtime: diskMtime,
								size: diskSize,
							}, {
								startLine: startIdx + 1,
								endLine: endIdx,
							});
							return partialFromCache;
						}
					}
				} catch {
					// stat 失败，降级到正常磁盘读取
				}
			}

			// 读取文本文件内容（走磁盘）
			const content = await this.fileService.readFile(uri);
			const text = content.value.toString();
			const allLines = text.split(/\r?\n/);

			// P1-8 + D2: 记录文件读取时间戳，同时更新内存缓存
			let cachedMtime = Date.now();
			let cachedSize = text.length;
			try {
				const stat = await this.fileService.resolve(uri);
				cachedMtime = stat.mtime ?? Date.now();
				cachedSize = stat.size ?? text.length;
				trackFileRead(this.sessionId, absolutePath, cachedMtime, cachedSize);
			} catch (e) {
				// 忽略 stat 失败，不影响读取
				console.warn(`[FileOperations] 获取文件 stat 失败: ${absolutePath}`, e);
			}
			if (isPartialRead) {
				const allVisibleLines = text.split(/\r?\n/);
				if (allVisibleLines.length > 0 && allVisibleLines[allVisibleLines.length - 1] === '' && text.endsWith('\n')) {
					allVisibleLines.pop();
				}
				const totalLines = allVisibleLines.length;
				const startIdx = start_line ? Math.max(0, parseInt(start_line, 10) - 1) : 0;
				const endIdx = end_line ? Math.min(totalLines, parseInt(end_line, 10)) : totalLines;
				this.fileStateCache.recordPartialModelRead(absolutePath, {
					content: text,
					mtime: cachedMtime,
					size: cachedSize,
				}, {
					startLine: startIdx + 1,
					endLine: endIdx,
				});
			} else {
				this.fileStateCache.recordFullModelRead(absolutePath, {
					content: text,
					mtime: cachedMtime,
					size: cachedSize,
				});
			}

			// 如果文件末尾有换行符，split会产生一个空字符串，需要移除
			if (allLines.length > 0 && allLines[allLines.length - 1] === '' && text.endsWith('\n')) {
				allLines.pop();
			}

			const totalLines = allLines.length;

			// P2优化：使用绝对路径（对齐 OpenCode read.ts，AI 可明确知道文件位置）
			const displayPath = absolutePath;

			// 处理行范围读取
			if (start_line !== undefined || end_line !== undefined) {
				const partialContent = this.formatPartialFileContent(displayPath, text, start_line, end_line);
				if (!partialContent) {
					const startIdx = start_line ? Math.max(0, parseInt(start_line, 10) - 1) : 0;
					if (startIdx >= totalLines) {
						return `错误: 起始行 ${start_line} 超出文件范围（文件共 ${totalLines} 行）`;
					}
					return '错误: 起始行不能大于结束行';
				}
				return partialContent;
			}

			// 大文件限制（对齐OpenCode的2000行限制，减少token消耗）
			const maxLines = 2000;
			const maxBytesPerFile = 50 * 1024; // 50KB
			const maxLineLength = 2000; // 每行最多 2000 字符

			// 每行字符截断（防止超长单行占满上下文）
			const processedLines = allLines.map(line => {
				if (line.length > maxLineLength) {
					return line.substring(0, maxLineLength) + `... (行截断，共 ${line.length} 字符)`;
				}
				return line;
			});

			if (totalLines > maxLines) {
				const truncatedLines = processedLines.slice(0, maxLines);
				const numberedContent = addLineNumbers(truncatedLines.join('\n'), 1);

				return `<file path="${displayPath}">\n<content lines="1-${maxLines}">\n${numberedContent}</content>\n<notice>文件共 ${totalLines} 行，仅显示前 ${maxLines} 行。使用 start_line 和 end_line 参数读取其他部分。</notice>\n</file>`;
			}

			// 50KB 字节限制
			let byteCount = 0;
			let truncatedByBytes = false;
			const byteLines: string[] = [];
			for (const line of processedLines) {
				const lineBytes = estimateFileByteLengthForRead(line) + 1; // +1 换行
				if (byteCount + lineBytes > maxBytesPerFile) {
					truncatedByBytes = true;
					break;
				}
				byteLines.push(line);
				byteCount += lineBytes;
			}

			if (truncatedByBytes) {
				const shownLines = byteLines.length;
				const numberedContent = addLineNumbers(byteLines.join('\n'), 1);
				return `<file path="${displayPath}">\n<content lines="1-${shownLines}">\n${numberedContent}</content>\n<notice>文件内容较大（超过50KB），仅显示前 ${shownLines} 行（共 ${totalLines} 行）。使用 start_line 参数读取后续内容。</notice>\n</file>`;
			}

			return this.formatFullFileContent(displayPath, processedLines.join('\n'));

		} catch (error) {
			return `错误: 读取文件失败\n路径: ${absolutePath}\n详情: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * 写入文件内容（增强版）
	 * 支持：目录自动创建、内容预处理、代码省略检测、行数验证
	 * @param toolUse 写入文件工具使用信息
	 * @returns 执行结果
	 */
	async writeToFile(toolUse: WriteToFileToolUse): Promise<ToolResponse> {
		const writeVisibility = this.resolveWriteVisibility(toolUse);
		const fallbackPath = toolUse.params.path ? this.resolveFilePath(toolUse.params.path) : '(unknown)';

		try {
			const prepared = await this.prepareWriteToFile(toolUse);
			if ('error' in prepared) {
				return prepared.error;
			}
			const { absolutePath, exists, processedContent, actualLineCount } = prepared;
			const uri = URI.file(absolutePath);

			// 写入文件（使用文件锁确保串行写入）
			const buffer = VSBuffer.fromString(processedContent);

			return await withFileLock(absolutePath, async () => {
				try {
					if (exists) {
						// 文件存在，更新内容
						// 写盘 + revert 已打开模型（避免 setValue 污染 dirty 状态）
						await this.writeFileAndSyncEditor(uri, buffer);
					} else {
						// 文件不存在，创建新文件（包括目录）
						await this.fileService.createFile(uri, buffer, { overwrite: false });
					}
				} catch (writeError) {
					const writeMsg = writeError instanceof Error ? writeError.message : String(writeError);
					const writeCode = (writeError as any)?.code || '';
					const isPermErr =
						writeCode === 'EPERM' || writeCode === 'EACCES' || writeCode === 'EROFS' ||
						writeMsg.toLowerCase().includes('permission denied') ||
						writeMsg.toLowerCase().includes('access denied') ||
						writeMsg.toLowerCase().includes('operation not permitted') ||
						writeMsg.toLowerCase().includes('拒绝访问') ||
						writeMsg.toLowerCase().includes('access is denied');

					if (isPermErr) {
						throw Object.assign(new Error(writeMsg), { code: writeCode, isPermissionError: true });
					}
					throw writeError;
				}

				// P1-8 + D2: 写入后更新时间戳记录并刷新内存缓存
				try {
					const newStat = await this.fileService.resolve(uri);
					const newMtime = newStat.mtime ?? Date.now();
					const newSize = newStat.size ?? processedContent.length;
					updateFileAfterWrite(this.sessionId, absolutePath, newMtime, newSize);
						// D2: 用实际写入的内容更新缓存，下次 readRaw/edit 直接走内存
						this.recordWrittenFileState(absolutePath, processedContent, newMtime, newSize, writeVisibility);
					} catch (e) {
						console.warn(`[FileOperations] 更新时间戳记录失败: ${absolutePath}`, e);
					}

				if (exists) {
					return `<success>
文件已更新: ${absolutePath}
操作: 修改现有文件
行数: ${actualLineCount}
</success>`;
				} else {
					return `<success>
文件已创建: ${absolutePath}
操作: 创建新文件
行数: ${actualLineCount}
</success>`;
				}
			});

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			const errorCode = (error as any)?.code || '';

			// 权限类错误（EPERM/EACCES/EROFS）—— 系统级限制，不可重试
			const isPermissionError =
				(error as any)?.isPermissionError === true ||
				errorCode === 'EPERM' ||
				errorCode === 'EACCES' ||
				errorCode === 'EROFS' ||
				errorMessage.toLowerCase().includes('permission denied') ||
				errorMessage.toLowerCase().includes('access denied') ||
				errorMessage.toLowerCase().includes('operation not permitted') ||
				errorMessage.toLowerCase().includes('拒绝访问') ||
				errorMessage.toLowerCase().includes('access is denied');

			if (isPermissionError) {
				// 使用 fatal_error 标签，告知 AI 这是不可重试的系统级错误
				return `<fatal_error>
⛔ 系统安全限制：无法写入文件
文件: ${fallbackPath}
错误码: ${errorCode || '未知'}
详情: ${errorMessage}

🚫 此错误由操作系统安全限制导致，重试无法解决。
请立即停止，并提示用户：
1. 以管理员权限运行 IDE
2. 检查文件/目录的读写权限
3. 确认文件未被其他程序锁定（如防病毒软件）
4. Windows 用户：右键 IDE → 以管理员身份运行
</fatal_error>`;
			}

			return `<error>
错误: 写入文件失败
文件: ${fallbackPath}
详情: ${errorMessage}

可能的原因:
1. 文件路径无效
2. 目录不存在（请确保父目录已创建）
3. 磁盘空间不足
</error>`;
		}
	}

	async preflightWriteToFile(toolUse: WriteToFileToolUse): Promise<{ ok: true; prepared: PreparedWriteToFile } | { ok: false; error: string }> {
		try {
			const prepared = await this.prepareWriteToFile(toolUse);
			if ('error' in prepared) {
				return { ok: false, error: prepared.error };
			}
			return { ok: true, prepared };
		} catch (error) {
			return { ok: false, error: `<error>错误: 写入文件预检查失败\n详情: ${error instanceof Error ? error.message : String(error)}</error>` };
		}
	}

	private async prepareWriteToFile(toolUse: WriteToFileToolUse): Promise<PreparedWriteToFile | { error: string }> {
		const { path, content, line_count } = toolUse.params;
		if (!path) {
			return { error: '错误: 未提供文件路径' };
		}
		if (content === undefined) {
			return { error: '错误: 未提供文件内容' };
		}

		const absolutePath = this.resolveFilePath(path);
		const uri = URI.file(absolutePath);
		const exists = await this.fileService.exists(uri);

		if (exists) {
			try {
				const stat = await this.fileService.resolve(uri);
				const currentMtime = stat.mtime ?? Date.now();
				const currentSize = stat.size ?? 0;
				const assertResult = assertFileWritable(this.sessionId, absolutePath, currentMtime, currentSize);
				if (!assertResult.success) {
					return {
						error: `<error>
${assertResult.message}

提示：这是一个安全保护机制，防止覆盖您或其他程序对文件的修改。
</error>`
					};
				}
			} catch (e) {
				console.warn(`[FileOperations] 时间戳校验失败: ${absolutePath}`, e);
			}
		}

		const processedContent = this.normalizeWriteContent(content);
		const actualLineCount = processedContent.split('\n').length;
		const predictedLineCount = line_count ? parseInt(line_count, 10) : undefined;
		let currentContent: string | null = null;
		let currentFileIsBlank = false;

		// 已存在文件且内容完全一致：直接拒绝无效写入，避免重复回路
		if (exists) {
			try {
				const currentFile = await this.fileService.readFile(uri);
				currentContent = currentFile.value.toString();
				currentFileIsBlank = currentContent.trim().length === 0;
				if (processedContent.trim().length === 0 && currentContent.trim().length > 0) {
					return {
						error: `<error>
write_to_file 安全拦截：不允许通过空内容覆盖已存在文件
文件: ${absolutePath}

这通常是“误把删除操作写成清空文件”。
请改用 delete_file 删除文件；如需保留文件并清空内容，请用 edit 明确表达该意图。
</error>`
					};
				}
				if (currentContent === processedContent) {
					return {
						error: `<error>
write_to_file 未产生任何修改：目标文件内容与待写入内容完全一致
文件: ${absolutePath}

请不要重复写入相同内容。
如果目标已完成，请直接 attempt_completion；
如果仅需局部修改，请改用 edit / multiedit。
</error>`
					};
				}
			} catch (e) {
				console.warn(`[FileOperations] 读取当前文件内容用于无效写入检查失败: ${absolutePath}`, e);
			}
		}

		const omissionError = this.getWriteOmissionError(absolutePath, processedContent, actualLineCount, predictedLineCount);
		if (omissionError) {
			return { error: omissionError };
		}

		// 行数硬校验已移除：模型自报 line_count 不可靠（文件 >100 行时极易数错），
		// 真正能防内容被截断的是上面 getWriteOmissionError 里的 "// rest of code" 模式检测。
		// 仅当 currentFileIsBlank 时仍保留 warn 日志，便于排查异常空写。
		if (predictedLineCount && !Number.isNaN(predictedLineCount) && Math.abs(actualLineCount - predictedLineCount) > 5 && exists && currentFileIsBlank) {
			console.warn(`[FileOperations] 空文件行数差异: ${absolutePath}, actual=${actualLineCount}, predicted=${predictedLineCount}`);
		}

		return {
			absolutePath,
			exists,
			processedContent,
			actualLineCount,
			predictedLineCount,
		};
	}

	private normalizeWriteContent(content: string): string {
		let processedContent = content;
		if (processedContent.startsWith('```')) {
			processedContent = processedContent.split('\n').slice(1).join('\n');
		}
		if (processedContent.endsWith('```')) {
			processedContent = processedContent.split('\n').slice(0, -1).join('\n');
		}
		if (everyLineHasLineNumbers(processedContent)) {
			processedContent = stripLineNumbers(processedContent);
		}
		return normalizeString(processedContent, {
			smartQuotes: true,
			typographicChars: true,
			extraWhitespace: false,
			trim: false
		});
	}

	private getWriteOmissionError(
		absolutePath: string,
		processedContent: string,
		actualLineCount: number,
		predictedLineCount?: number
	): string | null {
		const strongOmissionPatterns = [
			/\/\/\s*(rest of|remaining|previous|existing)\s*(code|implementation|logic|methods?|functions?|content)/i,
			/\/\*[\s\S]*?(rest of|remaining|previous|existing)\s*(code|implementation|logic|methods?|functions?|content)/i,
			/#\s*(rest of|remaining|previous|existing)\s*(code|implementation|logic|content)/i,
			/\/\/\s*\.\.\.\s*(rest|remaining|more)/i,
			/\.\.\.\s*(rest of|remaining|previous)\s*(implementation|code)/i,
		];
		const weakOmissionPatterns = [
			/\/\/\s*\.\.\./,
			/\/\*\s*\.\.\./,
			/\/\/\s*unchanged/i,
			/\/\*\s*unchanged/i,
		];
		const hasStrongOmission = strongOmissionPatterns.some(p => p.test(processedContent));
		const hasWeakOmission = weakOmissionPatterns.some(p => p.test(processedContent));

		if (hasStrongOmission) {
			const matchedPattern = strongOmissionPatterns.find(p => p.test(processedContent));
			return `<error>
错误: 检测到代码内容被省略（B6）

文件: ${absolutePath}
发现了明显的省略标记（如 "// rest of code"、"// remaining implementation" 等）。
写入操作已拒绝，请提供完整的文件内容，不要使用任何省略符号或占位符。

如果只需要修改部分内容，请使用 edit 或 apply_diff 工具。
匹配模式: ${matchedPattern?.toString()}
</error>`;
		}

		if (hasWeakOmission && predictedLineCount && actualLineCount < predictedLineCount) {
			return `<error>
错误: 检测到代码内容可能被省略

文件: ${absolutePath}
实际行数: ${actualLineCount}
预期行数: ${predictedLineCount}

发现了代码省略标记（如 "// ..." 或 "/* unchanged */" 等）。
请提供完整的文件内容，不要使用任何省略符号或占位符。

如果只需要修改部分内容，建议使用 apply_diff 工具。
</error>`;
		}

		return null;
	}

	/**
	 * 列出目录下的文件和目录
	 * 优化：使用并行遍历，添加超时机制
	 * @param toolUse 列出文件工具使用信息
	 * @returns 文件和目录列表（目录以"/"结尾）
	 */
	async listFiles(toolUse: ListFilesToolUse): Promise<ToolResponse> {
		const { path: dirPath, recursive, max_depth } = toolUse.params;
		// F6优化：max_depth 限制递归深度；recursive=true 时默认 depth=3，防止大 monorepo context 爆炸
		const maxDepth = max_depth ? parseInt(max_depth, 10) : (recursive === 'true' ? 3 : 1);

		if (!dirPath) {
			return '错误: 未提供目录路径';
		}

		const absolutePath = this.resolveFilePath(dirPath);
		const startTime = Date.now();
		const timeout = 10000; // 10秒超时

		// P3优化：对齐 OpenCode ls.ts — 更多忽略目录（构建产物、依赖等）
		const IGNORED_DIRS = new Set([
			'node_modules', '.git', 'dist', 'build', 'out', 'target',
			'vendor', 'bin', '.cache', 'cache', '__pycache__', '.next',
			'.nuxt', 'coverage', '.nyc_output',
		]);

		try {
			const uri = URI.file(absolutePath);
			const exists = await this.fileService.exists(uri);
			if (!exists) {
				const suggestions = await this.getPathSuggestions(absolutePath);
				if (suggestions.length > 0) {
					return `错误: 目录不存在\n路径: ${absolutePath}\n\n你是否要找:\n${suggestions.map(s => `  - ${s}`).join('\n')}`;
				}
				return `错误: 目录不存在\n路径: ${absolutePath}`;
			}
			const result: string[] = [];
			const limit = 500;
			let count = 0;
			let timedOut = false;

			// 检查是否超时
			const checkTimeout = () => {
				if (Date.now() - startTime > timeout) {
					timedOut = true;
					return true;
				}
				return false;
			};

			// P3优化：树形结构遍历（对齐 OpenCode ls.ts，使用缩进展示层级）
			const listDir = async (currentUri: URI, isRecursive: boolean, depth: number = 0, prefix: string = ''): Promise<void> => {
				if (count >= limit || timedOut || checkTimeout()) {
					return;
				}

				// F6优化：按 max_depth 限制递归深度
				if (depth >= maxDepth) {
					return;
				}

				try {
					const stat = await this.fileService.resolve(currentUri);

					if (!stat.children) {
						return;
					}

					// 过滤并排序（目录优先，字母序）
					const filteredChildren = stat.children.filter(child =>
						!child.name.startsWith('.') && !IGNORED_DIRS.has(child.name)
					).sort((a, b) => {
						if (a.isDirectory && !b.isDirectory) return -1;
						if (!a.isDirectory && b.isDirectory) return 1;
						return a.name.localeCompare(b.name);
					});

					// P3优化：树形输出，每级缩进 2 空格
					const indent = '  '.repeat(depth);
					const dirs: typeof filteredChildren = [];
					for (const child of filteredChildren) {
						if (count >= limit || timedOut) break;

						if (child.isDirectory) {
							result.push(`${indent}${child.name}/`);
							dirs.push(child);
						} else {
							result.push(`${indent}${child.name}`);
						}
						count++;
					}

					// 递归子目录（限制并发数）
					if (isRecursive && dirs.length > 0 && !timedOut) {
						const concurrency = 5; // 最多5个并发
						for (let i = 0; i < dirs.length; i += concurrency) {
							if (count >= limit || timedOut) break;
							const batch = dirs.slice(i, i + concurrency);
							await Promise.all(batch.map(d => listDir(d.resource, true, depth + 1)));
						}
					}
				} catch (error) {
					// 忽略无法访问的目录
				}
			};

			await listDir(uri, recursive === 'true');

			if (result.length === 0) {
				return '目录为空或未找到匹配的文件';
			}

			let response = result.join('\n');

			if (timedOut) {
				response = `⚠️ 搜索超时（${timeout / 1000}秒），已找到 ${count} 个项目:\n\n${response}`;
			} else if (count >= limit) {
				response = `找到超过${limit}个项目，仅显示前${limit}个:\n\n${response}`;
			}

			return response;
		} catch (error) {
			return `列出文件失败\n路径: ${absolutePath}\n详情: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * 读取文件原始内容（不带行号和XML包装）
	 * 供内部工具（edit、multiedit）使用，以便正确做字符串替换
	 * @param filePath 文件路径（绝对或相对）
	 * @returns 文件原始文本，如文件不存在返回 null
	 */
	async readRawFileContent(filePath: string): Promise<string | null> {
		const absolutePath = this.resolveFilePath(filePath);
		try {
			const uri = URI.file(absolutePath);

			// D2/D4: 先检查内存缓存，若文件未被外部修改则直接返回缓存内容（零磁盘 IO）
			const cached = this.fileStateCache.get(absolutePath);
			if (cached) {
				try {
					const statCheck = await this.fileService.resolve(uri);
					const diskMtime = statCheck.mtime ?? 0;
					const diskSize = statCheck.size ?? 0;
					if (this.fileStateCache.isFresh(absolutePath, diskMtime, diskSize)) {
						return cached.content;
					}
				} catch {
					// stat 失败，降级到磁盘读取
				}
			}

			const exists = await this.fileService.exists(uri);
			if (!exists) {
				return null;
			}
			const content = await this.fileService.readFile(uri);
			const text = content.value.toString();

			// 仅刷新内部缓存，不把内部读取当成模型已读
			try {
				const stat = await this.fileService.resolve(uri);
				const mtime = stat.mtime ?? Date.now();
				const size = stat.size ?? text.length;
				this.fileStateCache.recordInternalRefresh(absolutePath, {
					content: text,
					mtime,
					size,
				});
			} catch (e) {
				console.warn(`[FileOperations] readRawFileContent: 获取 stat 失败: ${absolutePath}`, e);
			}

			return text;
		} catch (error) {
			console.warn(`[FileOperations] readRawFileContent 失败: ${absolutePath}`, error);
			return null;
		}
	}

	/**
	 * 检查文件是否存在
	 * @param path 文件路径
	 * @returns 是否存在
	 */
	async fileExists(path: string): Promise<boolean> {
		try {
			const absolutePath = this.resolveFilePath(path);
			const uri = URI.file(absolutePath);
			return await this.fileService.exists(uri);
		} catch {
			return false;
		}
	}

	/**
	 * 获取文件信息
	 * @param path 文件路径
	 * @returns 文件信息
	 */
	async getFileInfo(path: string): Promise<{ size: number; mtime: number; isDirectory: boolean } | null> {
		try {
			const absolutePath = this.resolveFilePath(path);
			const uri = URI.file(absolutePath);
			const stat = await this.fileService.resolve(uri);
			return {
				size: stat.size ?? 0,
				mtime: stat.mtime ?? 0,
				isDirectory: stat.isDirectory
			};
		} catch {
			return null;
		}
	}

	/**
	 * 获取与目标路径相似的文件列表（用于 "Did you mean?" 提示）
	 * @param targetPath 目标文件路径（绝对路径）
	 * @param maxSuggestions 最多返回几个建议（默认3个）
	 */
	private async getSimilarFiles(targetPath: string, maxSuggestions: number = 3): Promise<string[]> {
		try {
			const dirPath = path.dirname(targetPath);
			const baseName = path.basename(targetPath).toLowerCase();
			const dirUri = URI.file(dirPath);

			const dirExists = await this.fileService.exists(dirUri);
			if (!dirExists) { return []; }

			const dirStat = await this.fileService.resolve(dirUri);
			if (!dirStat.isDirectory || !dirStat.children) { return []; }

			const siblings = dirStat.children
				.filter(child => !child.isDirectory)
				.map(child => child.name);

			// 模糊匹配：文件名包含目标基名，或目标基名包含文件名
			const matches = siblings
				.filter(name => {
					const nameLower = name.toLowerCase();
					return nameLower.includes(baseName) ||
						baseName.includes(nameLower) ||
						levenshteinDistance(nameLower, baseName) <= Math.max(2, Math.floor(baseName.length * 0.3));
				})
				.slice(0, maxSuggestions)
				.map(name => path.join(dirPath, name));

			return matches;
		} catch {
			return [];
		}
	}

	private async getSimilarPathVariants(targetPath: string, maxSuggestions: number = 3): Promise<string[]> {
		try {
			let probePath = this.resolveFilePath(targetPath);
			const missingSegments: string[] = [];

			while (!(await this.fileService.exists(URI.file(probePath)))) {
				const currentSegment = path.basename(probePath);
				const parentPath = path.dirname(probePath);
				if (!currentSegment || !parentPath || parentPath === probePath) {
					return [];
				}
				missingSegments.unshift(currentSegment);
				probePath = parentPath;
			}

			if (missingSegments.length === 0) {
				return [];
			}

			let candidates = [probePath];
			for (let index = 0; index < missingSegments.length; index++) {
				const expectedSegment = missingSegments[index].toLowerCase();
				const isLastSegment = index === missingSegments.length - 1;
				const nextCandidates: string[] = [];

				for (const candidateBase of candidates) {
					const baseStat = await this.fileService.resolve(URI.file(candidateBase));
					if (!baseStat.children) {
						continue;
					}

					const matches = baseStat.children
						.filter(child => isLastSegment || child.isDirectory)
						.filter(child => {
							const childName = child.name.toLowerCase();
							return childName.includes(expectedSegment) ||
								expectedSegment.includes(childName) ||
								levenshteinDistance(childName, expectedSegment) <= Math.max(2, Math.floor(expectedSegment.length * 0.3));
						})
						.slice(0, maxSuggestions)
						.map(child => path.join(candidateBase, child.name));

					nextCandidates.push(...matches);
				}

				if (nextCandidates.length === 0) {
					return [];
				}

				candidates = Array.from(new Set(nextCandidates)).slice(0, maxSuggestions);
			}

			const resolved: string[] = [];
			for (const candidate of candidates) {
				if (await this.fileService.exists(URI.file(candidate))) {
					resolved.push(candidate);
				}
			}

			return resolved.slice(0, maxSuggestions);
		} catch {
			return [];
		}
	}

	/**
	 * 删除文件或目录（使用 VS Code IFileService，避免系统 rm 命令无法更新 VS Code 文件系统缓存的问题）
	 * @param toolUse 删除文件工具使用信息
	 * @returns 操作结果
	 */
	async deleteFile(toolUse: ToolUse): Promise<ToolResponse> {
		const filePath = toolUse.params.path;
		const recursive = toolUse.params.recursive === 'true';

		if (!filePath) {
			return '错误: 未提供文件路径';
		}

		const absolutePath = this.resolveFilePath(filePath);
		const uri = URI.file(absolutePath);

		try {
			const exists = await this.fileService.exists(uri);
			if (!exists) {
				return `错误: 文件或目录不存在: ${filePath}`;
			}

			await this.fileService.del(uri, { recursive, useTrash: false });

			return `文件已成功删除: ${filePath}`;
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			return `删除失败: ${errMsg}`;
		}
	}

	/**
	 * 创建目录（使用 VS Code IFileService，避免 mkdir 命令无法更新 VS Code 文件系统缓存的问题）
	 * @param toolUse 创建目录工具使用信息
	 * @returns 操作结果
	 */
	async createDirectory(toolUse: ToolUse): Promise<ToolResponse> {
		const dirPath = toolUse.params.path;

		if (!dirPath) {
			return '错误: 未提供目录路径';
		}

		const absolutePath = this.resolveFilePath(dirPath);
		const uri = URI.file(absolutePath);

		try {
			const exists = await this.fileService.exists(uri);
			if (exists) {
				return `目录已存在: ${dirPath}`;
			}

			await this.fileService.createFolder(uri);

			return `目录已成功创建: ${dirPath}`;
		} catch (error) {
			const errMsg = error instanceof Error ? error.message : String(error);
			return `创建目录失败: ${errMsg}`;
		}
	}

	/**
	 * 使用Glob模式匹配文件
	 * 优化：并行遍历，边遍历边匹配，添加超时机制
	 * @param toolUse Glob工具使用信息
	 * @returns 匹配的文件列表
	 */
	async glob(toolUse: GlobToolUse): Promise<ToolResponse> {
		const { path: dirPath, file_pattern } = toolUse.params;

		if (!dirPath) {
			return '错误: 未提供目录路径';
		}

		if (!file_pattern) {
			return '错误: 未提供文件模式';
		}

		const absolutePath = this.resolveFilePath(dirPath);
		const applyNoiseFiltering = shouldApplyNoiseFiltering(absolutePath, this.workspaceRoot || absolutePath);
		const startTime = Date.now();
		const timeout = 10000; // 10秒超时

		try {
			const uri = URI.file(absolutePath);
			const pathExists = await this.fileService.exists(uri);
			if (!pathExists) {
				const suggestions = await this.getPathSuggestions(absolutePath);
				if (suggestions.length > 0) {
					return `错误: 路径不存在 "${absolutePath}"\n\n你是否要找:\n${suggestions.map(s => `  - ${s}`).join('\n')}`;
				}
				return `错误: 路径不存在 "${absolutePath}"\n请检查 path 参数是否正确`;
			}

			// 验证 path 参数必须是目录而非文件
			try {
				const rootStat = await this.fileService.resolve(uri);
				if (!rootStat.isDirectory) {
					return `错误: glob 的 path 参数必须是目录，"${dirPath}" 是一个文件\n提示: 请传入目录路径，并在 file_pattern 中使用匹配模式\n示例: path="${dirPath.substring(0, dirPath.lastIndexOf('/'))}", file_pattern="**/${dirPath.substring(dirPath.lastIndexOf('/') + 1)}"`;
				}
			} catch {
				const suggestions = await this.getPathSuggestions(absolutePath);
				if (suggestions.length > 0) {
					return `错误: 路径不存在 "${absolutePath}"\n\n你是否要找:\n${suggestions.map(s => `  - ${s}`).join('\n')}`;
				}
				return `错误: 路径不存在 "${absolutePath}"\n请检查 path 参数是否正确`;
			}

			// P2优化：记录 mtime 以便按修改时间排序（对齐 OpenCode glob.ts）
		const matchedFiles: Array<{ path: string; mtime: number }> = [];
			const limit = 100; // 匹配文件限制（对齐 OpenCode glob.ts limit 100）
			let scannedCount = 0;
			let timedOut = false;

			// 预编译 glob 模式
			const pattern = glob.parse(file_pattern);

			// 检查是否超时
			const checkTimeout = () => {
				if (Date.now() - startTime > timeout) {
					timedOut = true;
					return true;
				}
				return false;
			};

			// 并行遍历并即时匹配
			const listDir = async (currentUri: URI, depth: number = 0): Promise<void> => {
				if (matchedFiles.length >= limit || timedOut || checkTimeout()) {
					return;
				}

				// 限制递归深度
				if (depth > 15) {
					return;
				}

				try {
					const stat = await this.fileService.resolve(currentUri);

					if (!stat.children) {
						return;
					}

					const dirs: URI[] = [];

					for (const child of stat.children) {
						if (matchedFiles.length >= limit || timedOut) break;

						const childPath = child.resource.fsPath;
						const childRelativePath = childPath.startsWith(absolutePath)
							? childPath.substring(absolutePath.length).replace(/^[\/\\]/, '')
							: childPath;
						const normalizedChildRelativePath = childRelativePath.replace(/\\/g, '/');
						if (applyNoiseFiltering && isLikelyNoisePath(normalizedChildRelativePath)) {
							continue;
						}

						if (child.isDirectory) {
							dirs.push(child.resource);
						} else {
							scannedCount++;
							// 即时匹配，不需要收集所有文件
							const filePath = childPath;
							const relativePath = filePath.startsWith(absolutePath)
								? filePath.substring(absolutePath.length).replace(/^[\/\\]/, '')
								: filePath;
							const normalizedPath = relativePath.replace(/\\/g, '/');
							if (applyNoiseFiltering && isLikelyNoisePath(normalizedPath)) {
								continue;
							}

							if (pattern(normalizedPath)) {
								// P2优化：记录 mtime 以便按修改时间排序（对齐 OpenCode glob.ts）
								const mtime = child.mtime ?? 0;
								// F5优化：返回相对路径（相对于工作区根目录），减少 Token 消耗
								const wsRoot = this.workspaceRoot.replace(/\/$/, '');
								const relPath = filePath.startsWith(wsRoot)
									? filePath.substring(wsRoot.length).replace(/^[\/\\]/, '')
									: filePath;
								matchedFiles.push({ path: relPath, mtime });
							}
						}
					}

					// 并行递归子目录
					if (dirs.length > 0 && !timedOut && matchedFiles.length < limit) {
						const concurrency = 5;
						for (let i = 0; i < dirs.length; i += concurrency) {
							if (matchedFiles.length >= limit || timedOut) break;
							const batch = dirs.slice(i, i + concurrency);
							await Promise.all(batch.map(d => listDir(d, depth + 1)));
						}
					}
				} catch {
					// 忽略无法访问的目录
				}
			};

			await listDir(uri);

			if (matchedFiles.length === 0) {
				return `未找到匹配模式 "${file_pattern}" 的文件（扫描了 ${scannedCount} 个文件）`;
			}

			// P2优化：按 mtime 降序排序（最近修改的文件优先，对齐 OpenCode glob.ts）
			matchedFiles.sort((a, b) => b.mtime - a.mtime);
			const sortedPaths = matchedFiles.map(f => f.path);

			let response = `找到 ${matchedFiles.length} 个匹配的文件:\n${sortedPaths.join('\n')}`;

			if (timedOut) {
				response = `⚠️ 搜索超时（${timeout / 1000}秒），已找到 ${matchedFiles.length} 个匹配:\n\n${sortedPaths.join('\n')}`;
			} else if (matchedFiles.length >= limit) {
				response = `找到超过 ${limit} 个匹配，仅显示前 ${limit} 个（按修改时间倒序）:\n${sortedPaths.join('\n')}`;
			}

			return response;
		} catch (error) {
			return `Glob搜索失败\n路径: ${absolutePath}\n详情: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	/**
	 * 应用Diff到文件
	 * 完整Kilocode apply_diff实现，使用MultiSearchReplaceDiffStrategy
	 * @param toolUse apply_diff工具使用信息
	 * @returns 执行结果
	 */
	async applyDiff(toolUse: ApplyDiffToolUse): Promise<ToolResponse> {
		const { path: relPath, diff: diffContent } = toolUse.params;

		// 验证参数
		if (!relPath) {
			return '错误: 未提供文件路径 (path参数)';
		}

		if (!diffContent) {
			return '错误: 未提供diff内容 (diff参数)';
		}

		try {
			// 使用统一的路径解析（模仿 Kilocode）
			const absolutePath = this.resolveFilePath(relPath);
			const uri = URI.file(absolutePath);
			const fileExists = await this.fileService.exists(uri);

			if (!fileExists) {
				return `错误: 文件不存在\n\n路径: ${absolutePath}\n\n<error_details>\n请检查文件路径是否正确。如果文件尚未创建，请先使用 write_to_file 工具创建文件。\n</error_details>`;
			}

			// P1-8: 文件时间戳校验（必须先读取文件才能修改）
			try {
				const stat = await this.fileService.resolve(uri);
				const currentMtime = stat.mtime ?? Date.now();
				const currentSize = stat.size ?? 0;

				const assertResult = assertFileWritable(this.sessionId, absolutePath, currentMtime, currentSize);
				if (!assertResult.success) {
					return `<error>
${assertResult.message}

提示：这是一个安全保护机制，防止覆盖您或其他程序对文件的修改。
请先使用 read_file 工具读取文件内容后再应用 diff。
</error>`;
				}
			} catch (e) {
				console.warn(`[FileOperations] 时间戳校验失败: ${absolutePath}`, e);
				// 校验失败不阻止写入，只记录警告
			}

			// 读取原始文件内容
			const fileContent = await this.fileService.readFile(uri);
			const originalContent = fileContent.value.toString();

			// 应用Diff（使用完整的MultiSearchReplaceDiffStrategy）
			const diffResult = await this.diffStrategy.applyDiff(
				originalContent,
				diffContent
			);

			if (!diffResult.success) {
				// SEARCH/REPLACE失败，尝试解析 git unified diff 格式
				const gitResult = applyGitUnifiedDiff(originalContent, diffContent);
				if (gitResult !== null) {
					const gitBuffer = VSBuffer.fromString(gitResult);
					return await withFileLock(absolutePath, async () => {
						await this.fileService.writeFile(uri, gitBuffer);
						try {
							const newStat = await this.fileService.resolve(uri);
							const newMtime = newStat.mtime ?? Date.now();
							const newSize = newStat.size ?? gitResult.length;
							updateFileAfterWrite(this.sessionId, absolutePath, newMtime, newSize);
								this.recordWrittenFileState(absolutePath, gitResult, newMtime, newSize, 'derived');
						} catch (e) {
							console.warn(`[FileOperations] 更新时间戳记录失败: ${absolutePath}`, e);
						}
						return `成功应用git diff到文件: ${absolutePath}`;
					});
				}

				// Diff应用完全失败 → throw DiffApplicationError → TaskService catch → is_error: true
				let formattedError = '';

				if (diffResult.failParts && diffResult.failParts.length > 0) {
					for (const failPart of diffResult.failParts) {
						if (failPart.success) {
							continue;
						}
						formattedError += `<error_details>\n${failPart.error}\n</error_details>\n\n`;
					}
				} else {
					formattedError = `无法应用diff到文件: ${absolutePath}\n\n<error_details>\n${diffResult.error}\n</error_details>`;
				}

				formattedError += `\n\n` + (diffResult.error && diffResult.error.includes('found in your diff content')
					? `**根因：REPLACE块中包含diff格式标记字符串（<<<<<<< SEARCH / >>>>>>> REPLACE），请改用 edit 工具（old_string/new_string格式）代替 apply_diff。**`
					: `请使用 read_file 查看文件当前内容，然后重新构造正确的SEARCH块（必须与文件内容完全匹配）。`);
				throw new DiffApplicationError(formattedError);
			}

			// Diff应用成功，检查是否有实际变化
			const newContent = diffResult.content!;

			// 内容未变化 → throw DiffApplicationError → is_error: true → Qwen 停止重试
			if (newContent === originalContent) {
				throw new DiffApplicationError(
					`apply_diff 未产生任何修改: ${absolutePath}\n\n` +
					`最可能的原因：修改已存在于文件中（幂等）。\n\n` +
					`请使用 read_file 确认当前文件状态。如果目标修改已存在，直接调用 attempt_completion 完成任务；` +
					`如果未存在，请重新 read_file 获取精确内容后再构造 SEARCH 块。`
				);
			}

			// 检查是否只有单个SEARCH/REPLACE块（提前计算，在锁外）
			const searchBlockCount = (diffContent.match(/<<<<<<< SEARCH/g) || []).length;

			// 写入文件（使用文件锁确保串行写入）
			const buffer = VSBuffer.fromString(newContent);
			return await withFileLock(absolutePath, async () => {
				await this.writeFileAndSyncEditor(uri, buffer);

				// P1-8: 写入后更新时间戳记录
				try {
					const newStat = await this.fileService.resolve(uri);
					const newMtime = newStat.mtime ?? Date.now();
					const newSize = newStat.size ?? newContent.length;
					updateFileAfterWrite(this.sessionId, absolutePath, newMtime, newSize);
					// apply_diff 后模型已知 "原文 + SEARCH/REPLACE 块" = 完整新内容，标 'full' 避免后续被 manifest 引导重读
					this.recordWrittenFileState(absolutePath, newContent, newMtime, newSize, 'full');
				} catch (e) {
					console.warn(`[FileOperations] 更新时间戳记录失败: ${absolutePath}`, e);
				}

				// 检查是否有部分Diff块失败
				let partialFailureHint = '';
				if (diffResult.failParts && diffResult.failParts.length > 0) {
					const failedCount = diffResult.failParts.filter(p => !p.success).length;
					if (failedCount > 0) {
						const failedDetails = diffResult.failParts
							.filter(p => !p.success)
							.map(p => `  - ${p.error}`)
							.join('\n');
						partialFailureHint = `注意: ${failedCount} 个diff块未能应用（其余块已成功写入）：\n${failedDetails}\n\n` +
							`⚠️ 只需重试上述失败的块，不要重新提交已成功应用的块。\n\n`;
					}
				}

				const singleBlockNotice = searchBlockCount === 1
					? '\n<notice>提示: 如果需要在此文件中进行多个相关更改，建议在单个 apply_diff 调用中使用多个 SEARCH/REPLACE 块，这样更高效。</notice>'
					: '';

				return `${partialFailureHint}成功应用diff到文件: ${absolutePath}\n\n已应用 ${searchBlockCount} 个diff块${singleBlockNotice}`;
			});
		} catch (error) {
			// DiffApplicationError 穿透 → TaskService catch → is_error: true
			if (error instanceof DiffApplicationError) {
				throw error;
			}
			return `应用diff失败: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	private formatPartialFileContent(filePath: string, text: string, startLine?: string, endLine?: string): string | null {
		const allLines = text.split(/\r?\n/);
		if (allLines.length > 0 && allLines[allLines.length - 1] === '' && text.endsWith('\n')) {
			allLines.pop();
		}

		const totalLines = allLines.length;
		const startIdx = startLine ? Math.max(0, parseInt(startLine, 10) - 1) : 0;
		const endIdx = endLine ? Math.min(totalLines, parseInt(endLine, 10)) : totalLines;

		if (startIdx >= totalLines || startIdx > endIdx) {
			return null;
		}

		const selectedLines = allLines.slice(startIdx, endIdx);
		const lineStart = startIdx + 1;
		const numberedContent = addLineNumbers(selectedLines.join('\n'), lineStart);
		return `<file path="${filePath}">\n<content lines="${lineStart}-${endIdx}">\n${numberedContent}</content>\n</file>`;
	}

	private formatFullFileContent(filePath: string, text: string): string {
		const allLines = text.split(/\r?\n/);
		if (allLines.length > 0 && allLines[allLines.length - 1] === '' && text.endsWith('\n')) {
			allLines.pop();
		}

		const totalLines = allLines.length;
		const maxLines = 2000;
		const maxBytesPerFile = 50 * 1024;
		const maxLineLength = 2000;
		const processedLines = allLines.map(line => {
			if (line.length > maxLineLength) {
				return line.substring(0, maxLineLength) + `... (行截断，共 ${line.length} 字符)`;
			}
			return line;
		});

		if (totalLines > maxLines) {
			const truncatedLines = processedLines.slice(0, maxLines);
			const numberedContent = addLineNumbers(truncatedLines.join('\n'), 1);
			return `<file path="${filePath}">\n<content lines="1-${maxLines}">\n${numberedContent}</content>\n<notice>文件共 ${totalLines} 行，仅显示前 ${maxLines} 行。使用 start_line 和 end_line 参数读取其他部分。</notice>\n</file>`;
		}

		let byteCount = 0;
		let truncatedByBytes = false;
		const byteLines: string[] = [];
		for (const line of processedLines) {
			const lineBytes = estimateFileByteLengthForRead(line) + 1;
			if (byteCount + lineBytes > maxBytesPerFile) {
				truncatedByBytes = true;
				break;
			}
			byteLines.push(line);
			byteCount += lineBytes;
		}

		if (truncatedByBytes) {
			const shownLines = byteLines.length;
			const numberedContent = addLineNumbers(byteLines.join('\n'), 1);
			return `<file path="${filePath}">\n<content lines="1-${shownLines}">\n${numberedContent}</content>\n<notice>文件内容较大（超过50KB），仅显示前 ${shownLines} 行（共 ${totalLines} 行）。使用 start_line 参数读取后续内容。</notice>\n</file>`;
		}

		const numberedContent = addLineNumbers(processedLines.join('\n'), 1);
		return `<file path="${filePath}">\n<content lines="1-${totalLines}">\n${numberedContent}</content>\n<notice>(End of file - total ${totalLines} lines)</notice>\n</file>`;
	}
}

/**
 * 估算字符串字节长度（用于文件读取的字节限制）
 * UTF-8：非 ASCII 字符估算为 3 字节
 */
function estimateFileByteLengthForRead(str: string): number {
	let bytes = 0;
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		bytes += code > 0x7f ? 3 : 1;
	}
	return bytes;
}

/**
 * Levenshtein 距离计算（用于文件名模糊匹配）
 */
function levenshteinDistance(a: string, b: string): number {
	const m = a.length;
	const n = b.length;
	if (m === 0) { return n; }
	if (n === 0) { return m; }

	const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
		Array.from({ length: n + 1 }, (__, j) => i === 0 ? j : j === 0 ? i : 0)
	);

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (a[i - 1] === b[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1];
			} else {
				dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
			}
		}
	}

	return dp[m][n];
}
