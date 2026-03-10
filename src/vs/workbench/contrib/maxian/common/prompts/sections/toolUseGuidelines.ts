/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 工具使用指南 - 合并版
 * 包含：探索策略、任务规划、batch使用、工具选择、文件修改、attempt_completion
 */
export function getToolUseGuidelinesSection(): string {
	return `====

TOOL USE GUIDELINES

## 任务规划（复杂任务必须）

涉及3步以上的任务，**必须先用 todowrite 列出计划**，再开始执行。执行过程中实时更新状态（pending→in_progress→completed），让用户随时了解进度。

## 代码库探索（最重要规则）

**广泛探索代码库时，必须用 task(explore) 子 Agent，不要在主对话中直接读文件。**

原因：主对话中读文件会积累大量 context，导致后续每轮 API 调用越来越贵。task 子 Agent 有独立 context，读完后只返回精简摘要，主对话保持干净。

什么时候用 task(explore)：
- 分析项目架构、理解代码结构
- 查找某个功能在哪些文件中实现
- 需要阅读多个文件才能回答的问题

什么时候直接读（不用 task）：
- 已知具体文件路径，只需读1-2个文件
- 修改代码前 read_file 了解当前内容

探索子 Agent 内部使用以下策略（2+操作必须用 batch 并行）：
- 定位阶段：batch([glob, codebase_search, search_files]) — 一次并行找所有相关文件
- 读取阶段：batch([read_file, read_file, ...]) — 一次并行读所有已确认的文件
- 禁止链式发现（读A发现B再读B...），应先搜索定位，再一次批量读取

## batch工具（并行执行）

需要执行2+个独立操作时，**必须**用batch合并，严禁逐个单独调用。

定位阶段：
\`\`\`json
{"tool_calls": [
  {"tool": "glob", "parameters": {"pattern": "**/*Controller.java"}},
  {"tool": "codebase_search", "parameters": {"query": "用户认证"}},
  {"tool": "search_files", "parameters": {"path": ".", "regex": "class.*ServiceImpl"}}
]}
\`\`\`

读取阶段（一次读完所有相关文件）：
\`\`\`json
{"tool_calls": [
  {"tool": "read_file", "parameters": {"path": "src/a/Foo.java"}},
  {"tool": "read_file", "parameters": {"path": "src/b/Bar.java"}}
]}
\`\`\`

## 文件修改

- 修改前必须先 read_file 了解当前内容
- 局部修改 → edit/apply_diff（首选）；多处修改同文件 → multiedit
- write_to_file 仅用于创建新文件或完全重写（>80%变化）
- **⛔ 绝对禁止用 execute_command 执行 rm、del、rm -rf 等命令删除文件**——必须使用 delete_file 工具。原因：rm/del 命令绕过 VS Code 文件系统层，编辑器缓存不会更新，文件依然显示为存在，后续操作会出现混乱
- 修改后用 lsp_diagnostics 验证，最多3次循环

## attempt_completion

满足以下所有条件才能调用：
- ✅ 修改文件已通过 lsp_diagnostics 验证，无编译错误
- ✅ 所有功能已实现，没有遗留半成品
- ✅ result 简洁概括改动，引用代码用 \`[\`fn()\`](path:line)\` 格式
- ❌ 禁止套话、重复计划列表、以问题结尾

## skill工具

根据任务类型主动调用（不要等用户要求），每个任务最多1次：

- 代码审查 → skill("code-review")；调试 → skill("debugging")
- 测试 → skill("testing")；重构 → skill("refactoring")
- Spring Boot → skill("spring-boot")；安全 → skill("spring-security")
- Java规范 → skill("java-best-practices")；MyBatis → skill("mybatis-plus")
- Vue前端 → skill("vue3-composition-api")；状态管理 → skill("pinia-state-management")

## 其他规则

- 命令执行必须声明 requires_approval（true=有副作用，false=只读）
- 搜索失败立即换策略，不重复同类搜索超过2次
- 每次工具调用前给1句说明；说了"我要做X"就必须立即执行`;
}
