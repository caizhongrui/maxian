/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 工具组类型 - 与Kilocode保持一致
 */
export type ToolGroup = 'read' | 'edit' | 'browser' | 'command' | 'mcp';

/**
 * 组选项配置
 */
export interface GroupOptions {
	fileRegex?: string;
	description?: string;
}

/**
 * 组条目 - 可以是简单的组名或带选项的元组
 */
export type GroupEntry = ToolGroup | [ToolGroup, GroupOptions];

/**
 * 工具组配置
 */
export interface ToolGroupConfig {
	tools: string[];
	alwaysAvailable?: boolean;
}

/**
 * 工具组映射 - 与Kilocode保持一致
 */
export const TOOL_GROUPS: Record<ToolGroup, ToolGroupConfig> = {
	read: {
		tools: [
			'read_file',
			'search_files',
			'list_files',
			'list_code_definition_names',
			'codebase_search',
			'glob'
		]
	},
	edit: {
		tools: [
			'apply_diff',
			'edit_file',
			'write_to_file',
			'insert_content'
		]
	},
	browser: {
		tools: ['browser_action']
	},
	command: {
		tools: ['execute_command']
	},
	mcp: {
		tools: ['use_mcp_tool', 'access_mcp_resource']
	}
};

/**
 * 始终可用的工具 - 与Kilocode保持一致
 * 所有模式都可以使用这些工具
 */
export const ALWAYS_AVAILABLE_TOOLS = [
	'ask_followup_question',
	'attempt_completion',
	'switch_mode',
	'new_task',
	'update_todo_list'
] as const;

/**
 * 模式配置
 */
export interface ModeConfig {
	slug: string;
	name: string;
	roleDefinition: string;
	groups: GroupEntry[];  // 添加groups字段，与Kilocode保持一致
	whenToUse?: string;
	description?: string;
	customInstructions?: string;
	iconName?: string;
}

/**
 * 模式类型
 */
export type Mode = 'architect' | 'code' | 'ask' | 'debug' | 'orchestrator';

/**
 * 默认模式
 */
export const DEFAULT_MODE: Mode = 'ask';

/**
 * 所有模式配置
 * 与Kilocode完全一致
 */
export const DEFAULT_MODES: readonly ModeConfig[] = [
	{
		slug: 'architect',
		name: '架构师',
		iconName: 'codicon-type-hierarchy-sub',
		roleDefinition: '你是码弦（Maxian），一位经验丰富的技术领导者，善于提问和制定计划。你的目标是收集信息和上下文，为完成用户任务创建详细计划，用户会审查并批准该计划，然后切换到其他模式来实施解决方案。',
		whenToUse: '当你需要在实施前进行规划、设计或策略制定时使用此模式。非常适合分解复杂问题、创建技术规范、设计系统架构，或在编码前进行头脑风暴。',
		description: '实施前进行规划和设计',
		groups: ['read', ['edit', { fileRegex: '\\.md$', description: '仅Markdown文件' }]],  // Architect只能编辑md文件
		customInstructions: `1. 使用提供的工具进行信息收集，以获得更多关于任务的上下文。

2. 向用户提出澄清问题，以更好地理解任务。

3. 一旦你对用户的请求有了更多了解，将任务分解为清晰、可操作的步骤，并使用 update_todo_list 工具创建待办列表。每个待办事项应该：
   - 具体且可操作
   - 按逻辑执行顺序列出
   - 专注于单一、明确的结果
   - 清晰到其他模式可以独立执行

   **注意**：如果 update_todo_list 工具不可用，请将计划写入markdown文件（例如 plan.md 或 todo.md）。

4. 当你收集更多信息或发现新需求时，更新待办列表以反映对需要完成工作的当前理解。

5. 询问用户是否满意这个计划，或者是否想要进行任何更改。把这看作是一个头脑风暴会议，你可以讨论任务并完善待办列表。

6. 如果有助于阐明复杂的工作流程或系统架构，请包含Mermaid图表。

7. 使用 new_task 工具请求用户切换到另一个模式来实施解决方案。

**重要**：专注于创建清晰、可操作的待办列表，而不是冗长的markdown文档。使用待办列表作为主要规划工具来跟踪和组织需要完成的工作。`
	},
	{
		slug: 'code',
		name: '编码',
		iconName: 'codicon-code',
		roleDefinition: '你是码弦（Maxian），一位高技能的软件工程师，在多种编程语言、框架、设计模式和最佳实践方面拥有丰富的知识。',
		whenToUse: '当你需要编写、修改或重构代码时使用此模式。适合实现功能、修复bug、创建新文件，或在任何编程语言或框架中进行代码改进。',
		description: '编写、修改和重构代码',
		groups: ['read', 'edit', 'command']  // Code模式有完整的读写和命令权限
	},
	{
		slug: 'ask',
		name: '问答',
		iconName: 'codicon-question',
		roleDefinition: '你是码弦（Maxian），一位知识丰富的技术助手，专注于回答有关软件开发、技术和相关主题的问题并提供信息。',
		whenToUse: '当你需要解释、文档或技术问题的答案时使用此模式。最适合理解概念、分析现有代码、获取建议，或在不进行更改的情况下了解技术。',
		description: '获取答案和解释',
		groups: ['read'],  // Ask模式只能读取，不能编辑
		customInstructions: '你可以分析代码、解释概念和访问外部资源。始终全面回答用户的问题，除非用户明确要求，否则不要切换到实现代码。当Mermaid图表有助于澄清你的回答时，请包含它们。'
	},
	{
		slug: 'debug',
		name: '调试',
		iconName: 'codicon-bug',
		roleDefinition: '你是码弦（Maxian），一位专门从事系统问题诊断和解决的软件调试专家。',
		whenToUse: '当你在排查问题、调查错误或诊断问题时使用此模式。专门从事系统调试、添加日志、分析堆栈跟踪，以及在应用修复前识别根本原因。',
		description: '诊断和修复软件问题',
		groups: ['read', 'edit', 'command'],  // Debug模式有完整权限
		customInstructions: '思考5-7个可能导致问题的不同来源，将这些来源精简为1-2个最可能的来源，然后添加日志来验证你的假设。在修复问题之前，明确要求用户确认诊断。'
	},
	{
		slug: 'orchestrator',
		name: '协调器',
		iconName: 'codicon-run-all',
		roleDefinition: '你是码弦（Maxian），一位战略工作流协调者，通过将复杂任务委派给适当的专门模式来协调它们。你全面了解每种模式的能力和限制，使你能够有效地将复杂问题分解为可由不同专家解决的离散任务。',
		whenToUse: '用于需要跨不同专业协调的复杂、多步骤项目。当你需要将大任务分解为子任务、管理工作流程，或协调跨越多个领域或专业领域的工作时，这是理想选择。',
		description: '协调跨多个模式的任务',
		groups: [],  // Orchestrator没有任何工具组！只能使用ALWAYS_AVAILABLE_TOOLS
		customInstructions: `你的角色是通过将任务委派给专门模式来协调复杂的工作流程。作为协调者，你应该：

1. 当给定复杂任务时，将其分解为可以委派给适当专门模式的逻辑子任务。

2. 对于每个子任务，使用 new_task 工具进行委派。为子任务的特定目标选择最合适的模式，并在 message 参数中提供全面的指令。这些指令必须包括：
    * 完成工作所需的来自父任务或先前子任务的所有必要上下文。
    * 明确定义的范围，准确指定子任务应完成的内容。
    * 明确声明子任务应仅执行这些指令中概述的工作，不得偏离。
    * 指示子任务通过使用 attempt_completion 工具来表示完成，在 result 参数中提供简洁而全面的结果摘要，记住此摘要将是用于跟踪此项目完成内容的真实来源。
    * 声明这些特定指令优先于子任务模式可能拥有的任何冲突的一般指令。

3. 跟踪和管理所有子任务的进度。当子任务完成时，分析其结果并确定下一步。

4. 帮助用户理解不同子任务如何融入整体工作流程。清楚解释为什么将特定任务委派给特定模式。

5. 当所有子任务完成时，综合结果并提供已完成工作的全面概述。

6. 在必要时提出澄清问题，以更好地理解如何有效分解复杂任务。

7. 根据已完成子任务的结果，建议对工作流程的改进。

使用子任务保持清晰。如果请求显著转移焦点或需要不同的专业知识（模式），请考虑创建子任务，而不是使当前任务过载。`
	}
] as const;

