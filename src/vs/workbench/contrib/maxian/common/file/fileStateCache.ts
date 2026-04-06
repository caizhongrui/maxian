/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type FileModelViewKind = 'full' | 'partial' | 'derived' | 'unseen';
export type FileMutationReadinessReason = 'ok' | 'not_read' | 'partial_view' | 'modified_since_read';

/**
 * D2: readFileState 内存缓存
 *
 * 每个 Agent 会话共享一个 FileStateCache 实例，在读取和写入文件后
 * 更新缓存。缓存里保存的是“当前已知文件版本”的全文内容，另外单独记录
 * 模型是否真的看过这个版本，以及看到的是全文还是局部。
 *
 * 这样可以把两件事彻底分开：
 * - 文件内容是否已缓存
 * - 模型是否已看过当前版本全文
 *
 * 收益：
 * - edit/multiedit 时 readRawFileContent 走缓存，每次 edit 少 1 次磁盘读
 * - readFile 只有在模型已看过当前版本全文时才返回 FILE_UNCHANGED_STUB
 * - isPartialView 追踪当前版本是否仅被模型局部查看过，避免基于残缺上下文继续改
 * - derived 视图表示当前版本刚由模型通过 edit/multiedit/apply_diff 推导并写出，
 *   可继续 mutation，但不等于“模型已完整看过当前全文”
 */

/**
 * 单个文件的缓存条目
 */
export interface FileStateEntry {
	/** 文件的原始文本内容（无行号、无 XML 包装） */
	content: string;
	/** 缓存时的磁盘 mtime（毫秒） */
	mtime: number;
	/** 缓存时的磁盘 size（字节） */
	size: number;
	/** 当前缓存内容对应的版本号（任务内单调递增） */
	version: number;
	/**
	 * 当前版本是否仅被模型局部查看过（B4）
	 * true = 模型最近一次看到当前版本时只看了部分范围
	 */
	isPartialView: boolean;
	/** 模型最近一次查看当前版本时的视图类型 */
	lastModelViewKind: FileModelViewKind;
	/** 模型最近一次查看的是哪个版本 */
	lastModelViewVersion?: number;
	/** 局部视图的起始行（1-based，仅当前版本为 partial 时有效） */
	startLine?: number;
	/** 局部视图的结束行（1-based，仅当前版本为 partial 时有效） */
	endLine?: number;
}

export interface FileMutationReadiness {
	ok: boolean;
	reason: FileMutationReadinessReason;
	entry?: FileStateEntry;
}

/**
 * FILE_UNCHANGED_STUB
 *
 * 当文件自上次读取后未被修改，readFile 返回此存根代替完整内容。
 * 约 20 tokens，相比返回完整文件节省 50-500 tokens。
 */
export const FILE_UNCHANGED_STUB = `<file_unchanged>
This file has not been modified since you last read it. The content is identical to what you previously read.
If you need to make edits, you can proceed directly — you already have the full content.
</file_unchanged>`;

/**
 * 文件状态内存缓存
 *
 * 生命周期：与 Agent 任务实例绑定（单次任务内共享，任务结束后丢弃）。
 * 线程安全：JS 单线程，无需加锁。
 */
export class FileStateCache {
	private readonly cache = new Map<string, FileStateEntry>();

	private buildNextEntry(
		absolutePath: string,
		base: Omit<FileStateEntry, 'version' | 'isPartialView' | 'lastModelViewKind' | 'lastModelViewVersion'>,
		viewKind: FileModelViewKind,
		range?: { startLine?: number; endLine?: number }
	): FileStateEntry {
		const previous = this.cache.get(absolutePath);
		const contentUnchanged = previous &&
			previous.mtime === base.mtime &&
			previous.size === base.size &&
			previous.content === base.content;
		const version = contentUnchanged ? previous.version : (previous?.version ?? 0) + 1;
		const lastModelViewKind = viewKind === 'unseen' ? (previous?.lastModelViewKind ?? 'unseen') : viewKind;
		const lastModelViewVersion = viewKind === 'unseen'
			? previous?.lastModelViewVersion
			: version;
		const isCurrentVersionVisible = lastModelViewVersion === version && lastModelViewKind !== 'unseen';
		const isPartialView = isCurrentVersionVisible && lastModelViewKind === 'partial';

		return {
			...base,
			version,
			isPartialView,
			lastModelViewKind,
			lastModelViewVersion,
			startLine: isPartialView ? range?.startLine : undefined,
			endLine: isPartialView ? range?.endLine : undefined,
		};
	}

	/**
	 * 写入/更新缓存
	 */
	set(absolutePath: string, entry: FileStateEntry): void {
		this.cache.set(absolutePath, entry);
	}

