/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';

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
 * 负责收集IDE环境信息，包括：
 * - 可见文件
 * - 打开的标签
 * - 活跃终端
 * - 工作区信息
 */
export class EnvironmentContextTracker {
	private cwd: string | undefined;

	constructor() {
		this.cwd = this.getCwd();
	}

	/**
	 * 获取当前工作目录
	 */
	private getCwd(): string | undefined {
		return vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0);
	}

	/**
	 * 获取相对路径
	 */
	private getRelativePath(absolutePath: string): string {
		if (!this.cwd) {
			return absolutePath;
		}
		try {
			const rel = path.relative(this.cwd, absolutePath);
			// 如果相对路径以..开头，说明文件在工作区外，返回绝对路径
			if (rel.startsWith('..')) {
				return absolutePath;
			}
			return rel;
		} catch {
			return absolutePath;
		}
	}

	/**
	 * 获取当前可见的文件
	 * Cline重点：用户正在查看的文件
	 */
	async getVisibleFiles(): Promise<string[]> {
		const visibleEditors = vscode.window.visibleTextEditors;
		const files = visibleEditors
			.map(editor => this.getRelativePath(editor.document.uri.fsPath))
			.filter(f => !f.includes('.git') && !f.includes('node_modules'));

		return [...new Set(files)]; // 去重
	}

	/**
	 * 获取所有打开的标签
	 * Cline重点：所有打开的文件，不只是可见的
	 */
	async getOpenTabs(): Promise<string[]> {
		const tabs: string[] = [];

		// 遍历所有标签组
		for (const tabGroup of vscode.window.tabGroups.all) {
			for (const tab of tabGroup.tabs) {
				if (tab.input instanceof vscode.TabInputText) {
					const filePath = this.getRelativePath(tab.input.uri.fsPath);
					if (!filePath.includes('.git') && !filePath.includes('node_modules')) {
						tabs.push(filePath);
					}
				}
			}
		}

		return [...new Set(tabs)]; // 去重
	}

	/**
	 * 获取活跃终端信息
	 * ⭐ Cline特别强调：这是environment_details中最重要的信息！
	 * 用于避免重复启动服务（如dev server已在运行）
	 */
	async getActiveTerminals(): Promise<TerminalInfo[]> {
		const terminals = vscode.window.terminals;
		const activeTerminals: TerminalInfo[] = [];

		for (const terminal of terminals) {
			// 检查终端是否有正在运行的进程
			// 注意：VSCode API限制，我们无法直接获取终端命令和输出
			// 但可以通过exitStatus判断终端是否活跃
			const isRunning = !terminal.exitStatus;

			// processId是异步的，需要await
			const processId = await terminal.processId;

			activeTerminals.push({
				id: terminal.name,
				name: terminal.name,
				isRunning,
				processId
			});
		}

		return activeTerminals.filter(t => t.isRunning);
	}

	/**
	 * 生成完整的 environment_details
	 * 这个方法会被添加到每个用户消息的末尾
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
			// 只显示与可见文件不同的标签
			const otherTabs = openTabs.filter(t => !visibleFiles.includes(t));
			if (otherTabs.length > 0) {
				sections.push(`## 打开的标签\n${otherTabs.slice(0, 10).map(f => `- ${f}`).join('\n')}`);
				if (otherTabs.length > 10) {
					sections.push(`还有 ${otherTabs.length - 10} 个打开的标签...`);
				}
			}
		}

		// 3. 活跃终端 ⭐ 重要！
		const terminals = await this.getActiveTerminals();
		if (terminals.length > 0) {
			const terminalInfo = terminals.map(t =>
				`- ${t.name}${t.processId ? ` (PID: ${t.processId})` : ''}: 运行中`
			).join('\n');
			sections.push(`## 活跃终端\n${terminalInfo}\n\n⚠️ 注意：执行命令前检查是否有相关服务正在运行，避免重复启动`);
		}

		// 4. 最近修改的文件（由外部传入）
		if (recentlyModifiedFiles && recentlyModifiedFiles.length > 0) {
			sections.push(`## 最近修改的文件\n${recentlyModifiedFiles.map(f => `- ${f}`).join('\n')}\n\n⚠️ 这些文件可能需要重新读取`);
		}

		// 5. 当前时间
		sections.push(`## 当前时间\n${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);

		// 6. 工作区信息
		if (this.cwd) {
			sections.push(`## 工作目录\n${path.basename(this.cwd)}`);
		}

		if (sections.length === 0) {
			return '';
		}

		return `<environment_details>\n\n${sections.join('\n\n')}\n\n</environment_details>`;
	}

	/**
	 * 生成简化版environment_details（用于上下文压缩后）
	 */
	async generateCompactEnvironmentDetails(): Promise<string> {
		const sections: string[] = [];

		// 只包含最关键的信息
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
