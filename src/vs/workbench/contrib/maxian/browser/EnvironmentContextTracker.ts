/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 环境上下文跟踪器（Browser层）
 * 使用VSCode Service接口而不是直接导入vscode模块
 */

import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { FileStateCache } from '../common/file/fileStateCache.js';

/**
 * 终端信息接口
 */
export interface TerminalInfo {
	id: string;
	name: string;
	isRunning: boolean;
	processId?: number | undefined;
}

/**
 * 环境上下文跟踪器
 * 通过依赖注入获取编辑器、终端等服务
 */
export class EnvironmentContextTracker {
	private fileStateCache?: FileStateCache;

	constructor(
		private readonly editorService: IEditorService,
		private readonly terminalService: ITerminalService,
		private readonly workspaceService: IWorkspaceContextService
	) {}

	/**
	 * 注入当前任务的 FileStateCache，用于在 environment_details 中生成
	 * "已读文件上下文清单"。由 MaxianService 在创建 ToolExecutor 后调用。
	 */
	setFileStateCache(cache: FileStateCache): void {
		this.fileStateCache = cache;
	}

	/**
	 * 获取当前可见的文件
	 */
	async getVisibleFiles(): Promise<string[]> {
		const editors = this.editorService.visibleEditors;
		const files: string[] = [];

		for (const editor of editors) {
			const resource = editor.resource;
			if (resource && resource.scheme === 'file') {
				const fsPath = resource.fsPath;
				if (!fsPath.includes('.git') && !fsPath.includes('node_modules')) {
					files.push(this.getRelativePath(fsPath));
				}
			}
		}

		return [...new Set(files)];
	}

	/**
	 * 获取所有打开的标签
	 */
	async getOpenTabs(): Promise<string[]> {
		// 简化实现：使用visibleEditors
		// VSCode源码中访问tabGroups需要更复杂的service
		return await this.getVisibleFiles();
	}

	/**
	 * 获取活跃终端信息
	 */
	async getActiveTerminals(): Promise<TerminalInfo[]> {
		const terminals = this.terminalService.instances;
		const activeTerminals: TerminalInfo[] = [];

		for (const terminal of terminals) {
			// 简化：假设所有存在的终端都是运行中的
			// VSCode内部API对终端状态的访问有限制
			activeTerminals.push({
				id: terminal.instanceId.toString(),
				name: terminal.title,
				isRunning: true,  // 简化实现
				processId: undefined
			});
		}

		return activeTerminals;
	}

	/**
	 * 获取相对路径
	 */
	private getRelativePath(absolutePath: string): string {
		const workspace = this.workspaceService.getWorkspace();
		const workspaceRoot = workspace.folders[0]?.uri.fsPath;

		if (!workspaceRoot) {
			return absolutePath;
		}

		try {
			// 简单的相对路径计算
			if (absolutePath.startsWith(workspaceRoot)) {
				return absolutePath.substring(workspaceRoot.length + 1);
			}
			return absolutePath;
		} catch {
			return absolutePath;
		}
	}

	/**
	 * 生成完整的 environment_details
	 */
	async generateEnvironmentDetails(recentlyModifiedFiles?: string[]): Promise<string> {
		const sections: string[] = [];

		// 1. 可见文件
		const visibleFiles = await this.getVisibleFiles();
		if (visibleFiles.length > 0) {
			sections.push(`## 可见文件\n${visibleFiles.map(f => `- ${f}`).join('\n')}`);
		}

		// 2. 打开的标签
		const openTabs = await this.getOpenTabs();
		if (openTabs.length > 0) {
			const otherTabs = openTabs.filter(t => !visibleFiles.includes(t));
			if (otherTabs.length > 0) {
				sections.push(`## 打开的标签\n${otherTabs.slice(0, 10).map(f => `- ${f}`).join('\n')}`);
			}
		}

		// 3. 活跃终端
		const terminals = await this.getActiveTerminals();
		if (terminals.length > 0) {
			const terminalInfo = terminals.map(t =>
				`- ${t.name}: 运行中`
			).join('\n');
			sections.push(`## 活跃终端\n${terminalInfo}\n\n⚠️ 注意：执行命令前检查是否有相关服务正在运行，避免重复启动`);
		}

		// 4. 最近修改的文件
		if (recentlyModifiedFiles && recentlyModifiedFiles.length > 0) {
			sections.push(`## 最近修改的文件\n${recentlyModifiedFiles.map(f => `- ${f}`).join('\n')}\n\n⚠️ 这些文件可能需要重新读取`);
		}

		// 4.5 已读文件上下文清单（复用判断依据）
		if (this.fileStateCache) {
			const workspace = this.workspaceService.getWorkspace();
			const workspaceRoot = workspace.folders[0]?.uri.fsPath;
			const manifest = this.fileStateCache.buildManifest(workspaceRoot);
			if (manifest.unchanged.length > 0 || manifest.modifiedByTool.length > 0 || manifest.partial.length > 0) {
				const parts: string[] = ['## 已读文件上下文（复用规则）'];
				if (manifest.unchanged.length > 0) {
					parts.push(`### ✅ 历史中已有完整内容，禁止重新 read_file：\n${manifest.unchanged.map(f => `- ${f}`).join('\n')}`);
				}
				if (manifest.modifiedByTool.length > 0) {
					parts.push(`### ⚠️ 你已通过工具修改过（历史是旧内容），若需当前完整状态必须重新 read_file：\n${manifest.modifiedByTool.map(f => `- ${f}`).join('\n')}`);
				}
				if (manifest.partial.length > 0) {
					parts.push(`### ⚠️ 历史中只看过局部内容，改其他范围前需要补读：\n${manifest.partial.map(f => `- ${f}`).join('\n')}`);
				}
				parts.push('**规则**：列在"✅"下的文件，直接引用对话历史中已有内容来构造 edit/multiedit 的 old_string，不要再 read_file。');
				sections.push(parts.join('\n\n'));
			}
		}

		// 5. 当前时间
		sections.push(`## 当前时间\n${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);

		// 6. 工作区信息
		const workspace = this.workspaceService.getWorkspace();
		if (workspace.folders.length > 0) {
			const workspaceName = workspace.folders[0].name;
			sections.push(`## 工作目录\n${workspaceName}`);
		}

		if (sections.length === 0) {
			return '';
		}

		return `<environment_details>\n\n${sections.join('\n\n')}\n\n</environment_details>`;
	}

	/**
	 * 生成简化版environment_details
	 */
	async generateCompactEnvironmentDetails(): Promise<string> {
		const sections: string[] = [];

		const visibleFiles = await this.getVisibleFiles();
		if (visibleFiles.length > 0) {
			sections.push(`可见文件: ${visibleFiles.join(', ')}`);
		}

		const terminals = await this.getActiveTerminals();
		if (terminals.length > 0) {
			sections.push(`活跃终端: ${terminals.map(t => t.name).join(', ')}`);
		}

		if (sections.length === 0) {
			return '';
		}

		return `[环境] ${sections.join(' | ')}`;
	}
}
