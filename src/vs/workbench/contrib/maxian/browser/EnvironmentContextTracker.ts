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
	constructor(
		private readonly editorService: IEditorService,
		private readonly terminalService: ITerminalService,
		private readonly workspaceService: IWorkspaceContextService
	) {}

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
			const isRunning = terminal.processReady;

			activeTerminals.push({
				id: terminal.instanceId.toString(),
				name: terminal.title,
				isRunning,
				processId: undefined  // VSCode内部API限制
			});
		}

		return activeTerminals.filter(t => t.isRunning);
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
