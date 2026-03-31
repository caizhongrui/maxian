/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * MCP Hub：管理多个 MCP 服务器连接
 * 提供统一的工具调用和资源访问接口
 */

import { McpServerConfig, McpServerInfo, McpTool, McpToolCallResponse, McpResourceReadResponse } from './McpTypes.js';
import { McpClient } from './McpClient.js';

export type McpHubChangeListener = (servers: McpServerInfo[]) => void;

export class McpHub {
	private servers: Map<string, McpServerInfo> = new Map();
	private clients: Map<string, McpClient> = new Map();
	private changeListeners: McpHubChangeListener[] = [];

	/**
	 * 获取所有服务器状态
	 */
	getAllServers(): McpServerInfo[] {
		return Array.from(this.servers.values());
	}

	/**
	 * 获取指定服务器状态
	 */
	getServer(name: string): McpServerInfo | undefined {
		return this.servers.get(name);
	}

	/**
	 * 注册变化监听器
	 */
	onDidChange(listener: McpHubChangeListener): () => void {
		this.changeListeners.push(listener);
		return () => {
			const idx = this.changeListeners.indexOf(listener);
			if (idx >= 0) this.changeListeners.splice(idx, 1);
		};
	}

	private notifyChange(): void {
		const servers = this.getAllServers();
		this.changeListeners.forEach(l => l(servers));
	}

	/**
	 * 连接（或重连）指定服务器
	 */
	async connectServer(config: McpServerConfig): Promise<McpServerInfo> {
		const existing = this.servers.get(config.name);
		const info: McpServerInfo = {
			config,
			tools: existing?.tools || [],
			resources: existing?.resources || [],
			resourceTemplates: existing?.resourceTemplates || [],
			isConnected: false,
			isConnecting: true,
			error: undefined,
			sessionId: undefined,
		};
		this.servers.set(config.name, info);
		this.notifyChange();

		try {
			const client = new McpClient(config);
			this.clients.set(config.name, client);

			// 初始化连接
			await client.initialize();

			// 获取工具列表
			const tools = await client.listTools();

			// 尝试获取资源列表
			const { resources, resourceTemplates } = await client.listResources();

			const connected: McpServerInfo = {
				config,
				tools,
				resources,
				resourceTemplates,
				isConnected: true,
				isConnecting: false,
				error: undefined,
				sessionId: (client as any).sessionId,
			};
			this.servers.set(config.name, connected);
			this.notifyChange();
			return connected;
		} catch (error: any) {
			const failed: McpServerInfo = {
				config,
				tools: [],
				resources: [],
				resourceTemplates: [],
				isConnected: false,
				isConnecting: false,
				error: error?.message || String(error),
			};
			this.servers.set(config.name, failed);
			this.clients.delete(config.name);
			this.notifyChange();
			return failed;
		}
	}

	/**
	 * 断开指定服务器
	 */
	disconnectServer(name: string): void {
		this.servers.delete(name);
		this.clients.delete(name);
		this.notifyChange();
	}

	/**
	 * 更新服务器配置（重新连接）
	 */
	async updateServer(config: McpServerConfig): Promise<McpServerInfo> {
		this.disconnectServer(config.name);
		if (config.enabled) {
			return this.connectServer(config);
		}
		// 禁用：只存配置，不连接
		const info: McpServerInfo = {
			config,
			tools: [],
			resources: [],
			resourceTemplates: [],
			isConnected: false,
			isConnecting: false,
			error: '已禁用',
		};
		this.servers.set(config.name, info);
		this.notifyChange();
		return info;
	}

	/**
	 * 调用工具
	 */
	async callTool(serverName: string, toolName: string, args?: Record<string, unknown>): Promise<McpToolCallResponse> {
		const client = this.getConnectedClient(serverName);
		try {
			return await client.callTool(toolName, args);
		} catch (error: any) {
			return {
				content: [{ type: 'text', text: `工具调用失败: ${error?.message || String(error)}` }],
				isError: true,
			};
		}
	}

	/**
	 * 读取资源
	 */
	async readResource(serverName: string, uri: string): Promise<McpResourceReadResponse> {
		const client = this.getConnectedClient(serverName);
		return client.readResource(uri);
	}

	/**
	 * 获取所有已连接服务器的工具（用于系统提示词）
	 */
	getConnectedTools(): Array<{ serverName: string; tool: McpTool }> {
		const result: Array<{ serverName: string; tool: McpTool }> = [];
		for (const [name, info] of this.servers) {
			if (info.isConnected) {
				for (const tool of info.tools) {
					result.push({ serverName: name, tool });
				}
			}
		}
		return result;
	}

	private getConnectedClient(serverName: string): McpClient {
		const client = this.clients.get(serverName);
		if (!client) {
			throw new Error(`MCP 服务器 "${serverName}" 未连接`);
		}
		return client;
	}

	/**
	 * 从存储格式加载配置并批量连接
	 */
	async loadConfigs(configs: McpServerConfig[]): Promise<void> {
		const promises = configs
			.filter(c => c.enabled)
			.map(c => this.connectServer(c).catch(err => {
				console.error(`[McpHub] 连接服务器 ${c.name} 失败:`, err);
			}));
		await Promise.all(promises);
	}

	/**
	 * 销毁所有连接
	 */
	dispose(): void {
		this.servers.clear();
		this.clients.clear();
		this.changeListeners = [];
	}
}
