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
import { ISkill } from '../../../skills/common/skillTypes.js';

/**
 * 系统提示词生成器 - 完全本地化实现
 *
 * 🎯 架构决策：100% 本地生成，零API依赖
 *
 * ⚠️ 重要：绝对不要通过API获取系统提示词！
 * - 本地生成速度：<1ms
 * - API获取延迟：50-200ms
 * - 性能差距：200倍
 * - 架构决策文档：./README.md
 *
 * 🚀 优化目标（Week 1 - Skills系统）
 * - 当前token消耗：~3000-5000 tokens
 * - 优化后目标：~500-800 tokens（系统提示词）+ Skills按需加载
 * - Token节省：60-70%
 *
 * 📦 模块化设计
 * - sections/: 可复用的提示词片段
 * - toolDescriptions.ts: 动态工具描述
 * - 未来: skills/ 目录用于按需加载的专业知识
 *
 * @see ./README.md 完整架构文档
 */
export class SystemPromptGenerator {

	/**
	 * 生成系统提示词
	 *
	 * 生成顺序（经过优化的token效率顺序）：
	 * 1. 角色定义 → 建立AI身份
	 * 2. 格式化规则 → 确保输出规范
	 * 3. 工具使用说明 → 核心能力
	 * 4. 工具描述 → 可用工具列表
	 * 5. 工具使用指南 → 决策树和最佳实践
	 * 6. Git安全协议 → 防止破坏性操作
	 * 7. 能力说明 → 功能边界
	 * 8. 模式说明 → 不同工作模式
	 * 9. 规则 → 行为约束
	 * 10. 系统信息 → 环境上下文
	 * 11. 目标 → 最终目的
	 * 12. 自定义指令 → 模式特定指令
	 * 13. Steering内容 → 团队/项目级别规范（.maxian/steering/*.md）
	 * 14. 诊断信息 → LSP自动注入
	 * 15. Skills提示 → 按需加载的专业知识
	 *
	 * @param workspaceRoot 工作区根目录
	 * @param availableTools 可用工具列表
	 * @param systemInfo 系统信息
	 * @param mode 当前模式
	 * @param options 可选配置
	 * @param skillService Skills服务实例
	 * @returns 完整的系统提示词字符串
	 */
	static generate(
		workspaceRoot: string,
		availableTools: ToolName[],
		systemInfo: SystemInfo,
		mode: Mode = DEFAULT_MODE,
		options?: {
			/** 是否包含token统计（调试用） */
			includeStats?: boolean;
			/** 是否为Skills系统预留空间 */
			reserveForSkills?: boolean;
			/** 预加载的Skills列表（避免在渲染进程中异步调用） */
			preloadedSkills?: ISkill[];
			/** 自动注入的诊断信息（来自LSP） */
			diagnosticText?: string | null;
			/** Steering 文件内容（来自 .maxian/steering/*.md） */
			steeringContent?: string | null;
		}
	): string {
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

		// 13. Steering 内容（来自 .maxian/steering/*.md - 自动注入）
		if (options?.steeringContent) {
			sections.push(`====

STEERING

以下是团队/项目级别的规范和约定（来自 .maxian/steering/ 配置文件）。这些规范必须优先遵守，如与通用指南冲突，以此为准。

${options.steeringContent}`);
		}

		// 14. 自动诊断信息（来自LSP - 自动注入）
		if (options?.diagnosticText) {
			sections.push(options.diagnosticText);
		}

		// 15. Skills系统提示（动态生成）
		if (options?.reserveForSkills && options?.preloadedSkills && options.preloadedSkills.length > 0) {
			sections.push(this.getSkillsDirectory(options.preloadedSkills));
		}

		const prompt = sections.join('\n\n');

		// 可选：添加token统计（调试用）
		if (options?.includeStats) {
			const stats = this.estimateTokens(prompt);
			console.log('[SystemPrompt] Token统计:', stats);
		}

		return prompt;
	}

