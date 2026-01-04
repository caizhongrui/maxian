/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolName } from '../tools/toolTypes.js';

/**
 * 工具描述映射 - 精简版
 * 只包含关键的使用场景指南，参数详情由 tools 数组提供
 */
const TOOL_DESCRIPTIONS: Record<ToolName, string> = {

	// ==================== 文件操作工具 ====================

	read_file: `## read_file
读取文件内容，支持行范围限制

**使用**：查看文件内容、修改前了解当前代码
**不使用**：搜索关键词→search_files，查找文件名→glob，不确定文件是否存在→先list_files

**要点**：
- 修改文件前必须先读取
- 大文件用 start_line/end_line 分段读取`,

	write_to_file: `## write_to_file
创建新文件或完全覆盖现有文件

**使用**：创建新文件、完全重写（变化>50%）
**不使用**：小改动→apply_diff，局部修改→apply_diff，插入内容→insert_content

**要点**：
- 必须提供完整内容，禁止使用占位符
- 写入前先 read_file 了解原文件`,

	apply_diff: `## apply_diff
使用SEARCH/REPLACE块编辑文件（修改代码的首选工具）

**使用**：修改现有文件的任何部分
**不使用**：创建新文件→write_to_file，完全重写→write_to_file

**格式**：
\`\`\`
<<<<<<< SEARCH
原始代码（必须精确匹配）
=======
新代码
>>>>>>> REPLACE
\`\`\`

**要点**：
- SEARCH块必须与文件精确匹配（包括空格、缩进）
- 先 read_file 确认当前内容
- 一次可包含多个块`,

	list_files: `## list_files
列出目录中的文件和子目录

**使用**：了解目录结构、确认文件存在
**不使用**：按文件名模式查找→glob，按内容查找→search_files`,

	glob: `## glob
使用Glob模式匹配文件名

**使用**：按扩展名查找(*.ts)、按命名模式查找(test_*.py)
**不使用**：按内容查找→search_files，浏览目录→list_files

**常用模式**：
- \`**/*.ts\` 所有TS文件
- \`src/**/*.tsx\` src下所有TSX
- \`**/*.test.ts\` 所有测试文件`,

	insert_content: `## insert_content
在文件指定位置插入内容

**使用**：追加内容、在特定行后插入
**不使用**：替换代码→apply_diff，创建新文件→write_to_file

**参数 line**：行号，0表示文件末尾`,

	edit_file: `## edit_file
编辑文件内容

**使用**：代码修改（apply_diff 的替代方案）
**参数**：target_file(文件路径)、instructions(编辑说明)、code_edit(代码内容)`,

	// ==================== 搜索工具 ====================

	search_files: `## search_files
在文件内容中搜索文本或正则表达式

**使用**：知道关键词时搜索、查找函数调用、搜索TODO/FIXME
**不使用**：不知道关键词→codebase_search，查找文件名→glob

**参数 regex**：支持正则表达式`,

	codebase_search: `## codebase_search
语义搜索代码库 - 探索未知代码的首选工具

**使用**：探索未知代码（必须首选）、不知道关键词时、理解功能实现
**不使用**：已知关键词→search_files，已知路径→read_file

**要点**：
- 探索新代码区域必须首先使用此工具
- 使用自然语言描述，如"用户认证逻辑"`,

	list_code_definition_names: `## list_code_definition_names
列出代码文件中的定义（函数、类、方法等）

**使用**：快速了解文件结构
**不使用**：需要完整实现→read_file`,

	// ==================== 命令执行工具 ====================

	execute_command: `## execute_command
在终端执行命令

**使用**：构建、测试、安装依赖、Git操作
**不使用**：读文件→read_file，搜索→search_files，编辑→apply_diff

**安全**：
- 危险命令(rm -rf, git push --force等)先询问用户
- 永远不要 git push --force 到 main/master`,

	// ==================== 交互工具 ====================

	ask_followup_question: `## ask_followup_question
向用户询问问题

**使用**：需要澄清需求、缺少关键信息
**不使用**：能用工具解决的问题、答案在代码中能找到

**要点**：问题要具体，提供2-4个选项`,

	attempt_completion: `## attempt_completion
完成任务并报告结果

**使用**：任务真正完成时
**不使用**：任务未完成、有错误待解决

**要点**：清晰描述完成了什么，不要以问题结尾`,

	new_task: `## new_task
创建新的子任务

**使用**：任务复杂需要分解、发现额外工作`,

	update_todo_list: `## update_todo_list
管理和跟踪任务进度

**使用**：复杂多步骤任务（3个以上步骤）
**不使用**：单一简单任务

**参数 todos**：待办事项数组，每个元素包含：
- content: 任务描述（祈使句，如"实现登录功能"）
- status: 状态（pending/in_progress/completed）
- activeForm: 进行中描述（现在进行时，如"正在实现登录功能"）

**示例**：
\`\`\`json
{
  "todos": [
    {"content": "分析现有代码", "status": "completed", "activeForm": "分析现有代码"},
    {"content": "实现新功能", "status": "in_progress", "activeForm": "正在实现新功能"},
    {"content": "编写测试", "status": "pending", "activeForm": "编写测试"}
  ]
}
\`\`\`

**要点**：
- 每个任务独立一个对象，不要合并
- 同时只有一个任务为 in_progress
- 完成任务后立即标记为 completed`,

	// P0优化：批量执行工具
	batch: `## batch 【最重要的工具 - 必须优先使用！】
并行执行多个独立的读取/搜索工具调用

⚠️ **强制规则**：当你需要执行2个或更多以下操作时，**必须**使用batch工具：
- read_file（读取多个文件）
- search_files（多处搜索）
- glob（多个模式匹配）
- list_files（多个目录）
- codebase_search（多个查询）

❌ **错误示例**（禁止这样做）：
先调用 read_file("a.ts")，再调用 read_file("b.ts")，再调用 read_file("c.ts")

✅ **正确示例**（必须这样做）：
\`\`\`
<batch>
<tool_calls>[
  {"tool": "read_file", "parameters": {"path": "a.ts"}},
  {"tool": "read_file", "parameters": {"path": "b.ts"}},
  {"tool": "read_file", "parameters": {"path": "c.ts"}}
]</tool_calls>
</batch>
\`\`\`

**性能提升**：使用batch可获得2-5倍效率提升！

**规则**：
- 每次batch最多10个工具调用
- 禁止在batch中使用：batch、apply_diff、write_to_file、execute_command`,

	// P1优化：多处编辑工具
	multiedit: `## multiedit
在单个文件中执行多处编辑操作（原子性）

**使用**：需要修改同一文件的多个位置
**不使用**：只修改一处→apply_diff，创建新文件→write_to_file

**要点**：
- 所有编辑要么全部成功，要么全部不执行
- 编辑按顺序执行，每个基于前一个的结果

**参数**：path（文件路径）、edits（编辑数组）
每个edit包含：old_string、new_string、replace_all(可选)`,

	// P0优化：独立edit工具
	edit: `## edit
基于old_string/new_string的容错字符串替换

**使用**：修改文件中的特定内容，需要容错匹配时
**不使用**：创建新文件→write_to_file，大段代码修改→apply_diff

**容错能力**：支持9种匹配策略
- SimpleReplacer（精确匹配）
- LineTrimmedReplacer（行首尾空白容错）
- BlockAnchorReplacer（首尾行锚点）
- WhitespaceNormalizedReplacer（空白归一化）
- IndentationFlexibleReplacer（缩进灵活）
- EscapeNormalizedReplacer（转义字符）
- TrimmedBoundaryReplacer（边界trim）
- ContextAwareReplacer（上下文感知）
- MultiOccurrenceReplacer（多处匹配）

**参数**：path、old_string、new_string、replace_all(可选)、create_if_missing(可选)`,

	// P1优化：子任务委托
	task: `## task
将复杂任务委托给子Agent执行

**使用**：
- 独立的子任务，可并行执行
- 需要专门上下文的任务
- 分解复杂任务

**不使用**：简单任务、需要共享上下文的任务

**子Agent类型**：
- general-purpose：通用任务
- explore：快速代码探索
- plan：架构规划

**参数**：prompt（任务描述）、subagent_type(可选)`,

	// P1优化：多文件补丁
	patch: `## patch
批量执行多文件操作

**使用**：
- 重命名多个文件
- 创建多个新文件
- 批量修改文件

**不使用**：单文件操作→apply_diff/edit/write_to_file

**参数**：patches - JSON数组，每项包含：
- action: "create" | "modify" | "delete" | "rename"
- path: 文件路径
- content: 文件内容（create/modify）
- new_path: 新路径（rename）`,

	// P0优化：网页获取
	webfetch: `## webfetch
获取网页内容并转换为Markdown

**使用**：
- 获取API文档
- 读取网页内容
- 获取外部资源

**要点**：
- 自动HTML转Markdown
- 支持缓存（useCache参数）
- 自动处理重定向

**参数**：url（网址）、useCache(可选)、format(可选)`,

	// P1优化：LSP悬停
	lsp_hover: `## lsp_hover
获取代码位置的LSP悬停信息

**使用**：获取类型、函数签名、文档等
**参数**：path（文件路径）、line（行号）、column（列号）`,

	// P1优化：LSP诊断
	lsp_diagnostics: `## lsp_diagnostics
获取文件的LSP诊断信息（错误、警告）

**使用**：获取编译错误、类型错误、lint警告等
**参数**：path（文件路径）`
};

/**
 * 生成工具描述section - 精简版
 */
export function getToolDescriptions(workspaceRoot: string, availableTools: ToolName[]): string {
	const descriptions = availableTools
		.map(tool => TOOL_DESCRIPTIONS[tool])
		.filter(Boolean)
		.join('\n\n');

	return `====

TOOLS

以下是可用工具的使用指南（参数详情见工具定义）。

**选择原则**：
1. 探索未知代码 → codebase_search（首选）
2. 修改文件 → apply_diff（首选）
3. 搜索：知道关键词→search_files，不知道→codebase_search

${descriptions}`;
}
