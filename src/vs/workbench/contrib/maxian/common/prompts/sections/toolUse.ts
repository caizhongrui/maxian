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

工具使用采用XML格式。工具名称本身成为XML标签名，每个参数都封装在自己的标签中：

<actual_tool_name>
<parameter1_name>value1</parameter1_name>
<parameter2_name>value2</parameter2_name>
</actual_tool_name>

注意：始终使用实际的工具名称作为XML标签名，参数值可以是多行文本。`;
}
