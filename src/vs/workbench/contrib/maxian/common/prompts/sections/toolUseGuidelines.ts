/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 获取工具使用指南section - 精简版
 * 合并了原来的决策树、探索策略和工具指南
 * P0优化：添加batch工具使用指导
 */
export function getToolUseGuidelinesSection(): string {
	return `====

TOOL USE GUIDELINES

## 核心原则

1. **批量操作优先（最重要！）**
   - 需要执行 2+ 个独立读取/搜索操作时 → **必须使用 batch 工具**
   - 示例：了解一个功能需要读取3个文件 → 用 batch 并行读取
   - 示例：需要搜索+查看目录结构 → 用 batch 组合 search_files 和 list_files
   - 🚀 **使用 batch 可获得 2-5 倍性能提升！**

2. **探索优先于修改**
   - 修改代码前必须先理解现有代码
   - 使用 codebase_search 或 read_file 了解上下文
   - 多文件探索时使用 batch 并行读取

3. **搜索策略**
   - 按文件名查找 → glob
   - 语义搜索 → codebase_search（不确定关键词时首选）
   - 精确文本 → search_files
   - 搜索失败立即换策略，不重复相同搜索
   - **多条件搜索 → 用 batch 并行执行多个搜索**

4. **文件修改**
   - 修改前必须 read_file
   - 局部修改 → apply_diff（首选）
   - 多处修改同一文件 → multiedit
   - 多文件批量操作 → patch
   - 创建/完全重写 → write_to_file（必须完整内容，禁止占位符）

5. **命令执行**
   - 危险命令先询问用户
   - 失败时分析错误并修复

6. **任务管理**
   - 复杂任务用 update_todo_list 跟踪
   - 完成时用 attempt_completion

7. **用户交互**
   - 仅在必要时 ask_followup_question
   - 能用工具解决的不问用户

8. **LSP 工具（代码智能分析）**
   - **⚡ 重要：自动识别用户意图，无需用户明确说"使用lsp_xxx"**
   - **何时自动使用**：
     - 用户问"这是什么类型" → lsp_hover
     - 用户问"在哪定义的" → lsp_definition
     - 用户问"被用在哪" → lsp_references
     - 用户问"有什么错误" → lsp_diagnostics
     - 用户问"User接口是什么" → lsp_type_definition
   - **工作流示例**：
     用户："这个变量是什么类型？"
     1. read_file 找到变量位置（行号、列号）
     2. lsp_hover 获取类型信息
     3. 如需查看类型定义 → lsp_type_definition + read_file
   - **注意**：文件保存后，诊断信息会自动注入到 System Prompt

9. **Task工具（子任务派发）**
   - 使用场景：复杂多步骤任务、代码库探索、特定功能研究
   - **何时使用task工具**：
     - 需要深度探索代码库（使用explore subagent）
     - 需要并行执行多个独立任务（使用general subagent）
     - 复杂研究型任务
   - **何时不使用task工具**：
     - 读取特定文件 → 直接用 read_file或glob
     - 搜索特定类定义 → 直接用 glob
     - 搜索1-3个文件内容 → 直接用 read_file
     - 用户提供了代码片段要审查/分析 → 直接分析代码，不要探索

## Task 工具正确使用示例

✅ **正确用法**：
- 用户："找到所有API端点的实现位置" → task(subagent_type="explore", prompt="...")
- 用户："并行验证3个独立功能" → task(subagent_type="general", prompt="...")

❌ **错误用法**：
- 用户："审查这段Java代码：..." → ❌不要用task，直接审查代码
- 用户："读取src/app.ts文件" → ❌不要用task，直接用read_file
- 用户："查找User类定义" → ❌不要用task，直接用glob("**/User.*")

## batch 工具使用示例

读取多个相关文件：
\`\`\`json
{"tool_calls": [
  {"tool": "read_file", "parameters": {"path": "src/service.ts"}},
  {"tool": "read_file", "parameters": {"path": "src/types.ts"}},
  {"tool": "read_file", "parameters": {"path": "src/utils.ts"}}
]}
\`\`\`

组合搜索操作：
\`\`\`json
{"tool_calls": [
  {"tool": "search_files", "parameters": {"path": "src", "regex": "handleError"}},
  {"tool": "glob", "parameters": {"pattern": "**/*.test.ts"}},
  {"tool": "list_files", "parameters": {"path": "src/components"}}
]}
\`\`\``;
}
