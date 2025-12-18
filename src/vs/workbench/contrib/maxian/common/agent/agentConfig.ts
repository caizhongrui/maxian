/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Agent 配置系统
 * 参考 OpenCode agent/agent.ts 实现
 *
 * 功能：
 * - P2-9: Agent 工具过滤（按 agent 限制可用工具）
 * - P2-10: Plan Agent 权限（只读 bash 命令白名单）
 * - P2-11: Explore Agent（禁用 edit/write）
 */

import { ToolName } from '../tools/toolTypes.js';

/**
 * Agent 模式
 */
export type AgentMode = 'primary' | 'subagent';

/**
 * 权限级别
 */
export type PermissionLevel = 'allow' | 'deny' | 'ask';

/**
 * Bash 命令权限配置
 * 支持通配符匹配，如 "git diff*" 匹配所有以 "git diff" 开头的命令
 */
export interface BashPermissionConfig {
	[pattern: string]: PermissionLevel;
}

/**
 * Agent 权限配置
 */
export interface AgentPermission {
	/** 编辑文件权限 */
	edit?: PermissionLevel;
	/** 写入文件权限 */
	write?: PermissionLevel;
	/** Bash 命令权限 */
	bash?: BashPermissionConfig;
	/** Web 请求权限 */
	webfetch?: PermissionLevel;
	/** 死循环检测 */
	doom_loop?: PermissionLevel;
	/** 外部目录访问 */
	external_directory?: PermissionLevel;
}

/**
 * 工具启用配置
 * true = 启用, false = 禁用
 */
export interface ToolEnableConfig {
	[toolName: string]: boolean;
}

/**
 * Agent 配置
 */
export interface AgentConfig {
	/** Agent 名称 */
	name: string;
	/** Agent 描述 */
	description: string;
	/** Agent 模式 */
	mode: AgentMode;
	/** 工具启用配置 */
	tools: ToolEnableConfig;
	/** 权限配置 */
	permission: AgentPermission;
	/** 是否隐藏（不在UI中显示） */
	hidden?: boolean;
	/** 系统提示词补充 */
	systemPromptAddition?: string;
}

/**
 * Plan Agent 的 Bash 命令白名单
 * 参考 OpenCode agent/agent.ts:63-107
 */
const PLAN_BASH_WHITELIST: BashPermissionConfig = {
	'git diff*': 'allow',
	'git log*': 'allow',
	'git status*': 'allow',
	'git show*': 'allow',
	'git branch*': 'allow',
	'grep*': 'allow',
	'ls*': 'allow',
	'find*': 'allow',
	'rg*': 'allow',
	'cat*': 'allow',
	'head*': 'allow',
	'tail*': 'allow',
	'wc*': 'allow',
	'*': 'ask', // 其他命令需要确认
};

/**
 * 预定义的 Agent 配置
 * 参考 OpenCode agent/agent.ts:109-190
 */