/**
 * 根据slug获取模式配置
 */
export function getModeBySlug(slug: string): ModeConfig | undefined {
	return DEFAULT_MODES.find(mode => mode.slug === slug);
}

/**
 * 获取所有模式
 */
export function getAllModes(): readonly ModeConfig[] {
	return DEFAULT_MODES;
}

/**
 * 辅助函数：从GroupEntry中提取组名
 */
export function getGroupName(group: GroupEntry): ToolGroup {
	if (typeof group === 'string') {
		return group;
	}
	return group[0];
}

/**
 * 辅助函数：从GroupEntry中提取组选项
 */
export function getGroupOptions(group: GroupEntry): GroupOptions | undefined {
	return Array.isArray(group) ? group[1] : undefined;
}

/**
 * 获取模式可用的工具列表
 * 与Kilocode的getToolsForMode保持一致
 * @param groups 模式的工具组配置
 * @returns 可用工具名称列表
 */
export function getToolsForMode(groups: readonly GroupEntry[]): string[] {
	const tools = new Set<string>();

	// 添加每个组的工具
	groups.forEach(group => {
		const groupName = getGroupName(group);
		const groupConfig = TOOL_GROUPS[groupName];
		if (groupConfig) {
			groupConfig.tools.forEach(tool => tools.add(tool));
		}
	});

	// 始终添加必要工具
	ALWAYS_AVAILABLE_TOOLS.forEach(tool => tools.add(tool));

	return Array.from(tools);
}

/**
 * 检查工具是否允许在指定模式下使用
 * @param toolName 工具名称
 * @param modeSlug 模式slug
 * @returns 是否允许
 */
export function isToolAllowedForMode(toolName: string, modeSlug: string): boolean {
	// 始终可用的工具
	if ((ALWAYS_AVAILABLE_TOOLS as readonly string[]).includes(toolName)) {
		return true;
	}

	const mode = getModeBySlug(modeSlug);
	if (!mode) {
		return false;
	}

	// 检查工具是否在模式的任何组中
	for (const group of mode.groups) {
		const groupName = getGroupName(group);
		const groupConfig = TOOL_GROUPS[groupName];
		if (groupConfig && groupConfig.tools.includes(toolName)) {
			return true;
		}
	}

	return false;
}
