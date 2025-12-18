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

		// 创建临时URI用于显示原始内容
		// 使用encodeURIComponent编码原始内容作为query参数（浏览器环境兼容）
		const originalUri = URI.parse(`${MAXIAN_DIFF_VIEW_URI_SCHEME}:${fileName}`).with({
			query: encodeURIComponent(this.originalContent)
		});
		console.log('[Maxian] originalUri:', originalUri.toString());

		// 创建临时模型用于修改后的内容
		const modifiedUri = fileUri.with({ scheme: 'maxian-modified', query: Date.now().toString() });
		console.log('[Maxian] modifiedUri:', modifiedUri.toString());

		// 在模型服务中注册修改后的内容
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

			// 如果返回undefined，说明没有SEARCH/REPLACE块，将diff内容视为新文件内容
			if (newContent === undefined) {
				console.log('[Maxian] 没有SEARCH/REPLACE块，将diff内容视为新文件内容');
				return await this.openDiff(resolvedPath, diff);
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
		const searchReplaceRegex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

		let result = originalContent;
		let match;
		let hasMatch = false;

		while ((match = searchReplaceRegex.exec(diff)) !== null) {
			hasMatch = true;
			const searchText = match[1];
			const replaceText = match[2];

			// 查找并替换
			const searchIndex = result.indexOf(searchText);
			if (searchIndex === -1) {
				console.warn('[Maxian] 未找到SEARCH文本:', searchText.substring(0, 50) + '...');
				// 尝试模糊匹配（忽略空白差异）
				const normalizedSearch = searchText.replace(/\s+/g, ' ').trim();
				const normalizedResult = result.replace(/\s+/g, ' ');
				const fuzzyIndex = normalizedResult.indexOf(normalizedSearch);

				if (fuzzyIndex === -1) {
					return null;
				}
			} else {
				result = result.substring(0, searchIndex) + replaceText + result.substring(searchIndex + searchText.length);
			}
		}

		if (!hasMatch) {
			console.warn('[Maxian] 未找到SEARCH/REPLACE块，将diff内容作为新文件内容处理');
			// 返回undefined表示没有SEARCH/REPLACE块，调用者应直接使用diff作为新内容
			return undefined;
		}

		return result;
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