	/**
	 * 估算token数量
	 * 简单估算：1 token ≈ 4 字符（英文），1 token ≈ 2 字符（中文）
	 * 实际tokenization会更复杂，但这个估算足够用于粗略统计
	 */
	private static estimateTokens(text: string): {
		chars: number;
		estimatedTokens: number;
		breakdown: string;
	} {
		const chars = text.length;
		// 混合中英文，使用3字符/token作为折中
		const estimatedTokens = Math.ceil(chars / 3);

		return {
			chars,
			estimatedTokens,
			breakdown: `${chars} chars ≈ ${estimatedTokens} tokens (按3 chars/token估算)`
		};
	}

	/**
	 * Skills目录（静态生成，使用传入的Skills列表）
	 *
	 * 注意：不直接调用skillService，因为在渲染进程中是异步的
	 */
	private static getSkillsDirectory(allSkills: ISkill[]): string {

		// 限制显示前20个Skills（避免System Prompt过长）
		const maxSkills = 20;
		const displaySkills = allSkills.slice(0, maxSkills);

		// 生成Skills列表
		const skillsList = displaySkills
			.map((skill: any) => {
				// 分类图标映射
				const categoryIcons: Record<string, string> = {
					'code-quality': '📝',
					'development': '🔧',
					'testing': '🧪',
					'debugging': '🐛',
					'security': '🔒',
					'performance': '⚡',
					'documentation': '📚',
					'architecture': '🏗️',
					'api': '🌐',
					'database': '💾',
				};
				const icon = categoryIcons[skill.category] || '📋';
				const tokens = skill.estimatedTokens ? ` (~${skill.estimatedTokens} tokens)` : '';
				return `${icon} ${skill.slug} - ${skill.description}${tokens}`;
			})
			.join('\n');

		const moreSkillsHint = allSkills.length > maxSkills
			? `\n\n...and ${allSkills.length - maxSkills} more Skills available.\n`
			: '';

		return `====

AVAILABLE SKILLS (专业知识库 - 主动使用提升质量)

⚠️ **重要原则**：
1. **以下所有Skills都可以调用** - 根据Skill的description判断何时使用
2. **主动调用，不要等待用户明确要求** - 看到相关任务立即加载对应Skill
3. **优先使用Skills** - 遇到专业问题，先调用Skill获取指导，再执行

**📋 完整Skills列表**（共${allSkills.length}个）：
${skillsList}${moreSkillsHint}

**💡 如何使用**：
- 看到任务 → 查看列表找相关Skill → 调用 skill(slug) → 按指导执行
- 示例：用户问"如何实现JWT认证" → 发现spring-security → 调用skill("spring-security") → 按Skill指引实现

---

## 🚨 最高优先级：任务路由策略

**⚠️ 在执行任何任务前，必须先调用 task-strategy Skill判断执行策略！**

🎯 **task-strategy** → **所有任务的第一步**
   - 判断任务类型（代码片段分析 vs 项目开发 vs 知识问答）
   - 决定是否需要探索代码库
   - 决定是否需要创建规划
   - **输出明确的执行策略**

**执行流程**：
- 用户任务 -> 调用 skill(task-strategy) -> 根据策略执行
- 类型1（代码片段）-> 跳过探索 -> 直接调用专业Skill -> 完成
- 类型2（项目开发）-> 探索 -> 规划 -> 执行
- 类型3（知识问答）-> 直接回答
- 类型4（项目分析）-> 探索 -> 总结
- 类型5（Bug修复）-> 条件探索 -> 修复

**关键原则**：
- ✅ 任务路由是第一步，不可跳过
- ✅ 严格遵守task-strategy的判断结果
- ❌ 如果策略说"跳过探索"，就不要搜索任何文件
- ❌ 如果策略说"直接执行"，就不要创建规划

---

## 自动触发规则（必须遵守）

**你必须在以下场景主动调用Skill：**

🎯 **任务路由（最优先）** → skill(task-strategy)
   - **所有任务的第一步**
   - 判断任务类型和执行策略
   - 决定后续流程

📝 **代码审查/质量分析** → skill(code-review)
   - 用户提交代码要求审查
   - 代码包含明显问题需要指出
   - 讨论代码质量、最佳实践

🐛 **调试/错误诊断** → skill(debugging)
   - 出现bug、错误、异常
   - 程序行为不符合预期
   - 需要定位问题根源

🧪 **测试相关** → skill(testing)
   - 编写单元测试
   - 测试策略讨论
   - 测试覆盖率优化

🔨 **代码重构** → skill(refactoring)
   - 代码结构优化
   - 消除代码异味
   - 提升可维护性

🔒 **安全审查** → skill(security)
   - 检查安全漏洞
   - SQL注入、XSS等风险
   - 权限控制问题

⚡ **性能优化** → skill(performance)
   - 响应慢、内存占用高
   - 数据库查询优化
   - 算法效率提升

📚 **文档编写** → skill(documentation)
   - 编写API文档
   - 代码注释规范
   - 项目说明文档

🏗️ **架构设计** → skill(architecture)
   - 系统设计讨论
   - 技术选型
   - 模块划分

🌐 **API设计** → skill(api-design)
   - REST/GraphQL API设计
   - 接口规范制定
   - 版本控制策略

🔧 **Git工作流** → skill(git-workflow)
   - 分支管理
   - 提交规范
   - 冲突解决

☕ **Java开发** → skill(java-best-practices)
   - Java代码规范
   - 异常处理最佳实践
   - 集合使用、并发编程

🚀 **Spring Boot** → skill(spring-boot)
   - 微服务开发
   - 配置管理、依赖注入
   - REST API、数据访问

🔒 **Spring Security** → skill(spring-security)
   - JWT认证授权
   - OAuth2集成
   - 方法级权限控制

💾 **MyBatis-Plus** → skill(mybatis-plus)
   - CRUD操作、条件构造器
   - 分页查询、批量操作
   - 多表关联、乐观锁

🗄️ **JPA/Hibernate** → skill(jpa-hibernate)
   - 实体映射、关系处理
   - JPQL查询、性能优化
   - 缓存策略

📦 **Redis集成** → skill(redis-integration)
   - 缓存实现、分布式锁
   - Session共享
   - 消息队列

💚 **Vue 3组合式API** → skill(vue3-composition-api)
   - setup语法、响应式系统
   - 生命周期、组合函数
   - Props/Emits、依赖注入

🏪 **Pinia状态管理** → skill(pinia-state-management)
   - Store定义、State/Getters/Actions
   - TypeScript支持
   - 插件系统

🎨 **Element Plus** → skill(element-plus)
   - 表单、表格组件
   - 对话框、消息提示
   - 布局、上传组件

## 使用方式

1. **自动判断**：分析用户任务，确定需要哪个Skill
2. **立即调用**：不要犹豫，直接调用 skill 工具
3. **⚠️ 严格遵循**：**按照Skill中的指引执行，不要自行探索或询问**
   - Skill会明确告诉你该怎么做、不该怎么做
   - 如果Skill说"不要搜索文件"，就不要搜索
   - 如果Skill说"不要询问"，就直接完成任务

**示例**：
- 用户说"审查这段代码" → 调用 skill(code-review) → **按Skill指引直接审查代码，不搜索文件**
- 发现代码有bug → 调用 skill(debugging) → 按Skill流程定位问题
- 需要优化性能 → 调用 skill(performance) → 按Skill检查清单分析

Token优化：
- System Prompt仅包含此目录 (<300 tokens)
- 完整Skill内容(100-1500 tokens)按需加载
- 平均节省45% tokens，最高可节省82%

记住：主动使用Skills是你的职责，不要等待用户明确要求！`;
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
