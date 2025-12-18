/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolName } from '../tools/toolTypes.js';
import {
	getRulesSection,
	getCapabilitiesSection,
	getSystemInfoSection,
	getObjectiveSection,
	getToolUseGuidelinesSection,
	getMarkdownFormattingSection,
	getToolUseSection,
	getModesSection,
	getGitSafetyProtocolSection,
	type SystemInfo
} from './sections/index.js';
import { getToolDescriptions } from './toolDescriptions.js';
import { getModeBySlug, DEFAULT_MODE, type Mode } from '../modes/modeTypes.js';

/**
 * 系统提示词生成器（精简版）
 * 移除冗余内容，减少 token 消耗
 */
export class SystemPromptGenerator {

	/**
	 * 生成系统提示词
	 * 顺序：角色 → 格式 → 工具 → 指南 → 安全 → 能力 → 规则 → 系统信息 → 目标
	 */
	static generate(workspaceRoot: string, availableTools: ToolName[], systemInfo: SystemInfo, mode: Mode = DEFAULT_MODE): string {
		const sections: string[] = [];

		// 1. 角色定义
		sections.push(this.getRoleDefinition(mode));

		// 2. Markdown格式化规则
		sections.push(getMarkdownFormattingSection());

		// 3. 工具使用基础说明
		sections.push(getToolUseSection());

		// 4. 工具描述（精简版，参数详情由tools数组提供）
		sections.push(getToolDescriptions(workspaceRoot, availableTools));

		// 5. 工具使用指南（合并了决策树和探索策略）
		sections.push(getToolUseGuidelinesSection());

		// 6. Git 安全协议
		sections.push(getGitSafetyProtocolSection());

		// 7. 能力说明
		sections.push(getCapabilitiesSection());

		// 8. 模式说明
		sections.push(getModesSection());

		// 9. 规则
		sections.push(getRulesSection(workspaceRoot));

		// 10. 系统信息
		sections.push(getSystemInfoSection(workspaceRoot, systemInfo));

		// 11. 目标
		sections.push(getObjectiveSection());

		// 12. 自定义指令（如果当前模式有）
		const customInstructions = this.getCustomInstructions(mode);
		if (customInstructions) {
			sections.push(customInstructions);
		}

		return sections.join('\n\n');
	}

	/**
	 * 角色定义
	 */
	private static getRoleDefinition(mode: Mode): string {
		const modeConfig = getModeBySlug(mode);
		if (!modeConfig) {
			return `你是码弦（Maxian），一个智能AI编程助手，专门帮助用户完成软件开发任务。`;
		}
		return modeConfig.roleDefinition;
	}

	/**
	 * 获取自定义指令
	 */
	private static getCustomInstructions(mode: Mode): string | null {
		const modeConfig = getModeBySlug(mode);
		if (!modeConfig || !modeConfig.customInstructions) {
			return null;
		}

		return `====

CUSTOM INSTRUCTIONS

${modeConfig.customInstructions}`;
	}
}
