/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ToolName } from '../tools/toolTypes.js';

/**
 * 工具描述映射 - 精简版
 * 只包含关键的使用场景指南，参数详情由 tools 数组提供
 */
const TOOL_DESCRIPTIONS: Partial<Record<ToolName, string>> = {

	// ==================== 文件操作工具 ====================

	read_file: `## read_file
读取文件或目录内容

**使用**：查看文件真实内容、编辑前确认上下文
**不使用**：查文件名→glob，查目录结构→list_files，按内容搜关键词→search_files

**重要**：
- 修改前必须先读取完整文件
- 默认最多返回前 2000 行；大文件再用 start_line/end_line 读取更大窗口
- 避免反复读取很小的切片；需要更多上下文时，直接读更大的窗口
- 如果同一文件刚改过又还要继续改，优先重新读取完整当前版本，再把剩余改动合并
- 如果不确定路径是否正确，先用 glob 或 list_files`,

	write_to_file: `## write_to_file
创建新文件或完整重写文件

**使用**：创建新文件、极少数确实需要整体重写的文件
**不使用**：局部修改已有文件→edit / multiedit / apply_diff

**要点**：
- 必须提供完整内容，禁止使用占位符
- 对已有文件写入前必须先 read_file
- 默认优先 edit / multiedit；不要为了省事直接整文件覆盖
- 如果同一已有文件还要继续补多个点，不要连续多次整文件重写
- 不要主动创建 README、说明文档、*.md 文件，除非用户明确要求`,

	apply_diff: `## apply_diff
使用SEARCH/REPLACE块编辑文件（非首选，仅特殊场景）

**使用**：行号敏感修改、外部已给 patch/SEARCH-REPLACE 块
**不使用**：普通文本替换→edit / multiedit，创建新文件→write_to_file，完全重写→write_to_file

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
- 如果同一文件要继续补多个点，优先改成一次 multiedit 或一次多块 apply_diff，不要拆成多轮小补丁
- 同一文件可在一次调用中包含多个块`,

	list_files: `## list_files
列出目录中的文件和子目录

**使用**：了解目录结构、确认文件存在
**不使用**：按文件名模式查找→glob，按内容查找→search_files`,

	glob: `## glob
使用Glob模式匹配文件名

**使用**：不确定文件路径、按文件名或扩展名找文件
**不使用**：按内容查找→search_files，浏览目录→list_files

**重要**：
- 找到候选文件后立刻 read_file，不要继续扩大搜索范围
- 只有当搜索明显跨多个模块、需要多轮独立调查时，才考虑改用 task(explore)

**常用模式**：
- \`**/*.ts\` 所有TS文件
- \`src/**/*.tsx\` src下所有TSX
- \`**/*.test.ts\` 所有测试文件`,

	// ==================== 搜索工具 ====================

	search_files: `## search_files
在文件内容中搜索文本或正则表达式

**使用**：已知关键词、符号名、字符串字面量或正则时搜索内容
**不使用**：查文件名→glob，查目录→list_files

**重要**：
- 默认返回匹配文件路径，而不是完整内容；先缩小到文件，再 read_file
- 如果你其实是在找文件名，不要滥用此工具，改用 glob
- 如果已经缩小到少数文件，继续主线程精读；只有在调查明显跨模块时才考虑改用 task(explore)`,

	codebase_search: `## codebase_search
自然语言搜索代码库

**使用**：不知道准确关键词、需要按自然语言理解功能时
**不使用**：已知关键词→search_files，已知路径→read_file

**要点**：
- 使用自然语言描述，如"用户认证逻辑"
- 这是基于文本匹配的兜底工具，不要把它当成真正的向量语义检索
- 不要默认优先于 glob / search_files
- 如果语义搜索没有推进，立即切到 glob / search_files / read_file，不要空转
- 如果还需要跨模块、多轮、独立的探索，再考虑改用 task(explore)`,

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
- ✅ 用户要求的核心目标已经完成，且没有引入新的阻塞性错误
- ✅ 用户要求的所有功能已实现
- ✅ 没有遗留的半成品代码或虚假的“已完成”状态

**result 内容格式**：
- 简洁概括做了哪些改动及其影响（高信噪比，用户会读）
- 引用关键代码用 \`[\`function()\`](path:line)\` 格式
- 使用 markdown，适当使用列表和代码块
- 必须显式提供 result，不要省略并指望系统替你总结
- **禁止**：重复计划列表、过长解释、以问题结尾、套话（"希望这对你有帮助"等）
- **禁止**：把“下一步策略 / 等待子任务 / 需要继续调查 / 我将改用某工具”这类中间态文本当成完成结果

**不使用**：任务未完成、有错误待解决、用户问题还没解答`,

	// P0优化：批量执行工具
	batch: `## batch
并行执行多个独立的只读工具调用，用于减少往返次数。

**优先用例**（以只读操作为主）：
- 读取多个文件（read_file × N）
- 多个搜索操作（search_files、glob、list_files、codebase_search）
- 搜索 + 读取组合
- LSP查询（统一用 lsp，operation=hover/diagnostics/definition/references/type_definition）

✅ **正确示例 - 批量读取文件**：
\`\`\`json
{
  "tool_calls": [
    {"tool": "read_file", "parameters": {"path": "a.ts"}},
    {"tool": "read_file", "parameters": {"path": "b.ts"}},
    {"tool": "search_files", "parameters": {"path": "src", "regex": "interface"}}
  ]
}
\`\`\`

⚠️ **不要**：把多个写操作塞进同一个 batch。

**规则**：
- 每次batch最多 **25** 个工具调用
- 所有调用并行执行，不保证顺序
- 部分失败不影响其他工具
- **禁止嵌套**batch调用

**禁止在batch中使用的工具**：
- batch（禁止嵌套）
- ask_followup_question（需要用户输入，并行无意义）
- attempt_completion（任务完成信号）

**何时不使用**：
- 只有1个操作
- 操作有依赖关系
- 任意写操作需要逐步验证`,

	// P1优化：多处编辑工具
	multiedit: `## multiedit
在单个文件中执行多处编辑操作（原子性）

**使用**：需要修改同一文件的多个位置
**不使用**：只修改一处→edit，创建新文件→write_to_file

**要点**：
- 所有编辑要么全部成功，要么全部不执行
- 编辑按顺序执行，每个基于前一个的结果
- 每个 old_string 都必须与文件内容精确匹配
- 任一 edit 找不到或多匹配，整个 multiedit 失败
- 同一文件有多个修改点时，优先一次 multiedit 完成，避免 edit → edit → edit

**参数**：path（文件路径）、edits（编辑数组）
每个edit包含：old_string、new_string、replace_all(可选)`,

	// P0优化：独立edit工具
	edit: `## edit
基于 old_string/new_string 的精确字符串替换

**使用**：修改单个文件中的一段明确文本
**不使用**：创建新文件→write_to_file，同文件多处修改→multiedit

**规则**：
- 先 read_file 完整读取文件
- old_string 必须精确匹配文件内容，包括缩进和空白
- 找不到时直接失败：\`oldString not found in content\`
- 匹配多处且 replace_all=false 时直接失败并要求补更多上下文
- 如果同一文件还要继续修改第 2 处/第 3 处，不要连续多次 edit，优先改成一次 multiedit
- 如果刚刚改过同一文件，不要继续拿旧 old_string 重试
- create_if_missing 仅在明确需要创建新文件时使用，不要默认拿它替代 write_to_file

**参数**：path、old_string、new_string、replace_all(可选)、create_if_missing(可选)`,

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


	// P1优化：统一LSP工具
	lsp: `## lsp
统一 LSP 查询入口（推荐）

**operation 可选值**：
- hover：类型/签名/文档
- diagnostics：错误和警告
- definition：定义位置
- references：引用位置
- type_definition：类型定义位置

**参数**：
- operation: 必填，操作类型
- path: 必填，文件路径
- line/column: 在 hover/definition/references/type_definition 时必填

**示例**：
\`\`\`
lsp(operation="hover", path="src/utils.ts", line=10, column=15)
lsp(operation="diagnostics", path="src/example.ts")
\`\`\`

**提示**：
- 兼容旧 lsp_* 调用，但默认应优先使用统一 lsp 工具`,

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
	skill: `## skill
按需加载专业领域知识和最佳实践（20个内置Skills）

**重要**：只有在你明确需要某个领域的检查清单、最佳实践或专业流程时才使用，不要把它当成每个任务的默认步骤。

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

**使用边界**：
- Skills已内置，无需用户配置
- 完整内容(500-2000 tokens)按需加载
- 简单读改类任务不要额外调用 skill
- 一个任务通常最多调用 1 次 skill 就够了

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
1. 探索未知代码：优先 glob / search_files，只有确实不知道关键词时再用 codebase_search
2. 修改文件：单处改动→edit；同文件多处改动→multiedit；特殊补丁场景→apply_diff
3. 搜索：知道关键词→search_files，不知道→codebase_search

${descriptions}`;
}
