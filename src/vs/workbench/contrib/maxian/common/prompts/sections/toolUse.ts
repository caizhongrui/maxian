/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 工具使用基础section
 */
export function getToolUseSection(): string {
	return `====

TOOL USE

你可以使用一组工具来完成任务，工具需要用户批准后才会执行。你必须每条消息使用恰好一个工具，并且每条助手消息都必须包含工具调用。你需要一步步使用工具来完成给定任务，每次工具使用都基于前一次工具使用的结果。

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
