/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 文件时间戳追踪器
 * 参考 OpenCode file/time.ts 实现
 *
 * 核心功能：
 * - 每个 session 独立追踪文件读取时间
 * - 写入前必须先读取，否则拒绝
 * - 文件被外部修改后要求重新读取
 * - 文件级锁序列化并发写入
 *
 * 作用：防止覆盖用户手动修改的内容，保证数据一致性
 */

/**
 * 文件读取时间记录
 */
interface FileReadTime {
	/** 读取时间 */
	readTime: Date;
	/** 文件修改时间（读取时的 mtime） */
	mtime: number;
	/** 文件大小（读取时） */
	size: number;
}

/**
 * 文件时间校验错误类型
 */
export enum FileTimeError {
	NOT_READ = 'NOT_READ',
	MODIFIED_EXTERNALLY = 'MODIFIED_EXTERNALLY',
	LOCK_TIMEOUT = 'LOCK_TIMEOUT',
}

/**
 * 文件时间校验结果
 */
export interface FileTimeAssertResult {
	success: boolean;
	error?: FileTimeError;
	message?: string;
}

/**
 * 文件时间追踪器配置
 */
export const FILE_TIME_CONFIG = {
	/** 锁等待超时时间（毫秒） */
	LOCK_TIMEOUT_MS: 30000, // 30秒

	/** 读取时间过期时间（毫秒） */
	READ_EXPIRE_MS: 3600000, // 1小时

	/** 是否强制要求先读取 */
	REQUIRE_READ_BEFORE_WRITE: true,
};

/**
 * 文件时间追踪器类
 */
export class FileTimeTracker {
	/** 每个会话的文件读取时间: sessionId -> filePath -> FileReadTime */
	private readTimes: Map<string, Map<string, FileReadTime>> = new Map();

	/** 文件锁: filePath -> Promise (当前持有锁的操作) */
	private fileLocks: Map<string, Promise<any>> = new Map();

	/**
	 * 记录文件读取
	 * @param sessionId 会话ID
	 * @param filePath 文件路径
	 * @param mtime 文件修改时间
	 * @param size 文件大小
	 */
	read(sessionId: string, filePath: string, mtime: number, size: number): void {
		if (!this.readTimes.has(sessionId)) {
			this.readTimes.set(sessionId, new Map());
		}

		const sessionTimes = this.readTimes.get(sessionId)!;
		sessionTimes.set(filePath, {
			readTime: new Date(),
			mtime,
			size,
		});

		console.log(`[FileTimeTracker] 记录文件读取: ${filePath} (session: ${sessionId})`);
	}

	/**
	 * 获取文件读取时间
	 * @param sessionId 会话ID
	 * @param filePath 文件路径
	 * @returns 读取时间信息，如果未读取过则返回 undefined
	 */
	get(sessionId: string, filePath: string): FileReadTime | undefined {
		const sessionTimes = this.readTimes.get(sessionId);
		if (!sessionTimes) return undefined;

		const readTime = sessionTimes.get(filePath);
		if (!readTime) return undefined;

		// 检查是否过期
		const now = Date.now();
		if (now - readTime.readTime.getTime() > FILE_TIME_CONFIG.READ_EXPIRE_MS) {
			sessionTimes.delete(filePath);
			return undefined;
		}

		return readTime;
	}

	/**
	 * 验证文件未被外部修改
	 * @param sessionId 会话ID
	 * @param filePath 文件路径
	 * @param currentMtime 当前文件修改时间
	 * @param currentSize 当前文件大小（可选）
	 * @returns 校验结果
	 */
	assert(
		sessionId: string,
		filePath: string,
		currentMtime: number,
		currentSize?: number
	): FileTimeAssertResult {
		const readTime = this.get(sessionId, filePath);

		// 检查是否先读取过
		if (!readTime) {
			if (FILE_TIME_CONFIG.REQUIRE_READ_BEFORE_WRITE) {
				return {
					success: false,
					error: FileTimeError.NOT_READ,
					message: `必须先读取文件 ${filePath} 才能修改。请使用 read_file 工具先读取文件内容。`,
				};
			}
			// 如果不强制要求，允许写入
			return { success: true };
		}

		// 检查文件是否被外部修改
		if (currentMtime > readTime.mtime) {
			return {
				success: false,
				error: FileTimeError.MODIFIED_EXTERNALLY,
				message: `文件 ${filePath} 在上次读取后已被外部修改。请重新使用 read_file 读取最新内容后再进行修改。`,
			};
		}

		// 可选：检查文件大小变化（额外保护）
		if (currentSize !== undefined && currentSize !== readTime.size) {
			return {
				success: false,
				error: FileTimeError.MODIFIED_EXTERNALLY,
				message: `文件 ${filePath} 大小已变化（原: ${readTime.size}, 现: ${currentSize}）。请重新读取文件。`,
			};
		}

		return { success: true };
	}