	/**
	 * 模型读取了当前版本全文。
	 */
	recordFullModelRead(absolutePath: string, base: Omit<FileStateEntry, 'version' | 'isPartialView' | 'lastModelViewKind' | 'lastModelViewVersion' | 'startLine' | 'endLine'>): FileStateEntry {
		const entry = this.buildNextEntry(absolutePath, base, 'full');
		this.cache.set(absolutePath, entry);
		return entry;
	}

	/**
	 * 模型只读取了当前版本的部分内容。
	 */
	recordPartialModelRead(
		absolutePath: string,
		base: Omit<FileStateEntry, 'version' | 'isPartialView' | 'lastModelViewKind' | 'lastModelViewVersion' | 'startLine' | 'endLine'>,
		range: { startLine?: number; endLine?: number }
	): FileStateEntry {
		const entry = this.buildNextEntry(absolutePath, base, 'partial', range);
		this.cache.set(absolutePath, entry);
		return entry;
	}

	recordDerivedModelWrite(
		absolutePath: string,
		base: Omit<FileStateEntry, 'version' | 'isPartialView' | 'lastModelViewKind' | 'lastModelViewVersion' | 'startLine' | 'endLine'>
	): FileStateEntry {
		const entry = this.buildNextEntry(absolutePath, base, 'derived');
		this.cache.set(absolutePath, entry);
		return entry;
	}

	/**
	 * 内部工具读取或刷新了文件全文，但模型并没有看到这个版本。
	 */
	recordInternalRefresh(absolutePath: string, base: Omit<FileStateEntry, 'version' | 'isPartialView' | 'lastModelViewKind' | 'lastModelViewVersion' | 'startLine' | 'endLine'>): FileStateEntry {
		const entry = this.buildNextEntry(absolutePath, base, 'unseen');
		this.cache.set(absolutePath, entry);
		return entry;
	}

	/**
	 * 文件被工具写入了新版本，模型尚未重新看到该版本全文。
	 */
	recordWrite(
		absolutePath: string,
		base: Omit<FileStateEntry, 'version' | 'isPartialView' | 'lastModelViewKind' | 'lastModelViewVersion' | 'startLine' | 'endLine'>,
		modelVisible: boolean | 'derived' = true
	): FileStateEntry {
		if (modelVisible === 'derived') {
			return this.recordDerivedModelWrite(absolutePath, base);
		}
		return modelVisible
			? this.recordFullModelRead(absolutePath, base)
			: this.recordInternalRefresh(absolutePath, base);
	}

	/**
	 * 读取缓存条目（不存在返回 undefined）
	 */
	get(absolutePath: string): FileStateEntry | undefined {
		return this.cache.get(absolutePath);
	}

	/**
	 * 判断缓存内容是否仍与磁盘版本一致。
	 */
	isFresh(absolutePath: string, mtime: number, size: number): boolean {
		const entry = this.cache.get(absolutePath);
		return !!entry && entry.mtime === mtime && entry.size === size;
	}

	/**
	 * 只有模型已经看过当前版本全文时，才能返回 unchanged stub。
	 * derived 仅表示“可继续编辑”，不表示模型拥有当前版本的完整文本。
	 */
	shouldReturnUnchangedStub(absolutePath: string, mtime: number, size: number): boolean {
		const entry = this.cache.get(absolutePath);
		if (!entry || !this.isFresh(absolutePath, mtime, size)) {
			return false;
		}
		return entry.lastModelViewKind === 'full' && entry.lastModelViewVersion === entry.version;
	}

	getMutationReadiness(absolutePath: string, mtime: number, size: number): FileMutationReadiness {
		const entry = this.cache.get(absolutePath);
		if (!entry || entry.lastModelViewVersion === undefined) {
			return { ok: false, reason: 'not_read' };
		}

		if (!this.isFresh(absolutePath, mtime, size) || entry.lastModelViewVersion !== entry.version) {
			return { ok: false, reason: 'modified_since_read', entry };
		}

		if (entry.lastModelViewKind === 'partial') {
			return { ok: false, reason: 'partial_view', entry };
		}

		if (entry.lastModelViewKind !== 'full' && entry.lastModelViewKind !== 'derived') {
			return { ok: false, reason: 'not_read', entry };
		}

		return { ok: true, reason: 'ok', entry };
	}

	/**
	 * 删除指定文件的缓存（文件被删除时调用）
	 */
	delete(absolutePath: string): void {
		this.cache.delete(absolutePath);
	}

	/**
	 * 判断缓存中是否有指定文件
	 */
	has(absolutePath: string): boolean {
		return this.cache.has(absolutePath);
	}

	/**
	 * 清空所有缓存（任务重置时调用）
	 */
	clear(): void {
		this.cache.clear();
	}

	/**
	 * 缓存条目数（用于调试）
	 */
	get size(): number {
		return this.cache.size;
	}
}
