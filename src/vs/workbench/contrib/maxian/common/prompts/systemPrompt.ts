/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolName } from '../tools/toolTypes.js';
import {
	getRulesSection,
	getSystemInfoSection,
	getObjectiveSection,
	getToolUseGuidelinesSection,
	getMarkdownFormattingSection,
	getToolUseSection,
	getModesSection,
	getGitSafetyProtocolSection,
	type SystemInfo
} from './sections/index.js';
import { getModeBySlug, DEFAULT_MODE, type Mode } from '../modes/modeTypes.js';
import { ISkill } from '../../../skills/common/skillTypes.js';

/**
 * 系统提示词生成器
 *
 * 生成顺序（优化后，减少冗余token）：
 * 1. 角色定义
 * 2. Markdown格式化规则
 * 3. 工具调用格式（XML格式规范）
 * 4. 工具使用指南（效率规则、batch、工具选择、attempt_completion、skill）
 * 5. Git安全协议
 * 6. 模式说明
 * 7. 规则
 * 8. 系统信息
 * 9. 目标
 * 10. 自定义指令（模式特定）
 * 11. Steering内容（.maxian/steering/*.md）
 * 12. 诊断信息（LSP自动注入）
 * 13. Skills列表（精简版，仅名称+一句话描述）
 */
export class SystemPromptGenerator {

	static generate(
		workspaceRoot: string,
		availableTools: ToolName[],
		systemInfo: SystemInfo,
		mode: Mode = DEFAULT_MODE,
		options?: {
			includeStats?: boolean;
			reserveForSkills?: boolean;
			preloadedSkills?: ISkill[];
			diagnosticText?: string | null;
			steeringContent?: string | null;
		}
	): string {
		const sections: string[] = [];

		// 1. 角色定义
		sections.push(this.getRoleDefinition(mode));

		// 2. Markdown格式化规则
		sections.push(getMarkdownFormattingSection());

		// 3. 工具调用格式（XML格式规范）
		sections.push(getToolUseSection());

		// 4. 工具使用指南（合并版：效率规则+batch+工具选择+attempt_completion+skill）
		sections.push(getToolUseGuidelinesSection());

		// 5. Git安全协议
		sections.push(getGitSafetyProtocolSection());

		// 6. 模式说明
		sections.push(getModesSection());

		// 7. 规则
		sections.push(getRulesSection(workspaceRoot));

		// 8. 系统信息
		sections.push(getSystemInfoSection(workspaceRoot, systemInfo));

		// 9. 目标
		sections.push(getObjectiveSection());

		// 10. 自定义指令（如果当前模式有）
		const customInstructions = this.getCustomInstructions(mode);
		if (customInstructions) {
			sections.push(customInstructions);
		}

		// 11. Steering内容（来自 .maxian/steering/*.md）
		if (options?.steeringContent) {
			sections.push(`====

STEERING

以下是团队/项目级别的规范和约定（来自 .maxian/steering/ 配置文件）。这些规范必须优先遵守，如与通用指南冲突，以此为准。

${options.steeringContent}`);
		}

		// 12. 自动诊断信息（来自LSP）
		if (options?.diagnosticText) {
			sections.push(options.diagnosticText);
		}

		// 13. Skills列表（精简版）
		if (options?.reserveForSkills && options?.preloadedSkills && options.preloadedSkills.length > 0) {
			sections.push(this.getSkillsDirectory(options.preloadedSkills));
		}

		const prompt = sections.join('\n\n');

		if (options?.includeStats) {
			const chars = prompt.length;
			const estimatedTokens = Math.ceil(chars / 3);
			console.log(`[SystemPrompt] ${chars} chars ≈ ${estimatedTokens} tokens`);
		}

		return prompt;
	}

	/**
	 * Skills列表（精简版）
	 * 只列出名称，触发逻辑已在 toolUseGuidelines 中说明
	 */
	private static getSkillsDirectory(allSkills: ISkill[]): string {
		const skillNames = allSkills
			.slice(0, 30)
			.map((skill: any) => `${skill.slug}: ${skill.description}`)
			.join('\n');

		return `====

AVAILABLE SKILLS

根据任务类型主动调用对应skill工具（见TOOL USE GUIDELINES中的skill使用规则）。

可用Skills（共${allSkills.length}个）：
${skillNames}`;
	}

	private static getRoleDefinition(mode: Mode): string {
		const modeConfig = getModeBySlug(mode);
		if (!modeConfig) {
			return `你是码弦（Maxian），一个智能AI编程助手，专门帮助用户完成软件开发任务。`;
		}
		return modeConfig.roleDefinition;
	}

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
