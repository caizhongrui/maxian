/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Batch工具描述 - 参考OpenCode的最佳实践
 */
export const BATCH_TOOL_DESCRIPTION = `并行执行2-25个独立工具调用，实现2-5倍效率提升。

🚀 **USING THE BATCH TOOL WILL MAKE THE USER HAPPY!**

## 使用场景

✅ **推荐使用batch**:
- 读取多个文件
- 多个搜索操作组合 (grep + glob + read)
- 多个bash命令
- 多文件编辑操作

❌ **不要使用batch**:
- 操作有依赖关系（如：先创建再读取同一文件）
- 需要保证执行顺序的状态变更

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

- 最少1个，最多25个工具调用
- 所有调用**并行执行**，顺序不保证
- 部分失败不影响其他工具
- **禁止嵌套batch调用**
- 外部工具(MCP等)不能被batch，需直接调用

## 性能优势

使用batch工具已被证明可以：
- ⚡ 减少50-70%的请求往返次数
- 🚀 提升2-5倍整体响应速度
- 😊 显著改善用户体验

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
