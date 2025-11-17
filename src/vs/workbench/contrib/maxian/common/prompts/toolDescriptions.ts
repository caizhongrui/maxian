/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolName } from '../tools/toolTypes.js';

/**
 * 工具描述映射
 * 每个工具的详细描述，用于系统提示词
 */
const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
	read_file: `## read_file
读取指定文件的内容

**用途**：查看文件内容以理解代码、配置或文档

**参数**：
- path (string, required): 文件路径（相对于工作区根目录）

**最佳实践**：
- 修改文件前先读取以了解当前内容
- 大文件建议先用 search_files 定位关键部分
- 二进制文件可能无法正确读取`,

	write_to_file: `## write_to_file
创建新文件或完全覆盖现有文件

**用途**：创建新文件或完全重写文件内容

**参数**：
- path (string, required): 文件路径
- content (string, required): 完整文件内容

**关键规则**：
- 必须提供完整文件内容，不允许省略部分
- 禁止使用 "// 其余代码不变" 等占位符
- 小改动优先使用 edit_file 或 insert_content
- 会自动创建不存在的目录`,

	list_files: `## list_files
列出目录中的文件和子目录

**用途**：探索项目结构、查找文件

**参数**：
- path (string, optional): 目录路径（默认为工作区根目录）
- recursive (boolean, optional): 是否递归列出子目录（默认 false）

**注意**：
- 递归列出大型项目可能产生大量输出
- 优先列出特定子目录而非整个项目`,

	execute_command: `## execute_command
在终端执行命令

**用途**：运行构建、测试、安装依赖等操作

**参数**：
- command (string, required): 要执行的命令
- cwd (string, optional): 工作目录（可选）

**安全规则**：
- 危险命令（rm -rf、格式化等）执行前询问用户
- 长时间运行的命令应告知用户
- 命令失败时分析错误并提供解决方案

**技巧**：
- 使用 cd && command 在特定目录执行
- 检查操作系统兼容性`,

	search_files: `## search_files
在文件中搜索文本或正则表达式模式

**用途**：查找代码、注释、配置等

**参数**：
- pattern (string, required): 搜索模式（支持正则表达式）
- path (string, optional): 搜索路径（默认为工作区）

**最佳实践**：
- 精心设计正则表达式以平衡精确度和灵活性
- 结果过多时缩小搜索范围或使用更精确的模式
- 利用搜索结果的上下文理解代码
- 配合 read_file 查看完整上下文`,

	codebase_search: `## codebase_search
语义搜索代码库

**用途**：基于含义而非关键词查找相关代码

**参数**：
- query (string, required): 搜索查询（自然语言描述）

**关键优势**：
- 理解代码含义，比 search_files 更智能
- 探索未知代码时必须优先使用
- 可以找到功能相关但关键词不同的代码

**使用规则**：
- **关键：探索任何新代码区域时必须先用此工具**
- 即使已探索部分代码，新功能仍需先用此工具
- 搜索后可用 search_files 或 read_file 深入了解`,

	ask_followup_question: `## ask_followup_question
向用户询问问题以获取更多信息

**用途**：澄清需求、获取缺失信息

**参数**：
- question (string, required): 要问的问题

**使用原则**：
- 仅在真正需要时使用
- 能用工具解决的问题不要问用户
- 问题要清晰、具体、可操作
- 提供 2-4 个建议答案供用户选择

**例子**：
好的问题："应该在哪个目录创建配置文件？A) src/config B) config/ C) 项目根目录 D) 其他"
不好的问题："你想怎么做？"`,

	attempt_completion: `## attempt_completion
完成任务并报告结果

**用途**：标记任务完成并向用户展示结果

**参数**：
- result (string, required): 任务完成的详细描述
- command (string, optional): 用户可能需要运行的命令

**关键规则**：
- 任务真正完成时才使用
- 结果描述要清晰、完整
- 不要以问题结尾
- 不要使用对话式语言

**例子**：
好的结果："已实现用户登录功能。添加了3个文件：auth.ts、login.tsx、authApi.ts。可以运行 npm test 验证功能。"
不好的结果："完成了！还有什么需要帮助的吗？"`,

	new_task: `## new_task
创建新的子任务

**用途**：将复杂任务分解为多个子任务

**参数**：
- task (string, required): 子任务描述

**使用场景**：
- 当前任务过于复杂，需要分步执行
- 发现需要额外的独立工作
- 用户提出新的相关需求`,

	update_todo_list: `## update_todo_list
更新任务待办列表

**用途**：跟踪任务进度、管理多个待办项

**参数**：
- todos (array, required): 待办事项列表

**最佳实践**：
- 将大任务拆分为小的可执行步骤
- 及时更新完成状态
- 保持列表有序和最新`,

	list_code_definition_names: `## list_code_definition_names
列出代码文件中的定义

**用途**：快速了解文件中的函数、类、方法等定义

**参数**：
- path (string, required): 代码文件路径

**应用**：
- 了解代码结构
- 查找特定函数或类
- 代码导航`,

	insert_content: `## insert_content
在文件的指定位置插入内容

**用途**：向现有文件添加新内容

**参数**：
- path (string, required): 文件路径
- position (string, required): 插入位置（行号，0表示文件末尾）
- content (string, required): 要插入的内容

**使用场景**：
- 添加新函数到文件
- 在特定位置插入导入语句
- 添加配置项

**注意**：
- 行号从1开始，0表示文件末尾
- 不会覆盖现有内容，只插入`,

	apply_diff: `## apply_diff
使用SEARCH/REPLACE块精确编辑文件

**用途**：对现有文件进行精确、可靠的修改

**参数**：
- path (string, required): 文件路径（相对或绝对）
- diff (string, required): 一个或多个SEARCH/REPLACE块

**SEARCH/REPLACE块格式**：
\`\`\`
<<<<<<< SEARCH
要查找的代码
=======
替换后的代码
>>>>>>> REPLACE
\`\`\`

**关键规则**：
1. SEARCH块必须与文件内容精确匹配（空格、缩进、换行符）
2. 一次可以应用多个SEARCH/REPLACE块
3. SEARCH内容要足够独特以避免歧义
4. 保持原有缩进风格
5. 可以使用空REPLACE块来删除代码

**最佳实践**：
- 多个相关改动使用多个块，不要分多次调用
- SEARCH块包含足够上下文确保唯一性
- 修改前先用read_file确认文件当前内容
- 大范围改动优先使用apply_diff而非write_to_file

**示例**：
修改函数并添加新导入：
\`\`\`
<<<<<<< SEARCH
import { useState } from 'react';
=======
import { useState, useEffect } from 'react';
>>>>>>> REPLACE

<<<<<<< SEARCH
function App() {
  const [count, setCount] = useState(0);
=======
function App() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    console.log('Count changed:', count);
  }, [count]);
>>>>>>> REPLACE
\`\`\`

**错误处理**：
- SEARCH不匹配时会报告相似度和建议
- 支持模糊匹配以容忍轻微的空格差异
- 失败时会显示详细错误信息指导修正`,

	edit_file: `## edit_file
编辑文件内容（查找替换）

**用途**：精确修改文件的特定部分

**参数**：
- path (string, required): 文件路径
- oldText (string, required): 要替换的文本
- newText (string, required): 新文本

**最佳实践**：
- oldText 要足够独特以准确匹配
- 包含上下文以避免错误替换
- 小改动优先使用此工具而非 write_to_file

**例子**：
oldText: "const port = 3000;"
newText: "const port = 8080;"`,

	glob: `## glob
使用Glob模式匹配文件

**用途**：根据文件名模式查找文件

**参数**：
- path (string, required): 要搜索的目录路径
- file_pattern (string, required): Glob模式（支持通配符）

**通配符说明**：
- * : 匹配任意字符（不包括路径分隔符）
- ** : 匹配任意层级目录
- ? : 匹配单个字符
- [] : 匹配字符集合

**使用示例**：
- "**/*.ts" : 查找所有TypeScript文件
- "src/**/*.js" : 查找src目录下所有JavaScript文件
- "test/**/*.spec.ts" : 查找所有测试文件
- "*.json" : 查找当前目录的所有JSON文件

**最佳实践**：
- 需要按文件类型查找时使用此工具
- 模式要足够精确以避免匹配过多文件
- 配合 read_file 查看匹配到的文件内容`
};

/**
 * 生成工具描述section
 */
export function getToolDescriptions(workspaceRoot: string, availableTools: ToolName[]): string {
	const descriptions = availableTools
		.map(tool => TOOL_DESCRIPTIONS[tool])
		.filter(Boolean)
		.join('\n\n');

	return `====

TOOLS

以下是你可以使用的工具。每个工具都有特定的用途和使用规则，请仔细阅读。

${descriptions}`;
}
