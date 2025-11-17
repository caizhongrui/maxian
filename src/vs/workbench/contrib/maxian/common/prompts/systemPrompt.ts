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
	type SystemInfo
} from './sections/index.js';
import { getToolDescriptions } from './toolDescriptions.js';
import { getModeBySlug, DEFAULT_MODE, type Mode } from '../modes/modeTypes.js';

/**
 * 系统提示词生成器（完整版）
 * 参考Kilocode实现，包含所有必要sections
 * 顺序与Kilocode保持一致
 */
export class SystemPromptGenerator {

	/**
	 * 生成完整系统提示词
	 * 按照Kilocode的顺序组织sections
	 * @param workspaceRoot 工作区根目录
	 * @param availableTools 可用工具列表
	 * @param systemInfo 系统信息
	 * @param mode 当前模式（默认为code）
	 */
	static generate(workspaceRoot: string, availableTools: ToolName[], systemInfo: SystemInfo, mode: Mode = DEFAULT_MODE): string {
		const sections: string[] = [];

		// 1. 角色定义（roleDefinition） - 根据模式动态获取
		sections.push(this.getRoleDefinition(mode));

		// 2. Markdown格式化规则（markdownFormattingSection）
		sections.push(getMarkdownFormattingSection());

		// 3. 工具使用基础说明（getSharedToolUseSection）
		sections.push(getToolUseSection());

		// 4. 工具描述（getToolDescriptionsForMode）
		sections.push(getToolDescriptions(workspaceRoot, availableTools));

		// 5. 工具使用指南（getToolUseGuidelinesSection）
		sections.push(getToolUseGuidelinesSection());

		// 6. 能力说明（getCapabilitiesSection）
		sections.push(getCapabilitiesSection());

		// 7. 模式说明（getModesSection） - 与Kilocode保持一致
		sections.push(getModesSection());

		// 8. 规则（getRulesSection）
		sections.push(getRulesSection(workspaceRoot));

		// 9. 系统信息（getSystemInfoSection）
		sections.push(getSystemInfoSection(workspaceRoot, systemInfo));

		// 10. 目标（getObjectiveSection）
		sections.push(getObjectiveSection());

		// 11. 自定义指令（如果当前模式有）
		const customInstructions = this.getCustomInstructions(mode);
		if (customInstructions) {
			sections.push(customInstructions);
		}

		return sections.join('\n\n');
	}

	/**
	 * 角色定义
	 * 对应Kilocode的roleDefinition
	 * 根据当前模式动态生成
	 */
	private static getRoleDefinition(mode: Mode): string {
		const modeConfig = getModeBySlug(mode);
		if (!modeConfig) {
			// 回退到默认角色定义
			return `你是码弦（Maxian），一个智能AI编程助手，专门帮助用户完成软件开发任务。`;
		}

		return modeConfig.roleDefinition;
	}

	/**
	 * 获取自定义指令
	 * 如果当前模式有customInstructions，则返回
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
