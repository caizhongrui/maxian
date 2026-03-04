/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileService } from '../../../../../platform/files/common/files.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ReadFileToolUse, WriteToFileToolUse, ListFilesToolUse, GlobToolUse, ApplyDiffToolUse, ToolResponse } from '../../common/tools/toolTypes.js';
import * as glob from '../../../../../base/common/glob.js';
import { MultiSearchReplaceDiffStrategy } from '../../common/diff/MultiSearchReplaceDiffStrategy.js';
import { addLineNumbers, stripLineNumbers, everyLineHasLineNumbers } from '../../common/utils/lineNumbers.js';
import { normalizeString } from '../../common/utils/textNormalization.js';
import * as path from '../../../../../base/common/path.js';
import { trackFileRead, assertFileWritable, withFileLock, updateFileAfterWrite } from '../../common/file/fileTimeTracker.js';
import { getDiagnosticsAfterEdit } from '../../common/lsp/lspDiagnostics.js';

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
 * 文件操作工具类
 * 实现文件读取、写入、列表等功能
 */
export class FileOperationsTool {
	private readonly diffStrategy: MultiSearchReplaceDiffStrategy;
	private sessionId: string;

	constructor(
		private readonly fileService: IFileService,
		private readonly workspaceRoot: string = '',
		sessionId?: string
	) {
		// 初始化Diff策略（完整Kilocode实现）
		this.diffStrategy = new MultiSearchReplaceDiffStrategy(1.0, 40); // 100%匹配阈值，40行缓冲
		// P1-8: 会话ID用于文件时间戳追踪
		this.sessionId = sessionId || 'default';
	}

