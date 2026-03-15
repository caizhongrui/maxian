/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolUse, ToolResponse, ToolName } from './toolTypes.js';
import { ITodoItem } from './todoStore.js';
import { BehaviorReporter } from '../../browser/behaviorReporter.js';

/**
 * 工具执行器接口
 * 负责执行各种工具调用
 */
export interface IToolExecutor {
	/**
	 * 执行工具调用
	 * @param toolUse 工具使用信息
	 * @returns 工具执行结果
	 */
	executeTool(toolUse: ToolUse): Promise<ToolResponse>;

	/**
	 * 检查工具是否可用
	 * @param toolName 工具名称
	 * @returns 是否可用
	 */
	isToolAvailable(toolName: ToolName): boolean;

	/**
	 * 获取可用工具列表
	 * @returns 可用工具名称数组
	 */
	getAvailableTools(): ToolName[];
}

/**
 * 工具执行上下文
 * 包含执行工具所需的环境信息
 */
export interface ToolExecutionContext {
	cwd: string; // 当前工作目录
	workspaceRoot?: string; // 工作区根目录
	sessionId?: string; // P1-7: 会话ID，用于 Doom Loop 检测
	agentName?: string; // P2-9: Agent名称，用于工具过滤
	/** P2优化：待办列表更新回调（由 maxianService 注入，用于触发 UI 更新） */
	onTodoListUpdate?: (todos: ITodoItem[]) => void;
	/** 行为埋点上报器（由 maxianService 注入） */
	behaviorReporter?: BehaviorReporter;
}

/**
 * 工具执行结果
 */
export interface ToolExecutionResult {
	success: boolean;
	result?: ToolResponse;
	error?: string;
	metadata?: Record<string, any>;
}