export const AGENT_CONFIGS: Record<string, AgentConfig> = {
	/**
	 * Build Agent - 主开发 Agent
	 * 拥有全部工具权限，用于实际开发工作
	 */
	build: {
		name: 'build',
		description: '主开发 Agent，拥有全部工具权限，用于编写代码、修改文件等开发工作',
		mode: 'primary',
		tools: {
			// 所有工具都启用
		},
		permission: {
			edit: 'allow',
			write: 'allow',
			bash: { '*': 'allow' },
			webfetch: 'allow',
			doom_loop: 'ask',
			external_directory: 'ask',
		},
	},

	/**
	 * Plan Agent - 只读分析 Agent
	 * 禁止编辑，bash 需要确认，用于安全分析和规划
	 */
	plan: {
		name: 'plan',
		description: '规划分析 Agent，只读权限，用于代码分析和实现规划',
		mode: 'primary',
		tools: {
			edit_file: false,
			write_to_file: false,
			apply_diff: false,
			multiedit: false,
			// 读取和搜索工具保持启用
		},
		permission: {
			edit: 'deny',
			write: 'deny',
			bash: PLAN_BASH_WHITELIST,
			webfetch: 'allow',
			doom_loop: 'ask',
		},
		systemPromptAddition: `
作为 Plan Agent，你的职责是分析代码和规划实现方案。
你不能直接修改文件，但可以：
- 读取和搜索代码
- 执行只读的 git 和文件系统命令
- 分析代码结构和依赖关系
- 提供详细的实现计划和建议

请专注于分析和规划，而不是直接执行修改。`,
	},

	/**
	 * Explore Agent - 快速搜索 Agent
	 * 禁用编辑/写入，用于快速探索代码库
	 */
	explore: {
		name: 'explore',
		description: '快速探索 Agent，禁用编辑和写入，用于快速搜索和浏览代码库',
		mode: 'subagent',
		tools: {
			// 禁用所有修改类工具
			edit_file: false,
			write_to_file: false,
			apply_diff: false,
			multiedit: false,
			execute_command: false,
			// 禁用 todo 工具
			update_todo_list: false,
			// 启用所有读取和搜索工具
		},
		permission: {
			edit: 'deny',
			write: 'deny',
			bash: { '*': 'deny' },
			webfetch: 'allow',
		},
		systemPromptAddition: `
作为 Explore Agent，你的职责是快速探索和搜索代码库。
你可以：
- 读取文件内容
- 搜索代码和文件
- 列出目录结构
- 分析代码定义

你不能修改任何文件或执行命令。请根据任务的 thoroughness 级别进行搜索：
- "quick": 快速基础搜索
- "medium": 中等深度探索
- "very thorough": 全面深入分析`,
	},

	/**
	 * General Agent - 通用子任务 Agent
	 * 禁用 todo 工具，用于并行子任务
	 */
	general: {
		name: 'general',
		description: '通用子任务 Agent，用于并行执行独立的子任务',
		mode: 'subagent',
		tools: {
			// 禁用 todo 工具（避免与主任务冲突）
			update_todo_list: false,
		},
		permission: {
			edit: 'allow',
			write: 'allow',
			bash: { '*': 'ask' },
			webfetch: 'allow',
			doom_loop: 'ask',
		},
	},

	/**
	 * Compaction Agent - 上下文摘要 Agent
	 * 无工具权限，专门用于生成上下文摘要
	 */
	compaction: {
		name: 'compaction',
		description: '上下文摘要 Agent，用于生成对话摘要以压缩上下文',
		mode: 'primary',
		tools: {
			// 禁用所有工具
			'*': false,
		},
		permission: {
			edit: 'deny',
			write: 'deny',
			bash: { '*': 'deny' },
			webfetch: 'deny',
		},
		hidden: true,
		systemPromptAddition: `
你是一个专门的摘要生成 Agent。
请生成一个详细的提示词用于继续之前的对话。
重点包括：
1. 我们做了什么
2. 我们正在做什么
3. 我们正在处理哪些文件
4. 下一步要做什么

新的会话将无法访问之前的对话内容，所以请确保摘要足够详细。`,
	},

	/**
	 * Title Agent - 标题生成 Agent
	 */
	title: {
		name: 'title',
		description: '标题生成 Agent，用于生成对话标题',
		mode: 'primary',
		tools: {
			'*': false,
		},
		permission: {
			edit: 'deny',
			write: 'deny',
			bash: { '*': 'deny' },
		},
		hidden: true,
	},

	/**
	 * Summary Agent - 摘要生成 Agent
	 */
	summary: {
		name: 'summary',
		description: '摘要生成 Agent，用于生成对话摘要',
		mode: 'primary',
		tools: {
			'*': false,
		},
		permission: {
			edit: 'deny',
			write: 'deny',
			bash: { '*': 'deny' },
		},
		hidden: true,
	},
};

/**
 * 获取 Agent 配置
 * @param agentName Agent 名称
 * @returns Agent 配置，如果不存在返回默认的 build 配置
 */
export function getAgentConfig(agentName: string): AgentConfig {
	return AGENT_CONFIGS[agentName] || AGENT_CONFIGS.build;
}

/**
 * 检查工具是否对指定 Agent 可用
 * @param agentName Agent 名称
 * @param toolName 工具名称
 * @returns 是否可用
 */
export function isToolEnabledForAgent(agentName: string, toolName: ToolName): boolean {
	const config = getAgentConfig(agentName);

	// 检查是否全部禁用
	if (config.tools['*'] === false) {
		return false;
	}

	// 检查特定工具配置
	const toolEnabled = config.tools[toolName];
	if (toolEnabled === false) {
		return false;
	}

	return true;
}

/**
 * 获取 Agent 可用的工具列表
 * @param agentName Agent 名称
 * @param allTools 所有工具列表
 * @returns 可用的工具列表
 */
export function getEnabledToolsForAgent(agentName: string, allTools: ToolName[]): ToolName[] {
	return allTools.filter(tool => isToolEnabledForAgent(agentName, tool));
}

/**
 * 检查 Bash 命令是否被允许
 * @param agentName Agent 名称
 * @param command Bash 命令
 * @returns 权限级别
 */
export function checkBashPermission(agentName: string, command: string): PermissionLevel {
	const config = getAgentConfig(agentName);
	const bashConfig = config.permission.bash;

	if (!bashConfig) {
		return 'allow';
	}

	// 检查每个模式
	for (const [pattern, permission] of Object.entries(bashConfig)) {
		if (pattern === '*') continue; // 稍后处理默认规则

		// 简单的通配符匹配（pattern* 匹配以 pattern 开头的命令）
		if (pattern.endsWith('*')) {
			const prefix = pattern.slice(0, -1);
			if (command.startsWith(prefix)) {
				return permission;
			}
		} else if (command === pattern) {
			return permission;
		}
	}

	// 返回默认规则
	return bashConfig['*'] || 'allow';
}

/**
 * 获取所有可见的 Agent 配置
 * @returns 可见的 Agent 配置数组
 */
export function getVisibleAgents(): AgentConfig[] {
	return Object.values(AGENT_CONFIGS).filter(config => !config.hidden);
}

/**
 * 获取所有 subagent 配置
 * @returns subagent 配置数组
 */
export function getSubagents(): AgentConfig[] {
	return Object.values(AGENT_CONFIGS).filter(config => config.mode === 'subagent');
}

/**
 * 获取所有 primary agent 配置
 * @returns primary agent 配置数组
 */
export function getPrimaryAgents(): AgentConfig[] {
	return Object.values(AGENT_CONFIGS).filter(config => config.mode === 'primary' && !config.hidden);
}
