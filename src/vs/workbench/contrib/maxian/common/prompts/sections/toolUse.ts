/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 工具使用基础section
 * P0优化：支持batch工具进行批量并行操作
 */
export function getToolUseSection(): string {
	return `====

TOOL USE

你可以使用一组工具来完成任务，工具需要用户批准后才会执行。每条助手消息都必须包含工具调用。你需要一步步使用工具来完成给定任务，每次工具使用都基于前一次工具使用的结果。

# 批量操作（强烈推荐）

**重要**：当你需要执行多个独立的读取/搜索操作时，**必须**使用 \`batch\` 工具来并行执行！

使用 batch 工具的好处：
- ⚡ 性能提升 2-5 倍
- 🎯 减少往返延迟
- 💡 用户体验更好

示例场景：
- 需要读取多个文件 → 用 batch 并行读取
- 需要多处搜索 → 用 batch 组合 search_files 和 glob
- 需要了解多个模块 → 用 batch 并行 codebase_search
- **需要创建多个文件 → 用 batch 并行创建**（如开发游戏：HTML、CSS、JS）
- **需要编辑多个文件 → 用 batch 并行修改**（如批量重构）

**禁止在 batch 中使用的工具**（仅3个）：
- batch（不允许嵌套）
- ask_followup_question（需要用户交互）
- attempt_completion（任务完成标志）

# 工具使用格式

工具使用采用XML格式。工具名称本身成为XML标签名，每个参数都封装在自己的标签中。结构如下：

<actual_tool_name>
<parameter1_name>value1</parameter1_name>
<parameter2_name>value2</parameter2_name>
...
</actual_tool_name>

注意：
- 始终使用实际的工具名称作为XML标签名，以确保正确解析和执行
- 参数值可以是多行文本
- 所有参数都必须包含在对应的标签中`;
}
