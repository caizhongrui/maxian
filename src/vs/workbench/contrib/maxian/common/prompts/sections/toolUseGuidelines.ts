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

## ⚡ 效率规则（最高优先级）

1. **每次响应尽可能多做事** — 不要一次只调用一个搜索或读取工具。把你能预见的所有独立操作合并到一次batch调用中。
2. **探索阶段最多3轮** — 用1次batch(glob+codebase_search+search_files)定位文件，用1次batch(read_file x N)读取关键文件，然后立即开始修改。不要反复用glob搜索同一类文件。
3. **搜索失败立即换策略** — glob找不到就用codebase_search，codebase_search找不到就用search_files。绝不重复同类搜索超过2次。
4. **skill工具限制** — 每个任务最多调用1次skill。如果已经调用过skill，不要再调用。

## batch工具（必须掌握）

需要执行2+个独立操作时，**必须**使用batch工具并行执行：
\`\`\`json
{"tool_calls": [
  {"tool": "glob", "parameters": {"pattern": "**/*Controller*.java"}},
  {"tool": "codebase_search", "parameters": {"query": "登录认证", "path": "src"}},
  {"tool": "search_files", "parameters": {"path": "src", "regex": "login|auth"}}
]}
\`\`\`

读取多个文件 → batch：
\`\`\`json
{"tool_calls": [
  {"tool": "read_file", "parameters": {"path": "src/service.ts"}},
  {"tool": "read_file", "parameters": {"path": "src/types.ts"}},
  {"tool": "read_file", "parameters": {"path": "src/utils.ts"}}
]}
\`\`\`

编辑多个文件 → batch：
\`\`\`json
{"tool_calls": [
  {"tool": "apply_diff", "parameters": {"path": "src/api.ts", "diff": "..."}},
  {"tool": "apply_diff", "parameters": {"path": "src/utils.ts", "diff": "..."}}
]}
\`\`\`

## 工具选择

| 需求 | 工具 |
|------|------|
| 按文件名查找 | glob |
| 语义搜索 | codebase_search |
| 精确文本搜索 | search_files |
| 读取文件 | read_file |
| 局部修改 | edit 或 apply_diff（首选） |
| 多处修改同文件 | multiedit |
| 创建新文件 | write_to_file |
| 修改后验证 | lsp_diagnostics |

## 文件修改规则

- 修改前必须read_file了解当前内容
- 局部修改 → edit/apply_diff（首选，安全精确）
- write_to_file仅用于创建新文件或完全重写（>80%变化）
- 修改后用lsp_diagnostics验证（最多3次循环）

## 命令执行

- 每次调用必须声明requires_approval（true=有副作用，false=只读）
- 危险命令被系统自动阻止

## 进度叙述

- 每次工具调用前给出1-2句说明
- 说了"我要做X"就必须立即执行
- 不要重复已完成的内容`;
}
