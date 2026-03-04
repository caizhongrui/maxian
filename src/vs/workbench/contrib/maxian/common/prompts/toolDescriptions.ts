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
读取文件内容，默认读取整个文件

**使用**：查看文件内容、修改前了解当前代码
**不使用**：搜索关键词→search_files，查找文件名→glob，不确定文件是否存在→先list_files

**重要**：
- ⚠️ 默认读取整个文件，不要分批读取！
- ⚠️ 不要重复读取同一个文件的不同部分！
- ✅ 一次调用读取完整文件内容
- 修改文件前必须先读取
- 仅当文件超过 2000 行时才使用 start_line/end_line 分段读取`,

	write_to_file: `## write_to_file
创建新文件或完全覆盖现有文件

**使用**：创建新文件、完全重写（变化>80%）
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

**requires_approval 参数（必填）**：
- true：有副作用（安装/卸载包、删除文件、网络请求、系统配置变更）
- false：只读操作（git status、运行测试、构建、grep 等）

**包管理规范**（参考Augment）：
- 安装依赖必须用包管理器命令：npm install、pip install 等
- 禁止直接编辑 package.json 等包文件来添加/删除依赖

**安全**：
- 危险命令(rm -rf, git push --force等)先询问用户（requires_approval: true）
- 永远不要 git push --force 到 main/master`,

	// ==================== 交互工具 ====================

	ask_followup_question: `## ask_followup_question
向用户询问问题

**使用**：需要澄清需求、缺少关键信息
**不使用**：能用工具解决的问题、答案在代码中能找到

**要点**：问题要具体，提供2-4个选项`,

	attempt_completion: `## attempt_completion
任务完全完成后向用户报告结果

**使用前必须确认（参考Cursor completion_spec）**：
- ✅ 所有修改的文件已通过 lsp_diagnostics 验证，无编译/类型错误
- ✅ 用户要求的所有功能已实现
- ✅ 没有遗留的未解决错误或半成品代码