	/**
	 * 带锁执行文件操作
	 * 确保同一文件的写入操作串行执行
	 * @param filePath 文件路径
	 * @param fn 要执行的操作
	 * @returns 操作结果
	 */
	async withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
		// 等待当前锁释放
		const currentLock = this.fileLocks.get(filePath);
		if (currentLock) {
			try {
				await Promise.race([
					currentLock,
					new Promise((_, reject) =>
						setTimeout(() => reject(new Error('Lock timeout')), FILE_TIME_CONFIG.LOCK_TIMEOUT_MS)
					),
				]);
			} catch (error) {
				// 锁超时或其他错误，继续尝试获取锁
				console.warn(`[FileTimeTracker] 等待文件锁超时: ${filePath}`);
			}
		}

		// 创建新锁
		const operation = fn();
		this.fileLocks.set(filePath, operation);

		try {
			return await operation;
		} finally {
			// 释放锁
			if (this.fileLocks.get(filePath) === operation) {
				this.fileLocks.delete(filePath);
			}
		}
	}

	/**
	 * 更新文件读取时间（写入后调用）
	 * @param sessionId 会话ID
	 * @param filePath 文件路径
	 * @param mtime 新的修改时间
	 * @param size 新的文件大小
	 */
	updateAfterWrite(sessionId: string, filePath: string, mtime: number, size: number): void {
		this.read(sessionId, filePath, mtime, size);
	}

	/**
	 * 清除文件的读取记录
	 * @param sessionId 会话ID
	 * @param filePath 文件路径
	 */
	invalidate(sessionId: string, filePath: string): void {
		const sessionTimes = this.readTimes.get(sessionId);
		if (sessionTimes) {
			sessionTimes.delete(filePath);
		}
	}

	/**
	 * 清除会话的所有读取记录
	 * @param sessionId 会话ID
	 */
	clearSession(sessionId: string): void {
		this.readTimes.delete(sessionId);
	}

	/**
	 * 清除所有记录
	 */
	clearAll(): void {
		this.readTimes.clear();
		this.fileLocks.clear();
	}

	/**
	 * 获取会话的文件读取统计
	 * @param sessionId 会话ID
	 */
	getSessionStats(sessionId: string): {
		trackedFiles: number;
		fileList: string[];
	} {
		const sessionTimes = this.readTimes.get(sessionId);
		if (!sessionTimes) {
			return { trackedFiles: 0, fileList: [] };
		}

		return {
			trackedFiles: sessionTimes.size,
			fileList: Array.from(sessionTimes.keys()),
		};
	}

	/**
	 * 检查文件是否已读取
	 * @param sessionId 会话ID
	 * @param filePath 文件路径
	 */
	hasRead(sessionId: string, filePath: string): boolean {
		return this.get(sessionId, filePath) !== undefined;
	}
}

/**
 * 全局文件时间追踪器实例
 */
export const globalFileTimeTracker = new FileTimeTracker();

/**
 * 便捷函数：记录文件读取
 */
export function trackFileRead(sessionId: string, filePath: string, mtime: number, size: number): void {
	globalFileTimeTracker.read(sessionId, filePath, mtime, size);
}

/**
 * 便捷函数：验证文件可写入
 */
export function assertFileWritable(
	sessionId: string,
	filePath: string,
	currentMtime: number,
	currentSize?: number
): FileTimeAssertResult {
	return globalFileTimeTracker.assert(sessionId, filePath, currentMtime, currentSize);
}

/**
 * 便捷函数：带锁执行文件操作
 */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
	return globalFileTimeTracker.withLock(filePath, fn);
}

/**
 * 便捷函数：更新写入后的时间记录
 */
export function updateFileAfterWrite(sessionId: string, filePath: string, mtime: number, size: number): void {
	globalFileTimeTracker.updateAfterWrite(sessionId, filePath, mtime, size);
}

/**
 * 便捷函数：清除会话记录
 */
export function clearFileTimeSession(sessionId: string): void {
	globalFileTimeTracker.clearSession(sessionId);
}
