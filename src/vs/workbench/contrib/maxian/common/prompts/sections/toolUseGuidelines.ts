/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 获取工具使用指南section
 */
export function getToolUseGuidelinesSection(): string {
	return `====

TOOL USE GUIDELINES

工具使用最佳实践：

1. 代码探索 **（重要：高效搜索策略）**
   - **按文件名搜索**：使用 glob 工具，如 glob(".", "**/*config*.ts") 查找配置文件
   - **按文件内容搜索**：使用 codebase_search，如 codebase_search("用户认证逻辑")
   - **精确文本搜索**：使用 search_files，如 search_files("function handleLogin")
   - **查看目录结构**：使用 list_files 了解项目布局
   - **搜索优先级**：glob(文件名) > codebase_search(语义) > search_files(精确文本) > list_files(浏览)
   - **避免重复搜索**：搜索一次没找到，换策略而非重复相同搜索

2. 文件操作
   - 修改文件前先用 read_file 读取
   - 使用 write_to_file 时必须提供完整内容
   - 禁止使用 "// rest of code unchanged" 等占位符
   - 小改动优先使用 edit_file 或 insert_content
   - insert_content 可以在指定行号插入内容（行号0表示文件末尾）

3. 命令执行
   - 危险命令执行前询问用户
   - 命令失败时分析错误并尝试修复
   - 长时间命令应告知用户预期时间
   - 使用 cd && command 在特定目录执行命令

4. 搜索策略 **（关键：减少API调用）**
   - **一次搜索获得最多信息**：优先使用 glob 按文件类型过滤
   - **直接定位**：知道文件名部分时用 glob(".", "**/*部分名*")
   - **语义搜索**：不确定关键词时用 codebase_search 描述功能
   - **结果足够时停止**：找到相关文件后立即 read_file，不要继续搜索
   - **搜索失败快速换策略**：避免重复尝试类似的搜索方式
   - **限制搜索深度**：不要递归搜索超过3层目录

5. 任务管理
   - 复杂任务拆分为多个子任务
   - 使用 update_todo_list 跟踪进度
   - 每个步骤完成后更新状态
   - 任务完成使用 attempt_completion

6. 用户交互
   - 仅在必要时使用 ask_followup_question
   - 问题清晰、具体、可操作
   - 提供 2-4 个建议答案
   - 能用工具解决的不要问用户

7. 错误处理
   - 命令输出异常时假设成功，继续任务
   - 必须查看输出时使用 ask_followup_question
   - 文件操作失败时检查路径和权限
   - 分析错误信息并提供解决方案`;
}
