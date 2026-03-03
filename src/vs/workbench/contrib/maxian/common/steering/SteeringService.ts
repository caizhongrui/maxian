/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Inspired by Kiro's steering system (.kiro/steering/*.md)
// Adapted for tianhe-zhikai-ide: uses .maxian/steering/*.md

import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { fileExistsAtPath } from '../utils/fsUtils.js';

/**
 * Steering 文件的包含模式
 * - always: 始终包含在系统提示词中（默认）
 * - fileMatch: 当上下文中存在匹配指定模式的文件时包含
 * - manual: 仅当用户通过 # 引用时包含（不自动注入）
 */
export type SteeringInclusion = 'always' | 'fileMatch' | 'manual';

/**
 * 解析后的 Steering 文件
 */
export interface SteeringFile {
	/** 文件名（如 standards.md） */
	filename: string;
	/** 完整文件路径 */
	filepath: string;
	/** 包含模式 */
	inclusion: SteeringInclusion;
	/** fileMatch 模式下使用的文件匹配模式（glob） */
	fileMatchPattern?: string;
	/** 去除 front-matter 后的 Markdown 正文 */
	content: string;
}

/**
 * 解析 YAML front-matter
 *
 * 支持格式：
 * ```
 * ---
 * inclusion: always
 * ---
 * 正文内容
 * ```
 * 或：
 * ```
 * ---
 * inclusion: fileMatch
 * fileMatchPattern: '**\/*.ts'
 * ---
 * 正文内容
 * ```
 */
function parseFrontMatter(rawContent: string): { meta: Record<string, string>; body: string } {
	const frontMatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
	const match = rawContent.match(frontMatterRegex);

	if (!match) {
		return { meta: {}, body: rawContent };
	}

	const metaSection = match[1];
	const body = match[2] || '';
	const meta: Record<string, string> = {};

	for (const line of metaSection.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const colonIndex = trimmed.indexOf(':');
		if (colonIndex === -1) {
			continue;
		}
		const key = trimmed.slice(0, colonIndex).trim();
		// 去除首尾引号和空格
		const value = trimmed.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '');
		meta[key] = value;
	}

	return { meta, body };
}

/**
 * 简单的 glob 模式匹配
 * 支持 *, **, ? 通配符
 *
 * @param filePath 待匹配的文件路径（相对路径，使用 / 分隔）
 * @param pattern glob 模式字符串
 */
function matchesGlob(filePath: string, pattern: string): boolean {
	const normalizedPath = filePath.replace(/\\/g, '/');
	const normalizedPattern = pattern.replace(/\\/g, '/');

	// 将 glob 模式转换为正则表达式
	const regexStr = normalizedPattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')   // 转义正则特殊字符（保留 * 和 ?）
		.replace(/\*\*/g, '<<DOUBLE_STAR>>')      // 临时保存 **
		.replace(/\*/g, '[^/]*')                  // * 匹配非 / 的任意字符
		.replace(/\?/g, '[^/]')                   // ? 匹配单个非 / 字符
		.replace(/<<DOUBLE_STAR>>/g, '.*');        // ** 匹配任意字符（含 /）

	try {
		const regex = new RegExp(`^${regexStr}$`);
		return regex.test(normalizedPath);
	} catch {
		return false;
	}
}

/**
 * Steering 文件服务
 *
 * 管理工作区下 .maxian/steering/*.md 文件，根据文件的 front-matter 配置
 * 决定何时将其内容注入到系统提示词中。
 *
 * 支持三种包含模式（与 Kiro 保持一致）：
 * - always（默认）：始终注入
 * - fileMatch：当当前上下文中有与 fileMatchPattern 匹配的文件时注入
 * - manual：仅当用户显式引用（如在聊天输入 #steering-file）时注入，不自动注入
 *
 * Steering 文件支持文件引用语法：#[[file:<relative_file_name>]]
 * 此引用在注入时会被替换为对应文件的内容。
 *
 * @example
 * .maxian/steering/code-style.md:
 * ```
 * ---
 * inclusion: always
 * ---
 * # 代码风格规范
 * - 使用 2 空格缩进
 * - 不超过 100 字符每行
 * ```
 *
 * @example
 * .maxian/steering/typescript.md:
 * ```
 * ---
 * inclusion: fileMatch
 * fileMatchPattern: '**\/*.ts'
 * ---
 * # TypeScript 规范
 * - 必须标注函数参数类型
 * ```
 */
export class SteeringService {
	private readonly steeringDir: string;
	private steeringFiles: SteeringFile[] = [];
	private disposables: vscode.Disposable[] = [];
	private initialized = false;
	/** 每次加载或重新加载文件时递增，用于系统提示词缓存失效 */
	private loadVersion = 0;

	constructor(private readonly cwd: string) {
		this.steeringDir = path.join(cwd, '.maxian', 'steering');
		this.setupFileWatcher();
	}

	/**
	 * 初始化：扫描并加载所有 steering 文件
	 * 必须在构造后、使用前调用
	 */
	async initialize(): Promise<void> {
		await this.loadAllSteeringFiles();
		this.initialized = true;
	}

