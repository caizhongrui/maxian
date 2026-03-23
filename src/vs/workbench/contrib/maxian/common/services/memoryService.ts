/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from '../../../../../base/common/path.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';

/**
 * 跨会话记忆服务
 *
 * 读写 .maxian/memory/auto-memory.md，将用户偏好、项目约定、常见模式等信息持久化。
 * 在系统提示词生成时注入记忆内容，供 AI 参考，实现跨会话记忆。
 */
export class MemoryService {
	private readonly memoryDir: string;
	private readonly memoryFile: string;

	constructor(
		cwd: string,
		private readonly fileService: IFileService
	) {
		this.memoryDir = join(cwd, '.maxian', 'memory');
		this.memoryFile = join(this.memoryDir, 'auto-memory.md');
	}

	/**
	 * 加载记忆文件内容
	 * @returns 记忆内容字符串，如果文件不存在则返回 undefined
	 */
	async loadMemory(): Promise<string | undefined> {
		try {
			const fileUri = URI.file(this.memoryFile);
			const exists = await this.fileService.exists(fileUri);
			if (!exists) {
				return undefined;
			}
			const content = await this.fileService.readFile(fileUri);
			const text = content.value.toString().trim();
			return text || undefined;
		} catch (error) {
			console.error('[MemoryService] 读取记忆文件失败:', error);
			return undefined;
		}
	}

	/**
	 * 手动保存记忆内容
	 * @param content 要保存的记忆内容（完整 Markdown 文本）
	 */
	async saveMemory(content: string): Promise<void> {
		try {
			const dirUri = URI.file(this.memoryDir);
			if (!(await this.fileService.exists(dirUri))) {
				await this.fileService.createFolder(dirUri);
			}
			const fileUri = URI.file(this.memoryFile);
			await this.fileService.writeFile(fileUri, VSBuffer.fromString(content));
			console.log('[MemoryService] 记忆文件已保存:', this.memoryFile);
		} catch (error) {
			console.error('[MemoryService] 保存记忆文件失败:', error);
		}
	}

	/**
	 * 在对话结束时，提取有价值的信息追加到记忆文件。
	 * 调用方应传入从对话中总结的内容（已经过 AI 或规则提取），
	 * 本方法负责格式化并写入文件。
	 *
	 * @param summaryContent 本次对话提取的记忆摘要（Markdown 格式的条目）
	 */
	async extractAndSaveMemory(summaryContent: string): Promise<void> {
		if (!summaryContent.trim()) {
			return;
		}

		try {
			const existing = await this.loadMemory();
			let newContent: string;

			if (existing) {
				// 追加到现有内容
				newContent = existing + '\n\n' + summaryContent.trim();
			} else {
				// 首次创建，使用标准模板
				newContent = `# 自动记忆 - 码弦

## 用户偏好
（从对话中提取）

## 项目约定
（从对话中提取）

## 常见模式
（从对话中提取）

---

${summaryContent.trim()}`;
			}

			await this.saveMemory(newContent);
		} catch (error) {
			console.error('[MemoryService] extractAndSaveMemory 失败:', error);
		}
	}

	/**
	 * 确保记忆目录和初始文件存在（若不存在则创建模板文件）
	 */
	async ensureInitialized(): Promise<void> {
		try {
			const dirUri = URI.file(this.memoryDir);
			if (!(await this.fileService.exists(dirUri))) {
				await this.fileService.createFolder(dirUri);
			}
			const fileUri = URI.file(this.memoryFile);
			if (!(await this.fileService.exists(fileUri))) {
				// 不创建空文件，让用户自己填充或由 extractAndSaveMemory 创建
				return;
			}
		} catch (error) {
			console.error('[MemoryService] ensureInitialized 失败:', error);
		}
	}

	/**
	 * 获取记忆文件路径
	 */
	getMemoryFilePath(): string {
		return this.memoryFile;
	}
}
