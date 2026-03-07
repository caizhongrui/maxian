/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEditorService } from '../../../services/editor/common/editorService.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { basename, dirname } from '../../../../base/common/resources.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { isAbsolute, join } from '../../../../base/common/path.js';

/**
 * Maxian Diff视图URI方案
 */
export const MAXIAN_DIFF_VIEW_URI_SCHEME = 'maxian-diff';

/**
 * 模块级 Map：存储 maxian-diff URI -> 原始文件内容
 *
 * 用途：避免将大文件内容编码到 URI query 参数中（会导致模型 URI 不稳定，
 * 进而导致模型无法被正确找到和销毁，引发 "Model already exists" 崩溃）。
 *
 * key: originalUri.toString()（不含 query）
 * value: 原始文件内容
 */
const _originalContentStore = new Map<string, string>();

/**
 * 供 MaxianDiffContentProvider 查询 maxian-diff URI 对应的原始内容
 */
export function getStoredOriginalContent(uriKey: string): string {
	return _originalContentStore.get(uriKey) ?? '';
}

/**
 * 清理 Map 中的条目（在 saveAndClose / closeWithoutSave 时调用）
 */
export function clearStoredOriginalContent(uriKey: string): void {
	_originalContentStore.delete(uriKey);
}

/**
 * DiffViewProvider - 管理文件差异视图
 * 参考Kilocode的DiffViewProvider实现，使用VSCode内置Diff Editor
 */
