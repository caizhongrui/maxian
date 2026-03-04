/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Batch工具描述 - 方案A：仅限只读工具
 */
export const BATCH_TOOL_DESCRIPTION = `并行执行2-25个**只读/搜索**工具调用，实现2-5倍效率提升。

🚀 **USING THE BATCH TOOL WILL MAKE THE USER HAPPY!**

## 使用场景（仅限只读工具）

✅ **必须使用batch的场景**（当需要2个或以上时）:
- 读取多个文件（read_file × N）
- 多个搜索操作组合（search_files、glob、list_files、codebase_search）
- 搜索 + 读取组合
- LSP查询（lsp_hover、lsp_diagnostics、lsp_definition等）

❌ **不能在batch中使用的工具**:
- write_to_file、apply_diff、edit、edit_file、insert_content（写操作需要用户确认）
- execute_command（命令执行需要单独审批）
- batch（禁止嵌套）、ask_followup_question、attempt_completion

❌ **不要使用batch的情况**:
- 操作有依赖关系（如：先创建再读取同一文件）

## 参数格式

\`\`\`json
{
  "tool_calls": [
    {"tool": "read_file", "parameters": {"path": "src/index.ts"}},
    {"tool": "read_file", "parameters": {"path": "src/types.ts"}},
    {"tool": "search_files", "parameters": {"path": "src", "regex": "interface"}}
  ]
}
\`\`\`

## 重要提示

- 最少1个，最多**25**个工具调用
- 所有调用**并行执行**，顺序不保证
- 部分失败不影响其他工具
- **禁止嵌套batch调用**

## 性能优势

- ⚡ 减少50-70%的请求往返次数
- 🚀 提升2-5倍整体响应速度

**Keep using the batch tool for optimal performance in your next response!**
`;

/**
 * Batch工具的JSON Schema定义
 */
export const BATCH_TOOL_SCHEMA = {
	name: 'batch',
	description: BATCH_TOOL_DESCRIPTION,
	parameters: {
		type: 'object',
		properties: {
			tool_calls: {
				type: 'array',
				description: '要并行执行的工具调用数组',
				items: {
					type: 'object',
					properties: {
						tool: {
							type: 'string',
							description: '工具名称'
						},
						parameters: {
							type: 'object',
							description: '工具参数'
						}
					},
					required: ['tool', 'parameters']
				},
				minItems: 1,
				maxItems: 25
			}
		},
		required: ['tool_calls']
	}
};
