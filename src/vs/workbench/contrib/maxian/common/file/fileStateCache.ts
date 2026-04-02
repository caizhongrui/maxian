/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * D2: readFileState 内存缓存
 *
 * 每个 Agent 会话共享一个 FileStateCache 实例，在读取和写入文件后
 * 更新缓存。下次读取相同文件时，若磁盘内容未变则直接返回缓存，
 * 无需再次读取磁盘（零磁盘 IO）。
 *
 * 收益：
 * - edit/multiedit 时 readRawFileContent 走缓存，每次 edit 少 1 次磁盘读
 * - readFile 重复读未变文件返回 FILE_UNCHANGED_STUB（B3），消除 DUPLICATE_READ FATAL
 * - isPartialView 追踪，后续可用于拦截基于局部视图的编辑（B4）
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
	/**
	 * 是否为局部视图（B4）
	 * true = 最后一次读取指定了 start_line/end_line，内容不完整
	 */
	isPartialView: boolean;
	/** 局部视图的起始行（1-based，仅 isPartialView=true 时有效） */
	startLine?: number;
	/** 局部视图的结束行（1-based，仅 isPartialView=true 时有效） */
	endLine?: number;
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

	/**
	 * 写入/更新缓存
	 */
	set(absolutePath: string, entry: FileStateEntry): void {
		this.cache.set(absolutePath, entry);
	}

	/**
	 * 读取缓存条目（不存在返回 undefined）
	 */
	get(absolutePath: string): FileStateEntry | undefined {
		return this.cache.get(absolutePath);
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