	/**
	 * 设置文件系统监听器
	 * 监听 .maxian/steering/*.md 的创建、修改、删除事件，自动重新加载
	 */
	private setupFileWatcher(): void {
		const steeringPattern = new vscode.RelativePattern(this.cwd, '.maxian/steering/*.md');
		const watcher = vscode.workspace.createFileSystemWatcher(steeringPattern);

		this.disposables.push(
			watcher.onDidChange(() => {
				console.log('[SteeringService] steering 文件已修改，重新加载');
				this.loadAllSteeringFiles();
			}),
			watcher.onDidCreate(() => {
				console.log('[SteeringService] 新 steering 文件已创建，重新加载');
				this.loadAllSteeringFiles();
			}),
			watcher.onDidDelete(() => {
				console.log('[SteeringService] steering 文件已删除，重新加载');
				this.loadAllSteeringFiles();
			}),
			watcher
		);
	}

	/**
	 * 扫描并加载 .maxian/steering/ 目录下的所有 .md 文件
	 */
	private async loadAllSteeringFiles(): Promise<void> {
		const loadedFiles: SteeringFile[] = [];

		try {
			if (!await fileExistsAtPath(this.steeringDir)) {
				this.steeringFiles = [];
				return;
			}

			const dirEntries = await fs.readdir(this.steeringDir, { withFileTypes: true });
			const mdFiles = dirEntries.filter(entry => entry.isFile() && entry.name.endsWith('.md'));

			for (const entry of mdFiles) {
				const filepath = path.join(this.steeringDir, entry.name);
				try {
					const rawContent = await fs.readFile(filepath, 'utf8');
					const { meta, body } = parseFrontMatter(rawContent);

					const inclusion = (meta['inclusion'] as SteeringInclusion | undefined) ?? 'always';
					const fileMatchPattern = meta['fileMatchPattern'];

					loadedFiles.push({
						filename: entry.name,
						filepath,
						inclusion,
						fileMatchPattern,
						content: body.trim()
					});
				} catch (error) {
					console.error(`[SteeringService] 无法读取 steering 文件 ${entry.name}:`, error);
				}
			}
		} catch (error) {
			console.error('[SteeringService] 加载 steering 文件目录失败:', error);
		}

		this.steeringFiles = loadedFiles;
		this.loadVersion++;
		if (loadedFiles.length > 0) {
			console.log(`[SteeringService] 已加载 ${loadedFiles.length} 个 steering 文件 (v${this.loadVersion}):`,
				loadedFiles.map(f => `${f.filename}(${f.inclusion})`).join(', '));
		}
	}

	/**
	 * 获取当前加载版本号
	 * 每次文件重新加载时递增，可用于系统提示词缓存失效判断
	 */
	getLoadVersion(): number {
		return this.loadVersion;
	}

	/**
	 * 获取当前激活的 steering 内容
	 *
	 * 根据每个文件的 inclusion 模式决定是否包含：
	 * - always：无条件包含
	 * - fileMatch：contextFiles 中有文件与 fileMatchPattern 匹配时包含
	 * - manual：不自动包含，通过 getManualContent() 按需获取
	 *
	 * @param contextFiles 当前上下文中的文件路径列表（绝对路径），用于 fileMatch 判断
	 * @returns 合并后的 steering 内容字符串，如果没有激活的内容则返回 undefined
	 */
	getActiveContent(contextFiles?: string[]): string | undefined {
		if (!this.initialized || this.steeringFiles.length === 0) {
			return undefined;
		}

		const activeEntries: Array<{ filename: string; content: string }> = [];

		for (const steeringFile of this.steeringFiles) {
			if (!steeringFile.content) {
				continue;
			}

			let shouldInclude = false;

			switch (steeringFile.inclusion) {
				case 'always':
					shouldInclude = true;
					break;

				case 'fileMatch':
					if (steeringFile.fileMatchPattern && contextFiles && contextFiles.length > 0) {
						shouldInclude = contextFiles.some(contextFile => {
							const relativePath = path.relative(this.cwd, contextFile).replace(/\\/g, '/');
							const basename = path.basename(contextFile);
							return matchesGlob(relativePath, steeringFile.fileMatchPattern!) ||
								matchesGlob(basename, steeringFile.fileMatchPattern!);
						});
					}
					break;

				case 'manual':
					// manual 模式不自动注入，通过 getManualContent() 按需获取
					shouldInclude = false;
					break;
			}

			if (shouldInclude) {
				activeEntries.push({
					filename: steeringFile.filename.replace(/\.md$/, ''),
					content: steeringFile.content
				});
			}
		}

		if (activeEntries.length === 0) {
			return undefined;
		}

		// 多个 steering 文件用分隔线隔开
		return activeEntries
			.map(entry => `### ${entry.filename}\n\n${entry.content}`)
			.join('\n\n---\n\n');
	}

	/**
	 * 获取指定 manual steering 文件的内容
	 * 用于用户通过 # 语法显式引用时
	 *
	 * @param filename 文件名（带或不带 .md 后缀均可）
	 * @returns 文件正文内容，不存在则返回 undefined
	 */
	getManualContent(filename: string): string | undefined {
		const normalizedName = filename.endsWith('.md') ? filename : `${filename}.md`;
		const file = this.steeringFiles.find(f =>
			f.filename === normalizedName && f.inclusion === 'manual'
		);
		return file?.content;
	}

	/**
	 * 获取所有已加载的 steering 文件列表（只读）
	 * 用于调试和文档生成
	 */
	getAllFiles(): readonly SteeringFile[] {
		return this.steeringFiles;
	}

	/**
	 * 释放资源，取消文件监听
	 */
	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.disposables = [];
	}
}
