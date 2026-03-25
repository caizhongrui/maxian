/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 向量索引文件监听器
 * - 文件保存时：增量更新该文件的向量索引
 * - 文件删除时：删除该文件的向量索引条目
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IVectorSearchService } from '../common/vector/IVectorSearchService.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { extname } from '../../../../base/common/path.js';

/**
 * 可索引的文件扩展名（与 codebaseIndexer.ts 的 INDEXABLE_EXTENSIONS 保持一致）
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
 * 跳过模式（与 codebaseIndexer.ts 保持一致）
 */
const SKIP_FILE_PATTERNS = [
	/\.min\.(js|css)$/,
	/\.bundle\.js$/,
	/\.map$/,
	/\.lock$/,
	/package-lock\.json$/,
	/yarn\.lock$/,
	/\.d\.ts$/,
	/\.class$/,
	/\.jar$/,
	/\.pyc$/,
];

export class VectorIndexFileWatcherContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.maxian.vectorIndexFileWatcher';

	/** 防抖 timer：避免同一文件短时间内多次触发 */
	private readonly _saveDebounceMap = new Map<string, ReturnType<typeof setTimeout>>();
	/** 防抖延迟（ms） */
	private static readonly DEBOUNCE_MS = 2000;

	constructor(
		@IVectorSearchService private readonly _vectorSearchService: IVectorSearchService,
		@IWorkspaceContextService private readonly _workspaceService: IWorkspaceContextService,
		@ITextFileService private readonly _textFileService: ITextFileService,
		@IFileService private readonly _fileService: IFileService,
	) {
		super();
		this._registerListeners();
	}

	private _getCwd(): string | undefined {
		const folders = this._workspaceService.getWorkspace().folders;
		return folders[0]?.uri.fsPath;
	}

	private _registerListeners(): void {
		// 监听文件保存事件 → 增量更新向量索引
		this._register(
			this._textFileService.files.onDidSave((e) => {
				const filePath = e.model.resource.fsPath;
				const cwd = this._getCwd();
				if (!cwd || !this._shouldIndex(filePath, cwd)) {
					return;
				}
				this._debounceIndexFile(filePath, cwd);
			})
		);

		// 监听文件系统变更事件 → 删除已删除文件的索引条目
		this._register(
			this._fileService.onDidFilesChange((e) => {
				const cwd = this._getCwd();
				if (!cwd || e.rawDeleted.length === 0) {
					return;
				}
				// rawDeleted 是 URI[]，直接遍历
				for (const uri of e.rawDeleted) {
					const filePath = uri.fsPath;
					if (this._shouldIndex(filePath, cwd)) {
						this._deleteFileIndex(filePath, cwd);
					}
				}
			})
		);
	}

	/**
	 * 判断文件是否需要索引（在工作区内 + 扩展名匹配 + 不在跳过模式中）
	 */
	private _shouldIndex(filePath: string, cwd: string): boolean {
		// 必须在工作区内
		if (!filePath.startsWith(cwd)) {
			return false;
		}

		// 跳过 .maxian 目录
		if (filePath.includes('/.maxian/') || filePath.includes('\\.maxian\\')) {
			return false;
		}

		const ext = extname(filePath).toLowerCase();
		if (!INDEXABLE_EXTENSIONS.has(ext)) {
			return false;
		}

		const fileName = filePath.split('/').pop() || '';
		if (SKIP_FILE_PATTERNS.some(p => p.test(fileName))) {
			return false;
		}

		return true;
	}

	/**
	 * 防抖：同一文件 2s 内多次保存只触发一次索引
	 */
	private _debounceIndexFile(filePath: string, cwd: string): void {
		const existing = this._saveDebounceMap.get(filePath);
		if (existing) {
			clearTimeout(existing);
		}
		const timer = setTimeout(() => {
			this._saveDebounceMap.delete(filePath);
			this._indexFile(filePath, cwd);
		}, VectorIndexFileWatcherContribution.DEBOUNCE_MS);
		this._saveDebounceMap.set(filePath, timer);
	}

	private _indexFile(filePath: string, cwd: string): void {
		this._vectorSearchService.indexFile(filePath, cwd).then(() => {
			console.log('[VectorIndexWatcher] 文件索引已更新:', filePath);
		}).catch((err) => {
			console.warn('[VectorIndexWatcher] 文件索引更新失败:', filePath, err);
		});
	}

	private _deleteFileIndex(filePath: string, cwd: string): void {
		this._vectorSearchService.deleteFileIndex(filePath, cwd).then(() => {
			console.log('[VectorIndexWatcher] 文件索引已删除:', filePath);
		}).catch((err) => {
			console.warn('[VectorIndexWatcher] 文件索引删除失败:', filePath, err);
		});
	}

	override dispose(): void {
		// 清理所有防抖 timer
		for (const timer of this._saveDebounceMap.values()) {
			clearTimeout(timer);
		}
		this._saveDebounceMap.clear();
		super.dispose();
	}
}