export class DiffViewProvider extends Disposable {
	private originalContent: string = '';
	private modifiedContent: string = '';
	private filePath: string = '';
	private isNewFile: boolean = false;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IFileService private readonly fileService: IFileService,
		@IModelService private readonly modelService: IModelService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super();
	}

	/**
	 * 将相对路径转换为绝对路径
	 */
	private resolveFilePath(filePath: string): string {
		// 如果已经是绝对路径，直接返回
		if (isAbsolute(filePath)) {
			return filePath;
		}

		// 移除开头的 ./
		let normalizedPath = filePath;
		if (normalizedPath.startsWith('./')) {
			normalizedPath = normalizedPath.substring(2);
		}

		// 获取工作区根目录
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		if (workspaceFolders.length > 0) {
			const workspaceRoot = workspaceFolders[0].uri.fsPath;
			return join(workspaceRoot, normalizedPath);
		}

		// 没有工作区，返回原路径
		return filePath;
	}

	/**
	 * 打开文件差异视图
	 * @param filePath 文件路径
	 * @param newContent 新内容
	 * @returns 是否成功打开
	 */
	async openDiff(filePath: string, newContent: string): Promise<boolean> {
		try {
			console.log('[Maxian] DiffViewProvider.openDiff 开始, filePath:', filePath);
			console.log('[Maxian] DiffViewProvider.openDiff newContent长度:', newContent?.length || 0);

			// 解析相对路径为绝对路径
			const resolvedPath = this.resolveFilePath(filePath);
			console.log('[Maxian] 解析文件路径:', filePath, '->', resolvedPath);

			this.filePath = resolvedPath;
			this.modifiedContent = newContent;

			const fileUri = URI.file(resolvedPath);
			console.log('[Maxian] 文件URI:', fileUri.toString());

			// 检查文件是否存在
			const fileExists = await this.fileService.exists(fileUri);
			this.isNewFile = !fileExists;
			console.log('[Maxian] 文件存在:', fileExists, '是新文件:', this.isNewFile);

			if (fileExists) {
				// 读取原始文件内容
				const content = await this.fileService.readFile(fileUri);
				this.originalContent = content.value.toString();
				console.log('[Maxian] 原始内容长度:', this.originalContent.length);
			} else {
				// 新文件，原始内容为空
				this.originalContent = '';
				console.log('[Maxian] 新文件，原始内容为空');

				// 确保父目录存在
				const parentDir = dirname(fileUri);
				if (!(await this.fileService.exists(parentDir))) {
					console.log('[Maxian] 创建父目录:', parentDir.toString());
					await this.fileService.createFolder(parentDir);
				}
			}

			// 打开diff编辑器
			console.log('[Maxian] 准备打开diff编辑器...');
			await this.openDiffEditor(fileUri);
			console.log('[Maxian] diff编辑器打开成功');
			return true;
		} catch (error) {
			console.error('[Maxian] DiffViewProvider.openDiff 失败:', error);
			return false;
		}
	}

	/**
	 * 打开VSCode的diff编辑器
	 */
	private async openDiffEditor(fileUri: URI): Promise<void> {
		const fileName = basename(fileUri);
		console.log('[Maxian] openDiffEditor 开始, fileName:', fileName);

		// 创建稳定的 originalUri（不含 query，避免 URI 因内容不同而变化导致模型无法复用/销毁）
		// 原始内容存储在模块级 Map 中，由 MaxianDiffContentProvider 通过 getStoredOriginalContent 查询
		const originalUri = URI.parse(`${MAXIAN_DIFF_VIEW_URI_SCHEME}:${fileName}`);
		_originalContentStore.set(originalUri.toString(), this.originalContent);
		console.log('[Maxian] originalUri:', originalUri.toString());

		// 如果 originalUri 对应的模型已存在（上次 diff 未通过 saveAndClose/closeWithoutSave 关闭），
		// 必须主动更新其内容，否则 diff 左侧将显示上次的旧内容（VS Code 不会再次调用 provideTextContent）
		const existingOriginalModel = this.modelService.getModel(originalUri);
		if (existingOriginalModel) {
			existingOriginalModel.setValue(this.originalContent);
			console.log('[Maxian] 已更新已存在的originalModel');
		}

		// 创建稳定的 modifiedUri（不含 timestamp query）
		// 与 saveAndClose/closeWithoutSave 中使用相同的 URI，确保模型可被正确找到和销毁
		const modifiedUri = fileUri.with({ scheme: 'maxian-modified' });
		console.log('[Maxian] modifiedUri:', modifiedUri.toString());

		// 在模型服务中注册修改后的内容（先查再建，避免重复创建）
		let modifiedModel: ITextModel | null = this.modelService.getModel(modifiedUri);
		if (!modifiedModel) {
			console.log('[Maxian] 创建新的modifiedModel');
			modifiedModel = this.modelService.createModel(
				this.modifiedContent,
				null,
				modifiedUri
			);
		} else {
			console.log('[Maxian] 更新已存在的modifiedModel');
			modifiedModel.setValue(this.modifiedContent);
		}

		// 打开diff编辑器
		const diffTitle = this.isNewFile
			? `${fileName}: 新文件 (可编辑)`
			: `${fileName}: 原始 ↔ 码弦的修改 (可编辑)`;
		console.log('[Maxian] diffTitle:', diffTitle);

		console.log('[Maxian] 调用editorService.openEditor...');
		const editor = await this.editorService.openEditor({
			original: { resource: originalUri },
			modified: { resource: modifiedUri },
			label: diffTitle,
			options: {
				preserveFocus: false,
				pinned: true,
				revealIfVisible: true
			}
		});
		console.log('[Maxian] editorService.openEditor 返回:', editor ? '成功' : '失败');

		console.log('[Maxian] Diff编辑器已打开:', this.filePath);
	}

	/**
	 * 应用SEARCH/REPLACE差异
	 * @param filePath 文件路径
	 * @param diff SEARCH/REPLACE格式的差异，或直接的新文件内容
	 * @returns 是否成功应用
	 */
	async applyDiff(filePath: string, diff: string): Promise<boolean> {
		try {
			// 解析相对路径为绝对路径
			const resolvedPath = this.resolveFilePath(filePath);
			console.log('[Maxian] applyDiff 解析文件路径:', filePath, '->', resolvedPath);

			const fileUri = URI.file(resolvedPath);

			// 检查文件是否存在
			const fileExists = await this.fileService.exists(fileUri);
			if (!fileExists) {
				// 如果文件不存在，将diff内容视为新文件内容
				console.log('[Maxian] 文件不存在，将diff视为新文件内容:', resolvedPath);
				return await this.openDiff(resolvedPath, diff);
			}

			// 读取原始文件内容
			const content = await this.fileService.readFile(fileUri);
			const originalContent = content.value.toString();

			// 解析并应用SEARCH/REPLACE块
			const newContent = this.applySearchReplace(originalContent, diff);
			if (newContent === null) {
				console.error('[Maxian] 应用SEARCH/REPLACE失败');
				return false;
			}

			// 如果返回undefined，说明没有SEARCH/REPLACE块，尝试解析git unified diff格式
			if (newContent === undefined) {
				const gitDiffResult = this.applyGitUnifiedDiff(originalContent, diff);
				if (gitDiffResult !== null) {
					console.log('[Maxian] 检测到git unified diff格式，已成功应用');
					return await this.openDiff(resolvedPath, gitDiffResult);
				}
				// 既不是SEARCH/REPLACE也不是git diff，返回错误
				console.error('[Maxian] diff格式不识别，既无SEARCH/REPLACE块也不是git unified diff格式');
				return false;
			}

			// 打开diff视图（注意：这里传递已解析的路径）
			return await this.openDiff(resolvedPath, newContent);
		} catch (error) {
			console.error('[Maxian] applyDiff失败:', error);
			return false;
		}
	}

	/**
	 * 解析并应用SEARCH/REPLACE块
	 * @param originalContent 原始文件内容
	 * @param diff 差异内容（SEARCH/REPLACE格式或直接新内容）
	 * @returns 新内容，如果没有SEARCH/REPLACE块则返回undefined表示应直接使用diff作为新内容
	 */
	private applySearchReplace(originalContent: string, diff: string): string | null | undefined {
		// 解析SEARCH/REPLACE块
		// 兼容AI生成的两种格式：
		// 标准格式: <<<<<<< SEARCH\n内容\n=======\n替换内容\n>>>>>>> REPLACE
		// 无换行格式: <<<<<<< SEARCH\n内容}=======\n替换内容}>>>>>>> REPLACE（=======和>>>>>>> REPLACE前无换行）
		const searchReplaceRegex = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n?=======\r?\n([\s\S]*?)\r?\n?>>>>>>> REPLACE/g;

		let result = originalContent;
		let match;
		let hasMatch = false;

		while ((match = searchReplaceRegex.exec(diff)) !== null) {
			hasMatch = true;
			const searchText = match[1];
			const replaceText = match[2];

			// 策略1: 精确匹配
			const searchIndex = result.indexOf(searchText);
			if (searchIndex !== -1) {
				result = result.substring(0, searchIndex) + replaceText + result.substring(searchIndex + searchText.length);
				continue;
			}

			console.warn('[Maxian] 未找到SEARCH文本（尝试回退策略）:', searchText.substring(0, 50) + '...');

			// 策略2: 标准化行尾后匹配（CRLF -> LF），并在标准化后的内容上执行替换
			const normalizedResult = result.replace(/\r\n/g, '\n');
			const normalizedSearch = searchText.replace(/\r\n/g, '\n');
			const normalizedIndex = normalizedResult.indexOf(normalizedSearch);
			if (normalizedIndex !== -1) {
				result = normalizedResult.substring(0, normalizedIndex) + replaceText + normalizedResult.substring(normalizedIndex + normalizedSearch.length);
				continue;
			}

			// 策略3: 逐行匹配（忽略每行行尾空白）
			const lineRange = this.findByLines(result, searchText);
			if (lineRange !== null) {
				result = result.substring(0, lineRange.start) + replaceText + result.substring(lineRange.end);
				continue;
			}

			// 所有策略均失败
			console.warn('[Maxian] 未找到SEARCH文本（精确/CRLF/逐行均失败）:', searchText.substring(0, 50) + '...');
			return null;
		}

		if (!hasMatch) {
			console.warn('[Maxian] 未找到SEARCH/REPLACE块，将diff内容作为新文件内容处理');
			// 返回undefined表示没有SEARCH/REPLACE块，调用者应直接使用diff作为新内容
			return undefined;
		}

		return result;
	}

	/**
	 * 解析并应用 git unified diff 格式
	 * 支持 @@ -X,Y +X,Y @@ hunk 格式
	 * @returns 应用后的新内容，如果不是git diff格式则返回 null
	 */
	private applyGitUnifiedDiff(originalContent: string, diff: string): string | null {
		// 检测是否为git unified diff格式（含有 @@ -数字 ... @@ 的hunk头）
		if (!/^@@[ 	]+-\d+/m.test(diff)) {
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
			const hunkMatch = diffLines[i].match(/^@@[ 	]+-(\d+)(?:,(\d+))?[ 	]\+(\d+)(?:,(\d+))?[ 	]@@/);
			if (!hunkMatch) {
				i++;
				continue;
			}

			const origStart = parseInt(hunkMatch[1]) - 1; // 转为 0-based 索引
			const origCount = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2]) : 1;
			i++; // 跳过 hunk 头

			// 从 hunk 行中提取新内容（context 行 + added 行）
			const insertLines: string[] = [];
			while (i < diffLines.length && !diffLines[i].match(/^@@[ 	]+-\d+/)) {
				const line = diffLines[i];
				if (line.startsWith('+')) {
					insertLines.push(line.substring(1));
				} else if (line.startsWith('-')) {
					// 删除的行，不加入 insertLines
				} else if (line.startsWith(' ')) {
					insertLines.push(line.substring(1)); // 上下文行
				} else if (line.startsWith('\\')) {
					// \ No newline at end of file，忽略
				}
				// 其他行（空行、文件头残留等）忽略
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
	 * 通过逐行比较（忽略行尾空白）在 content 中定位 searchText 对应的字符范围
	 */
	private findByLines(content: string, searchText: string): { start: number; end: number } | null {
		const searchLines = searchText.split('\n').map(l => l.trimEnd());
		const contentLines = content.split('\n');

		for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
			let allMatch = true;
			for (let j = 0; j < searchLines.length; j++) {
				if (contentLines[i + j].trimEnd() !== searchLines[j]) {
					allMatch = false;
					break;
				}
			}
			if (allMatch) {
				// 计算 start：前 i 行的总字符数（含换行符）
				let start = 0;
				for (let k = 0; k < i; k++) {
					start += contentLines[k].length + 1; // +1 for '\n'
				}
				// 计算 end：start + 匹配行的总字符数（行间含换行符，最后一行不含）
				let end = start;
				for (let k = i; k < i + searchLines.length - 1; k++) {
					end += contentLines[k].length + 1;
				}
				end += contentLines[i + searchLines.length - 1].length;
				return { start, end };
			}
		}
		return null;
	}

	/**
	 * 保存当前修改
	 */
	async saveChanges(): Promise<boolean> {
		try {
			if (!this.filePath) {
				return false;
			}

			const fileUri = URI.file(this.filePath);

			// 写入文件
			await this.fileService.writeFile(fileUri, VSBuffer.fromString(this.modifiedContent));

			console.log('[Maxian] 文件已保存:', this.filePath);
			return true;
		} catch (error) {
			console.error('[Maxian] 保存文件失败:', error);
			return false;
		}
	}

	/**
	 * 撤销修改（恢复原始内容或删除新文件）
	 */
	async revertChanges(): Promise<boolean> {
		try {
			if (!this.filePath) {
				return false;
			}

			const fileUri = URI.file(this.filePath);

			if (this.isNewFile) {
				// 删除新创建的文件
				if (await this.fileService.exists(fileUri)) {
					await this.fileService.del(fileUri);
				}
			} else {
				// 恢复原始内容
				await this.fileService.writeFile(fileUri, VSBuffer.fromString(this.originalContent));
			}

			console.log('[Maxian] 修改已撤销:', this.filePath);
			return true;
		} catch (error) {
			console.error('[Maxian] 撤销修改失败:', error);
			return false;
		}
	}

	/**
	 * 获取当前文件路径
	 */
	getFilePath(): string {
		return this.filePath;
	}

	/**
	 * 获取修改后的内容
	 */
	getModifiedContent(): string {
		return this.modifiedContent;
	}

	/**
	 * 获取原始内容
	 */
	getOriginalContent(): string {
		return this.originalContent;
	}

	/**
	 * 保存修改并关闭diff编辑器，然后打开修改后的文件
	 * @returns 是否成功
	 */
	async saveAndClose(): Promise<boolean> {
		try {
			if (!this.filePath) {
				console.warn('[Maxian] saveAndClose: 没有文件路径');
				return false;
			}

			const fileUri = URI.file(this.filePath);

			// 1. 保存修改内容
			await this.fileService.writeFile(fileUri, VSBuffer.fromString(this.modifiedContent));
			console.log('[Maxian] 文件已保存:', this.filePath);

			// 2. 获取当前活动的 diff 编辑器并关闭它
			const activePane = this.editorService.activeEditorPane;
			if (activePane && activePane.input) {
				const editorIdentifier = {
					groupId: activePane.group.id,
					editor: activePane.input
				};
				// 关闭 diff 编辑器
				await this.editorService.closeEditor(editorIdentifier);
				console.log('[Maxian] Diff编辑器已关闭');
			}

			// 3. 清理 diff 相关的模型
			const fileName = basename(fileUri);
			const originalUri = URI.parse(`${MAXIAN_DIFF_VIEW_URI_SCHEME}:${fileName}`);
			const modifiedUri = fileUri.with({ scheme: 'maxian-modified' });

			// 清理 Map 中的原始内容条目
			clearStoredOriginalContent(originalUri.toString());

			const originalModel = this.modelService.getModel(originalUri);
			if (originalModel) {
				originalModel.dispose();
			}

			const modifiedModel = this.modelService.getModel(modifiedUri);
			if (modifiedModel) {
				modifiedModel.dispose();
			}

			// 4. 打开实际文件
			await this.editorService.openEditor({
				resource: fileUri,
				options: {
					preserveFocus: false,
					pinned: false,
					revealIfVisible: true
				}
			});

			console.log('[Maxian] 已打开文件:', this.filePath);

			// 5. 清理状态
			this.filePath = '';
			this.originalContent = '';
			this.modifiedContent = '';
			this.isNewFile = false;

			return true;
		} catch (error) {
			console.error('[Maxian] saveAndClose 失败:', error);
			return false;
		}
	}

	/**
	 * 关闭diff编辑器但不保存（用于拒绝场景）
	 * @returns 是否成功
	 */
	async closeWithoutSave(): Promise<boolean> {
		try {
			if (!this.filePath) {
				return false;
			}

			const fileUri = URI.file(this.filePath);
			const fileName = basename(fileUri);
			const isNewFile = this.isNewFile;

			// 1. 获取当前活动的 diff 编辑器并关闭它
			const activePane = this.editorService.activeEditorPane;
			if (activePane && activePane.input) {
				const editorIdentifier = {
					groupId: activePane.group.id,
					editor: activePane.input
				};
				// 关闭 diff 编辑器
				await this.editorService.closeEditor(editorIdentifier);
				console.log('[Maxian] Diff编辑器已关闭');
			}

			// 2. 清理 diff 相关的模型
			const originalUri = URI.parse(`${MAXIAN_DIFF_VIEW_URI_SCHEME}:${fileName}`);
			const modifiedUri = fileUri.with({ scheme: 'maxian-modified' });

			// 清理 Map 中的原始内容条目
			clearStoredOriginalContent(originalUri.toString());

			const originalModel = this.modelService.getModel(originalUri);
			if (originalModel) {
				originalModel.dispose();
			}

			const modifiedModel = this.modelService.getModel(modifiedUri);
			if (modifiedModel) {
				modifiedModel.dispose();
			}

			// 3. 如果不是新文件，打开原文件
			if (!isNewFile) {
				await this.editorService.openEditor({
					resource: fileUri,
					options: {
						preserveFocus: false,
						pinned: false,
						revealIfVisible: true
					}
				});
				console.log('[Maxian] 已打开原文件:', this.filePath);
			}

			console.log('[Maxian] Diff编辑器已关闭（未保存）');

			// 4. 清理状态
			this.filePath = '';
			this.originalContent = '';
			this.modifiedContent = '';
			this.isNewFile = false;

			return true;
		} catch (error) {
			console.error('[Maxian] closeWithoutSave 失败:', error);
			return false;
		}
	}
}
