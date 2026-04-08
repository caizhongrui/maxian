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
import { estimateTokensFromChars } from '../utils/tokenEstimate.js';

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
			memoryContent?: string | null;
			profile?: 'full' | 'lean';
		}
	): string {
		const profile = options?.profile ?? 'full';
		if (profile === 'lean') {
			return this.generateLeanPrompt(workspaceRoot, availableTools, systemInfo, mode, options);
		}

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

		// 11.5 跨会话记忆内容（来自 .maxian/memory/auto-memory.md）
		if (options?.memoryContent) {
			sections.push(`====

MEMORY

以下是从历史对话中提取的用户偏好、项目约定和常见模式（来自 .maxian/memory/auto-memory.md）。请参考这些记忆信息来更好地理解用户需求和项目背景。

${options.memoryContent}`);
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
			const estimatedTokens = estimateTokensFromChars(chars);
			console.log(`[SystemPrompt] ${chars} chars ≈ ${estimatedTokens} tokens`);
		}

		return prompt;
	}

	private static generateLeanPrompt(
		workspaceRoot: string,
		availableTools: ToolName[],
		systemInfo: SystemInfo,
		mode: Mode,
		options?: {
			includeStats?: boolean;
			reserveForSkills?: boolean;
			preloadedSkills?: ISkill[];
			diagnosticText?: string | null;
			steeringContent?: string | null;
			memoryContent?: string | null;
			profile?: 'full' | 'lean';
		}
	): string {
		const sections: string[] = [];
		sections.push(this.getRoleDefinition(mode));
		sections.push(`====

WORKING CONTRACT

- 以完成用户目标为第一优先，先做最少探索再执行修改。
- 默认使用简体中文；代码、命令、路径保持原文。
- Markdown 保持简洁：必要时用短列表与代码块。
- 工具调用失败时，不要机械重试同一写入；先判断是否“已生效/需重读/需改策略”。`);
		sections.push(`====

TOOL CORE RULES

- 读：优先 \`search_files(output_mode=files_with_matches)\` → \`read_file\`，减少大范围扫描。
- 改：单点用 \`edit\`，同文件多点用 \`multiedit\`，新文件才用 \`write_to_file\`。
- 并行：多个独立只读操作时用 \`batch\`。
- 提问：\`ask_followup_question\` 必须带 options（2-4 个）。
- 完成：仅在目标实现且验证后调用 \`attempt_completion\`。`);
		sections.push(`====

AVAILABLE TOOLS

${availableTools.join(', ')}`);
		sections.push(getSystemInfoSection(workspaceRoot, systemInfo));
		sections.push(getObjectiveSection());

		const customInstructions = this.getCustomInstructions(mode);
		if (customInstructions) {
			sections.push(customInstructions);
		}

		if (options?.steeringContent) {
			sections.push(`====

STEERING

${this.truncateLongSection(options.steeringContent, 2200)}`);
		}

		if (options?.memoryContent) {
			sections.push(`====

MEMORY

${this.truncateLongSection(options.memoryContent, 1600)}`);
		}

		if (options?.diagnosticText) {
			sections.push(this.truncateLongSection(options.diagnosticText, 1200));
		}

		if (options?.reserveForSkills && options?.preloadedSkills && options.preloadedSkills.length > 0) {
			sections.push(this.getSkillsDirectory(options.preloadedSkills));
		}

		const prompt = sections.join('\n\n');

		if (options?.includeStats) {
			const chars = prompt.length;
			const estimatedTokens = estimateTokensFromChars(chars);
			console.log(`[SystemPrompt][lean] ${chars} chars ≈ ${estimatedTokens} tokens`);
		}

		return prompt;
	}

	private static truncateLongSection(text: string, maxChars: number): string {
		const normalized = text.trim();
		if (normalized.length <= maxChars) {
			return normalized;
		}
		return `${normalized.slice(0, maxChars)}\n\n[truncated]`;
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

仅在明确需要某个领域的最佳实践、检查清单或专业流程时，才调用 skill 工具（见 TOOL USE GUIDELINES 中的 skill 使用规则）。

可用Skills（共${allSkills.length}个）：
${skillNames}`;
	}

	private static getRoleDefinition(mode: Mode): string {
		const modeConfig = getModeBySlug(mode);
		const languageConstraint = `【输出语言强约束】
- 默认且必须使用简体中文回复所有自然语言内容（包括说明、总结、错误解释、计划与提问）。
- 仅当用户明确要求其他语言时，才切换到指定语言。
- 代码、命令、路径、API 字段名和标识符保持原文，不做翻译。`;

		if (!modeConfig) {
			return `你是码弦（Maxian），一个智能AI编程助手，专门帮助用户完成软件开发任务。\n\n${languageConstraint}`;
		}
		return `${modeConfig.roleDefinition}\n\n${languageConstraint}`;
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
