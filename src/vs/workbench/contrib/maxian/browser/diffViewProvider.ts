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
import { MultiSearchReplaceDiffStrategy } from '../common/diff/MultiSearchReplaceDiffStrategy.js';

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
 * 模块级 Set：记录已由 diff confirm 保存的文件绝对路径
 * 用途：让后续的 executeEdit/executeMultiedit 知道文件已保存，跳过重复写入
 */
const _savedByDiffPaths = new Set<string>();

/** 标记某路径已由 diff confirm 保存 */
export function markPathSavedByDiff(path: string): void {
	_savedByDiffPaths.add(path);
}

/** 检查并消费标记（调用后标记被清除） */
export function consumePathSavedByDiff(path: string): boolean {
	if (_savedByDiffPaths.has(path)) {
		_savedByDiffPaths.delete(path);
		return true;
	}
	return false;
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
	private readonly diffStrategy: MultiSearchReplaceDiffStrategy;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IFileService private readonly fileService: IFileService,
		@IModelService private readonly modelService: IModelService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super();
		this.diffStrategy = new MultiSearchReplaceDiffStrategy(0.9, 40);
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

			// 检测是否含有 SEARCH/REPLACE 块
			if (/<<<<<<< SEARCH/.test(diff)) {
				// 使用与 fileOperations.ts 相同的 MultiSearchReplaceDiffStrategy（4层级联 + 9种策略）
				const diffResult = await this.diffStrategy.applyDiff(originalContent, diff);
				if (diffResult.success && diffResult.content) {
					return await this.openDiff(resolvedPath, diffResult.content);
				}
				// 可视化失败不显示 error（diff 格式问题由 fileOperations.ts 反馈给 AI 处理）
				console.warn('[Maxian] applyDiff: 可视化失败', String(diffResult.error).substring(0, 100));
				return false;
			}

			// 尝试解析git unified diff格式
			const gitDiffResult = this.applyGitUnifiedDiff(originalContent, diff);
			if (gitDiffResult !== null) {
				console.log('[Maxian] 检测到git unified diff格式，已成功应用');
				return await this.openDiff(resolvedPath, gitDiffResult);
			}

			// 既不是SEARCH/REPLACE也不是git diff，兜底：将diff内容作为新文件内容直接展示diff视图
			console.log('[Maxian] diff格式不识别，兜底将内容作为新文件内容展示diff视图');
			return await this.openDiff(resolvedPath, diff);
		} catch (error) {
			console.error('[Maxian] applyDiff失败:', error);
			return false;
		}
	}

	private applyGitUnifiedDiff(originalContent: string, diff: string): string | null {
		// 检测是否为git unified diff格式（含有 @@ -数字 ... @@ 的hunk头）
		if (!/^@@[ \t]+-\d+/m.test(diff)) {
			return null;
		}

		const resultLines = originalContent.split('\n');
		const diffLines = diff.split('\n');
		let i = 0;
		let lineOffset = 0;

		while (i < diffLines.length &&
			(diffLines[i].startsWith('--- ') || diffLines[i].startsWith('+++ ') ||
			diffLines[i].startsWith('diff ') || diffLines[i].startsWith('index '))) {
			i++;
		}

		while (i < diffLines.length) {
			const hunkMatch = diffLines[i].match(/^@@[ \t]+-([\d]+)(?:,([\d]+))?[ \t]\+([\d]+)(?:,([\d]+))?[ \t]@@/);
			if (!hunkMatch) { i++; continue; }

			const origStart = parseInt(hunkMatch[1]) - 1;
			const origCount = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2]) : 1;
			i++;

			const insertLines: string[] = [];
			while (i < diffLines.length && !diffLines[i].match(/^@@[ \t]+-[\d]+/)) {
				const line = diffLines[i];
				if (line.startsWith('+')) { insertLines.push(line.substring(1)); }
				else if (line.startsWith(' ')) { insertLines.push(line.substring(1)); }
				i++;
			}

			const startInResult = origStart + lineOffset;
			resultLines.splice(startInResult, origCount, ...insertLines);
			lineOffset += insertLines.length - origCount;
		}

		return resultLines.join('\n');
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


			// 立即同步内存中的编辑器模型（避免编辑器显示旧内容）
			const realModel = this.modelService.getModel(fileUri);
			if (realModel) {
				realModel.setValue(this.modifiedContent);
			}

			// 标记此路径已由 diff confirm 保存（供后续 executeEdit/executeMultiedit 跳过重复写入）
			markPathSavedByDiff(this.filePath);

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