**result 内容格式**：
- 简洁概括做了哪些改动及其影响（高信噪比，用户会读）
- 引用关键代码用 \`[\`function()\`](path:line)\` 格式
- 使用 markdown，适当使用列表和代码块
- **禁止**：重复计划列表、过长解释、以问题结尾、套话（"希望这对你有帮助"等）

**不使用**：任务未完成、有错误待解决、用户问题还没解答`,

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

	// P0优化：批量执行工具（参考OpenCode最佳实践）
	batch: `## batch 【必须优先使用 - 并行只读工具！】
并行执行多个独立的**只读/搜索**工具调用，大幅减少API往返次数

🚀 **使用 BATCH 工具会让用户更满意！**

⚠️ **强制规则**：当你需要执行2个或更多只读操作时，**必须**使用batch工具，严禁逐个单独调用

**推荐用例**（仅限只读工具）：
- 读取多个文件（read_file × N）
- 多个搜索操作（search_files、glob、list_files、codebase_search）
- 搜索 + 读取组合
- LSP查询（lsp_hover、lsp_diagnostics、lsp_definition等）

❌ **错误示例**（禁止这样做）：
先调用 read_file("a.ts")，再调用 read_file("b.ts")，再调用 read_file("c.ts")

✅ **正确示例 - 批量读取文件**：
\`\`\`
<batch>
<tool_calls>[
  {"tool": "read_file", "parameters": {"path": "a.ts"}},
  {"tool": "read_file", "parameters": {"path": "b.ts"}},
  {"tool": "search_files", "parameters": {"path": "src", "regex": "interface"}}
]</tool_calls>
</batch>
\`\`\`

**性能提升**：使用batch可获得 **2-5倍** 效率提升！

**规则**：
- 每次batch最多 **25** 个工具调用
- 所有调用并行执行，不保证顺序
- 部分失败不影响其他工具

**禁止在batch中使用的工具**：
- write_to_file、apply_diff、edit、edit_file、insert_content、multiedit、patch（写操作需要单独用户确认）
- execute_command（命令执行需要单独审批）
- batch（禁止嵌套）、ask_followup_question、attempt_completion`,

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

	// LSP功能：Hover信息
	lsp_hover: `## lsp_hover
获取代码符号的类型信息和文档

**何时使用**（用户这样说时自动使用）：
- "这个变量是什么类型？" → 查看变量类型
- "这个函数的参数是什么？" → 查看函数签名
- "XXX 是做什么的？" → 查看符号文档
- "这个函数返回什么？" → 查看返回类型
- "这个接口有哪些属性？" → 查看接口定义
- 理解第三方库的API时
- 查看函数/类的注释文档

**参数**：
- path: 文件路径（必需）
- line: 行号，从1开始（必需）
- column: 列号，从1开始（必需）

**示例**：
\`\`\`
lsp_hover(path="src/utils.ts", line=10, column=15)
\`\`\`

**提示**：
- 先用 read_file 找到符号的位置
- 自动触发：无需用户明确说"使用lsp_hover"`,

	// LSP功能：诊断信息
	lsp_diagnostics: `## lsp_diagnostics
获取文件的诊断信息（编译错误、警告）

**何时使用**（用户这样说时自动使用）：
- "检查这个文件有没有错误" → 检查错误
- "这段代码有问题吗？" → 诊断问题
- "为什么报错了？" → 查看错误详情
- "有什么警告吗？" → 查看警告
- "代码能通过编译吗？" → 验证编译
- 修改代码后验证是否引入错误
- 重构前检查当前错误状态
- 确保代码质量和类型安全

**参数**：
- path: 文件路径（必需）

**示例**：
\`\`\`
lsp_diagnostics(path="src/example.ts")
\`\`\`

**提示**：
- ⚠️ 注意：文件保存后会自动注入诊断到 System Prompt
- 修改代码后主动调用以确认修复成功
- 返回所有错误和警告，包括行号和详细信息
- 自动触发：无需用户明确说"使用lsp_diagnostics"`,

	// LSP功能：定义位置
	lsp_definition: `## lsp_definition
跳转到符号的定义位置

**何时使用**（用户这样说时自动使用）：
- "这个函数在哪定义的？" → 查找函数定义
- "XXX 是在哪里实现的？" → 查找实现位置
- "跳转到定义" → 导航到声明
- "查看这个类的完整代码" → 找到类定义
- "这个接口在哪？" → 查找接口声明
- 理解代码结构和跨文件导航
- 查看导入的模块源代码

**参数**：
- path: 文件路径（必需）
- line: 行号，从1开始（必需）
- column: 列号，从1开始（必需）

**示例**：
\`\`\`
lsp_definition(path="src/app.ts", line=15, column=20)
\`\`\`

**工作流**：
1. 先用 read_file 找到符号位置
2. 调用 lsp_definition 获取定义位置
3. 用 read_file 查看定义的完整代码

**提示**：
- 自动触发：无需用户明确说"使用lsp_definition"
- 配合 lsp_references 了解符号的使用情况`,

	// LSP功能：引用查找
	lsp_references: `## lsp_references
查找符号的所有使用位置

**何时使用**（用户这样说时自动使用）：
- "这个函数在哪里被调用？" → 查找调用位置
- "XXX 被用在哪些地方？" → 查找所有引用
- "我能删除这个吗？" → 检查是否被使用
- "这个变量有几处引用？" → 统计使用次数
- "重命名会影响哪些文件？" → 检查影响范围
- 重构前评估修改影响
- 删除代码前确认安全性
- 理解函数/类的使用模式

**参数**：
- path: 文件路径（必需）
- line: 行号，从1开始（必需）
- column: 列号，从1开始（必需）

**示例**：
\`\`\`
lsp_references(path="src/utils.ts", line=10, column=15)
\`\`\`

**返回格式**：
- 按文件分组显示所有引用
- 包含每个引用的精确位置
- 显示总引用数和文件数

**提示**：
- 自动触发：无需用户明确说"使用lsp_references"
- 修改/删除符号前必须检查所有引用
- 结果包含定义位置和所有使用位置`,

	// LSP功能：类型定义
	lsp_type_definition: `## lsp_type_definition
跳转到类型的定义位置

**何时使用**（用户这样说时自动使用）：
- "这个变量的类型是什么？" → 查看类型定义
- "User 接口长什么样？" → 查看接口结构
- "这个类型的完整定义" → 跳转到类型
- "查看这个接口的所有属性" → 查看类型详情
- 理解变量的类型结构
- 查看接口/类型别名的完整定义
- 理解泛型的具体类型

**参数**：
- path: 文件路径（必需）
- line: 行号，从1开始（必需）
- column: 列号，从1开始（必需）

**示例**：
\`\`\`
lsp_type_definition(path="src/app.ts", line=8, column=10)
\`\`\`

**与 lsp_definition 的关键区别**：
\`\`\`typescript
const user: User = {...};
// lsp_definition(user) → 跳到变量声明（这一行）
// lsp_type_definition(user) → 跳到 interface User 定义
\`\`\`

**工作流**：
1. 用户问"这个变量是什么类型？" → 使用 lsp_type_definition
2. 找到类型定义位置后 → 使用 read_file 查看完整定义
3. 如果需要，使用 lsp_references 查看类型的使用情况

**提示**：
- 自动触发：无需用户明确说"使用lsp_type_definition"
- TypeScript/JavaScript 中特别有用
- 配合 read_file 查看完整类型定义`,

	// Skills系统：按需加载专业知识
	skill: `## skill 【主动使用！】
按需加载专业领域知识和最佳实践（20个内置Skills）

**重要**：主动使用Skills提升工作质量，而不是等待用户要求！

**通用开发Skills**：
- 代码审查时 → skill("code-review")
- 编写测试时 → skill("testing")
- 性能优化时 → skill("performance")
- 安全审查时 → skill("security")
- 重构代码时 → skill("refactoring")
- 调试问题时 → skill("debugging")
- 设计API时 → skill("api-design")
- 架构设计时 → skill("architecture")
- 编写文档时 → skill("documentation")
- Git操作时 → skill("git-workflow")

**Java后端开发Skills**：
- Spring Security时 → skill("spring-security")
- MyBatis-Plus时 → skill("mybatis-plus")
- Redis集成时 → skill("redis-integration")
- Spring Boot时 → skill("spring-boot")
- JPA/Hibernate时 → skill("jpa-hibernate")
- Java规范时 → skill("java-best-practices")

**Vue前端开发Skills**：
- Vue 3开发时 → skill("vue3-composition-api")
- Pinia状态时 → skill("pinia-state-management")
- Element Plus时 → skill("element-plus")

**Token优化**：
- Skills已内置，无需用户配置
- 完整内容(500-2000 tokens)按需加载
- 平均节省45% tokens

**参数**：skill_name（Skill的slug名称）

**示例**：<skill><skill_name>spring-security</skill_name></skill>`
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