	/**
	 * 更新会话ID
	 */
	setSessionId(sessionId: string): void {
		this.sessionId = sessionId;
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

			// 读取文本文件内容
			const content = await this.fileService.readFile(uri);
			const text = content.value.toString();
			const allLines = text.split(/\r?\n/);

			// P1-8: 记录文件读取时间戳
			try {
				const stat = await this.fileService.resolve(uri);
				const mtime = stat.mtime ?? Date.now();
				const size = stat.size ?? text.length;
				trackFileRead(this.sessionId, absolutePath, mtime, size);
			} catch (e) {
				// 忽略 stat 失败，不影响读取
				console.warn(`[FileOperations] 获取文件 stat 失败: ${absolutePath}`, e);
			}

			// 如果文件末尾有换行符，split会产生一个空字符串，需要移除
			if (allLines.length > 0 && allLines[allLines.length - 1] === '' && text.endsWith('\n')) {
				allLines.pop();
			}

			const totalLines = allLines.length;

			// 处理行范围读取
			if (start_line !== undefined || end_line !== undefined) {
				const startIdx = start_line ? Math.max(0, parseInt(start_line, 10) - 1) : 0;
				const endIdx = end_line ? Math.min(totalLines, parseInt(end_line, 10)) : totalLines;

				// 验证行范围
				if (startIdx >= totalLines) {
					return `错误: 起始行 ${start_line} 超出文件范围（文件共 ${totalLines} 行）`;
				}

				if (startIdx > endIdx) {
					return `错误: 起始行不能大于结束行`;
				}

				const selectedLines = allLines.slice(startIdx, endIdx);
				const lineStart = startIdx + 1;

				// 添加行号
				const numberedContent = addLineNumbers(selectedLines.join('\n'), lineStart);

				return `<file path="${path}">\n<content lines="${lineStart}-${endIdx}">\n${numberedContent}</content>\n</file>`;
			}

			// 大文件限制（默认5000行）
			const maxLines = 5000;
			if (totalLines > maxLines) {
				const truncatedLines = allLines.slice(0, maxLines);
				const numberedContent = addLineNumbers(truncatedLines.join('\n'), 1);

				return `<file path="${path}">\n<content lines="1-${maxLines}">\n${numberedContent}</content>\n<notice>文件共 ${totalLines} 行，仅显示前 ${maxLines} 行。使用 start_line 和 end_line 参数读取其他部分。</notice>\n</file>`;
			}

			// 正常读取整个文件（添加行号）
			const numberedContent = addLineNumbers(text, 1);

			return `<file path="${path}">\n<content lines="1-${totalLines}">\n${numberedContent}</content>\n</file>`;

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
		const { path, content, line_count } = toolUse.params;

		if (!path) {
			return '错误: 未提供文件路径';
		}

		if (content === undefined) {
			return '错误: 未提供文件内容';
		}

		// 使用统一的路径解析（模仿 Kilocode）
		const absolutePath = this.resolveFilePath(path);

		try {
			const uri = URI.file(absolutePath);

			// 检查文件是否存在
			const exists = await this.fileService.exists(uri);

			// P1-8: 文件时间戳校验（仅对已存在的文件）
			if (exists) {
				try {
					const stat = await this.fileService.resolve(uri);
					const currentMtime = stat.mtime ?? Date.now();
					const currentSize = stat.size ?? 0;

					const assertResult = assertFileWritable(this.sessionId, absolutePath, currentMtime, currentSize);
					if (!assertResult.success) {
						return `<error>
${assertResult.message}

提示：这是一个安全保护机制，防止覆盖您或其他程序对文件的修改。
</error>`;
					}
				} catch (e) {
					console.warn(`[FileOperations] 时间戳校验失败: ${absolutePath}`, e);
					// 校验失败不阻止写入，只记录警告
				}
			}

			// 预处理内容
			let processedContent = content;

			// 1. 移除Markdown代码块标记（弱模型可能会添加）
			if (processedContent.startsWith('```')) {
				processedContent = processedContent.split('\n').slice(1).join('\n');
			}
			if (processedContent.endsWith('```')) {
				processedContent = processedContent.split('\n').slice(0, -1).join('\n');
			}

			// 2. 移除行号（如果存在）
			if (everyLineHasLineNumbers(processedContent)) {
				processedContent = stripLineNumbers(processedContent);
			}

			// 3. 标准化文本（处理智能引号、typographic字符等）
			processedContent = normalizeString(processedContent, {
				smartQuotes: true,
				typographicChars: true,
				extraWhitespace: false,
				trim: false // 保留原始空白符
			});

			// 4. 代码省略检测
			const actualLineCount = processedContent.split('\n').length;
			const predictedLineCount = line_count ? parseInt(line_count, 10) : undefined;

			// 检测常见的代码省略标记
			const omissionPatterns = [
				/\/\/\s*(rest of|remaining|other|previous|existing)\s*(code|implementation|logic|content)/i,
				/\/\*\s*(rest of|remaining|other|previous|existing)\s*(code|implementation|logic|content)/i,
				/\/\/\s*\.\.\./,
				/\/\*\s*\.\.\./,
				/\/\/\s*TODO/i,
				/\/\/\s*unchanged/i,
				/\/\*\s*unchanged/i,
			];

			const hasOmissionMarker = omissionPatterns.some(pattern => pattern.test(processedContent));

			// 如果检测到代码省略
			if (hasOmissionMarker && predictedLineCount && actualLineCount < predictedLineCount) {
				return `<error>
错误: 检测到代码内容可能被省略

文件: ${absolutePath}
实际行数: ${actualLineCount}
预期行数: ${predictedLineCount}

发现了代码省略标记（如 "// rest of code" 或 "// ..." 等）。
请提供完整的文件内容，不要使用任何省略符号或占位符。

如果只需要修改部分内容，建议使用 apply_diff 工具。
</error>`;
			}

			// 5. 行数验证警告
			if (predictedLineCount && Math.abs(actualLineCount - predictedLineCount) > 5) {
				console.warn(`[writeToFile] 行数不匹配: 实际 ${actualLineCount} 行，预期 ${predictedLineCount} 行`);
			}

			// 写入文件（使用文件锁确保串行写入）
			const buffer = VSBuffer.fromString(processedContent);

			return await withFileLock(absolutePath, async () => {
				try {
					if (exists) {
						// 文件存在，更新内容
						await this.fileService.writeFile(uri, buffer);
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

				// P1-8: 写入后更新时间戳记录
				try {
					const newStat = await this.fileService.resolve(uri);
					const newMtime = newStat.mtime ?? Date.now();
					const newSize = newStat.size ?? processedContent.length;
					updateFileAfterWrite(this.sessionId, absolutePath, newMtime, newSize);
				} catch (e) {
					console.warn(`[FileOperations] 更新时间戳记录失败: ${absolutePath}`, e);
				}

				// P2-12: 获取 LSP 诊断（失败不影响主流程，文件已写入成功）
				let diagnosticsAppendix = '';
				try {
					diagnosticsAppendix = await getDiagnosticsAfterEdit(absolutePath) ?? '';
				} catch (diagErr) {
					console.warn(`[FileOperations] LSP诊断获取失败（不影响文件写入结果）: ${absolutePath}`, diagErr);
				}

				if (exists) {
					return `<success>
文件已更新: ${absolutePath}
操作: 修改现有文件
行数: ${actualLineCount}
</success>${diagnosticsAppendix}`;
				} else {
					return `<success>
文件已创建: ${absolutePath}
操作: 创建新文件
行数: ${actualLineCount}
</success>${diagnosticsAppendix}`;
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
文件: ${absolutePath}
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
文件: ${absolutePath}
详情: ${errorMessage}

可能的原因:
1. 文件路径无效
2. 目录不存在（请确保父目录已创建）
3. 磁盘空间不足
</error>`;
		}
	}

	/**
	 * 列出目录下的文件和目录
	 * 优化：使用并行遍历，添加超时机制
	 * @param toolUse 列出文件工具使用信息
	 * @returns 文件和目录列表（目录以"/"结尾）
	 */
	async listFiles(toolUse: ListFilesToolUse): Promise<ToolResponse> {
		const { path: dirPath, recursive } = toolUse.params;

		if (!dirPath) {
			return '错误: 未提供目录路径';
		}

		const absolutePath = this.resolveFilePath(dirPath);
		const startTime = Date.now();
		const timeout = 10000; // 10秒超时

		try {
			const uri = URI.file(absolutePath);
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

			// 并行遍历目录
			const listDir = async (currentUri: URI, isRecursive: boolean, depth: number = 0): Promise<void> => {
				if (count >= limit || timedOut || checkTimeout()) {
					return;
				}

				// 限制递归深度
				if (depth > 10) {
					return;
				}

				try {
					const stat = await this.fileService.resolve(currentUri);

					if (!stat.children) {
						return;
					}

					// 过滤并排序
					const filteredChildren = stat.children.filter(child =>
						!child.name.startsWith('.') && child.name !== 'node_modules'
					).sort((a, b) => {
						if (a.isDirectory && !b.isDirectory) return -1;
						if (!a.isDirectory && b.isDirectory) return 1;
						return a.name.localeCompare(b.name);
					});

					// 先收集当前目录的所有项目
					const dirs: typeof filteredChildren = [];
					for (const child of filteredChildren) {
						if (count >= limit || timedOut) break;

						const childPath = child.resource.fsPath;
						if (child.isDirectory) {
							result.push(`${childPath}/`);
							dirs.push(child);
						} else {
							result.push(childPath);
						}
						count++;
					}

					// 并行递归子目录（限制并发数）
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

			const elapsed = Date.now() - startTime;
			console.log('[FileOperations] listFiles 完成，耗时:', elapsed, 'ms，文件数:', count);

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
		const startTime = Date.now();
		const timeout = 10000; // 10秒超时

		try {
			const uri = URI.file(absolutePath);

			// 验证 path 参数必须是目录而非文件
			try {
				const rootStat = await this.fileService.resolve(uri);
				if (!rootStat.isDirectory) {
					return `错误: glob 的 path 参数必须是目录，"${dirPath}" 是一个文件\n提示: 请传入目录路径，并在 file_pattern 中使用匹配模式\n示例: path="${dirPath.substring(0, dirPath.lastIndexOf('/'))}", file_pattern="**/${dirPath.substring(dirPath.lastIndexOf('/') + 1)}"`;
				}
			} catch {
				return `错误: 路径不存在 "${absolutePath}"\n请检查 path 参数是否正确`;
			}

			const matchedFiles: string[] = [];
			const limit = 200; // 匹配文件限制
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

						// 跳过隐藏文件和 node_modules
						if (child.name.startsWith('.') || child.name === 'node_modules') {
							continue;
						}

						if (child.isDirectory) {
							dirs.push(child.resource);
						} else {
							scannedCount++;
							// 即时匹配，不需要收集所有文件
							const filePath = child.resource.fsPath;
							const relativePath = filePath.startsWith(absolutePath)
								? filePath.substring(absolutePath.length).replace(/^[\/\\]/, '')
								: filePath;
							const normalizedPath = relativePath.replace(/\\/g, '/');

							if (pattern(normalizedPath)) {
								matchedFiles.push(filePath);
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

			const elapsed = Date.now() - startTime;
			console.log('[FileOperations] glob 完成，耗时:', elapsed, 'ms，扫描:', scannedCount, '匹配:', matchedFiles.length);

			if (matchedFiles.length === 0) {
				return `未找到匹配模式 "${file_pattern}" 的文件（扫描了 ${scannedCount} 个文件）`;
			}

			let response = `找到 ${matchedFiles.length} 个匹配的文件:\n${matchedFiles.join('\n')}`;

			if (timedOut) {
				response = `⚠️ 搜索超时（${timeout / 1000}秒），已找到 ${matchedFiles.length} 个匹配:\n\n${matchedFiles.join('\n')}`;
			} else if (matchedFiles.length >= limit) {
				response = `找到超过 ${limit} 个匹配，仅显示前 ${limit} 个:\n${matchedFiles.join('\n')}`;
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

			// 读取原始文件内容
			const fileContent = await this.fileService.readFile(uri);
			const originalContent = fileContent.value.toString();

			// 应用Diff（使用完整的MultiSearchReplaceDiffStrategy）
			const diffResult = await this.diffStrategy.applyDiff(
				originalContent,
				diffContent
			);

			if (!diffResult.success) {
				// Diff应用失败
				let formattedError = '';

				if (diffResult.failParts && diffResult.failParts.length > 0) {
					// 有部分失败的Diff块
					for (const failPart of diffResult.failParts) {
						if (failPart.success) {
							continue;
						}
						formattedError += `<error_details>\n${failPart.error}\n</error_details>\n\n`;
					}
				} else {
					// 完全失败
					formattedError = `无法应用diff到文件: ${absolutePath}\n\n<error_details>\n${diffResult.error}\n</error_details>`;
				}

				return formattedError;
			}

			// Diff应用成功，检查是否有实际变化
			const newContent = diffResult.content!;

			// 🔥 防止重复修改：如果内容没有变化，说明修改已经存在
			if (newContent === originalContent) {
				return `⚠️ 文件内容未发生变化: ${absolutePath}\n\n这通常意味着：\n1. 修改已经存在于文件中\n2. 或者SEARCH块没有匹配到任何内容\n\n💡 建议：\n- 使用 read_file 查看当前文件状态\n- 如果问题已解决，使用 attempt_completion 完成任务\n- 如果问题未解决，使用不同的SEARCH内容重新尝试\n\n⚠️ 请不要重复应用相同的diff，这会浪费时间和资源！`;
			}

			const buffer = VSBuffer.fromString(newContent);
			await this.fileService.writeFile(uri, buffer);

			// 检查是否有部分Diff块失败
			let partialFailureHint = '';
			if (diffResult.failParts && diffResult.failParts.length > 0) {
				const failedCount = diffResult.failParts.filter(p => !p.success).length;
				if (failedCount > 0) {
					partialFailureHint = `注意: ${failedCount} 个diff块未能应用。请使用 read_file 检查文件内容并重新尝试。\n\n`;
				}
			}

			// 检查是否只有单个SEARCH/REPLACE块
			const searchBlockCount = (diffContent.match(/<<<<<<< SEARCH/g) || []).length;
			const singleBlockNotice = searchBlockCount === 1
				? '\n<notice>提示: 如果需要在此文件中进行多个相关更改，建议在单个 apply_diff 调用中使用多个 SEARCH/REPLACE 块，这样更高效。</notice>'
				: '';

			// P2-12: 获取 LSP 诊断
			const diagnosticsAppendix = await getDiagnosticsAfterEdit(absolutePath);

			return `${partialFailureHint}成功应用diff到文件: ${absolutePath}\n\n已应用 ${searchBlockCount} 个diff块${singleBlockNotice}${diagnosticsAppendix}`;
		} catch (error) {
			return `应用diff失败: ${error instanceof Error ? error.message : String(error)}`;
		}
	}
}
