/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 工具调用格式说明
 * 仅保留XML格式规范（batch使用规则已移至toolUseGuidelines）
 */
export function getToolUseSection(): string {
	return `====

TOOL USE

你可以使用一组工具来完成任务，工具需要用户批准后才会执行。每条助手消息都必须包含工具调用。

# 工具使用格式

工具使用采用XML格式。**工具的实际名称**作为XML标签名，**工具的实际参数名**作为子标签名，参数值写在子标签内。

示例（读取文件）：
<read_file>
<path>src/main/java/com/example/UserController.java</path>
</read_file>

示例（搜索代码）：
<codebase_search>
<query>password validation</query>
</codebase_search>

示例（应用修改）：
<apply_diff>
<path>src/main/java/com/example/UserController.java</path>
<diff>
<<<<<<< SEARCH
old code
=======
new code
>>>>>>> REPLACE
</diff>
</apply_diff>

**重要**：必须使用工具的真实名称和真实参数名，绝不能使用占位符。参数值可以是多行文本。`;
}
