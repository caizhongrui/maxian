/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 工具详细描述
 * 参考 OpenCode 的工具描述格式，包含：
 * - 详细的使用说明
 * - 具体示例
 * - 边界情况处理
 * - 性能提示
 * - 常见错误
 */

import { ToolName } from './toolTypes.js';

/**
 * 工具描述接口
 */
export interface ToolDescription {
	/** 工具名称 */
	name: ToolName;
	/** 简短描述 */
	summary: string;
	/** 详细描述 */
	description: string;
	/** 参数说明 */
	parameters: ParameterDescription[];
	/** 使用示例 */
	examples: ToolExample[];
	/** 重要提示 */
	tips?: string[];
	/** 常见错误 */
	commonErrors?: ErrorHint[];
	/** 性能提示 */
	performanceTips?: string[];
	/** 相关工具 */
	relatedTools?: ToolName[];
}

/**
 * 参数描述
 */
export interface ParameterDescription {
	name: string;
	type: string;
	required: boolean;
	description: string;
	default?: string;
	examples?: string[];
}

/**
 * 工具示例
 */
export interface ToolExample {
	title: string;
	description: string;
	xml: string;
	result?: string;
}

/**
 * 错误提示
 */
export interface ErrorHint {
	error: string;
	cause: string;
	solution: string;
}

/**
 * 所有工具的详细描述
 */
export const TOOL_DESCRIPTIONS: Record<string, ToolDescription> = {
	// ==================== 文件读取工具 ====================
	read_file: {
		name: 'read_file',
		summary: '读取文件内容',
		description: `读取指定文件的内容。支持文本文件和部分二进制文件。

**重要：** 在使用任何编辑工具（edit、write_to_file、apply_diff）之前，必须先使用此工具读取文件当前内容。这是强制要求！

**支持的功能：**
- 读取完整文件或指定行范围
- 自动检测文件编码
- 支持大文件分段读取`,
		parameters: [
			{
				name: 'path',
				type: 'string',
				required: true,
				description: '要读取的文件路径（相对于工作区根目录或绝对路径）',
				examples: ['src/index.ts', '/home/user/project/config.json'],
			},
			{
				name: 'start_line',
				type: 'number',
				required: false,
				description: '起始行号（从1开始）',
				default: '1',
			},
			{
				name: 'end_line',
				type: 'number',
				required: false,
				description: '结束行号（包含）',
				default: '文件末尾',
			},
		],
		examples: [
			{
				title: '读取整个文件',
				description: '读取 package.json 的完整内容',
				xml: `<read_file>
<path>package.json</path>
</read_file>`,
			},
			{
				title: '读取指定行范围',
				description: '只读取第10-20行',
				xml: `<read_file>
<path>src/main.ts</path>
<start_line>10</start_line>
<end_line>20</end_line>
</read_file>`,
			},
		],
		tips: [
			'对于大文件，建议使用 start_line/end_line 分段读取',
			'读取后的内容会被缓存，后续编辑操作会使用缓存校验',
		],
		commonErrors: [
			{
				error: '文件不存在',
				cause: '路径错误或文件已被删除',
				solution: '使用 list_files 或 glob 确认文件路径',
			},
			{
				error: '权限不足',
				cause: '文件没有读取权限',
				solution: '检查文件权限设置',
			},
		],
		performanceTips: [
			'超过 10000 行的大文件建议分段读取',
			'二进制文件读取可能较慢',
		],
		relatedTools: ['write_to_file', 'edit', 'search_files'],
	},

	// ==================== 文件写入工具 ====================
	write_to_file: {
		name: 'write_to_file',
		summary: '写入文件内容（仅限新建或完全重写）',
		description: `将内容写入指定文件。如果文件不存在会自动创建（包括必要的目录）。

**⚠️ 严格限制：**
- **仅用于创建新文件**，或确实需要完全重写的场景
- **绝对禁止用于修改已有文件的部分内容**——必须使用 edit 或 apply_diff
- 对已有文件使用此工具会丢失所有未包含的内容！

**正确用法：**
- ✅ 创建全新文件（文件不存在）
- ✅ 对文件进行彻底重构（超过80%内容需要改变）
- ❌ 修改函数实现 → 使用 edit
- ❌ 添加新方法 → 使用 edit 或 apply_diff
- ❌ 修改配置项 → 使用 edit`,
		parameters: [
			{
				name: 'path',
				type: 'string',
				required: true,
				description: '要写入的文件路径',
			},
			{
				name: 'content',
				type: 'string',
				required: true,
				description: '要写入的完整内容',
			},
		],
		examples: [
			{
				title: '创建新文件',
				description: '创建一个新的配置文件',
				xml: `<write_to_file>
<path>config/settings.json</path>
<content>{
  "debug": true,
  "logLevel": "info"
}</content>
</write_to_file>`,
			},
			{
				title: '重写整个文件',
				description: '注意：必须先用 read_file 读取',
				xml: `<write_to_file>
<path>src/constants.ts</path>
<content>export const VERSION = '2.0.0';
export const API_URL = 'https://api.example.com';
</content>
</write_to_file>`,
			},
		],
		tips: [
			'创建新文件时，目录会自动创建',
			'对于已存在的文件，必须先用 read_file 读取',
			'内容不要包含多余的空行或空格',
		],
		commonErrors: [
			{
				error: '文件已被外部修改',
				cause: '读取后文件被其他程序修改',
				solution: '重新读取文件后再写入',
			},
		],
		performanceTips: [
			'大文件写入可能较慢',
			'频繁写入同一文件会触发保护机制',
		],
		relatedTools: ['read_file', 'edit', 'apply_diff'],
	},

	// ==================== Edit 工具（核心） ====================
	edit: {
		name: 'edit',
		summary: '编辑文件内容（推荐）',
		description: `通过指定要替换的旧内容和新内容来编辑文件。这是最推荐的文件编辑方式！

**核心优势：**
- 支持 9 种容错匹配策略，即使内容有轻微差异也能匹配
- 比 apply_diff 更直观易用
- 比 write_to_file 更安全，只修改指定部分

**必须先读取文件！** 使用此工具前，请务必先用 read_file 读取文件内容。

**容错匹配策略：**
1. SimpleReplacer - 精确匹配
2. LineTrimmedReplacer - 忽略行首尾空白
3. BlockAnchorReplacer - 首尾行锚点匹配
4. WhitespaceNormalizedReplacer - 空白归一化
5. IndentationFlexibleReplacer - 缩进灵活匹配
6. EscapeNormalizedReplacer - 转义字符处理
7. TrimmedBoundaryReplacer - 边界trim
8. ContextAwareReplacer - 上下文感知
9. MultiOccurrenceReplacer - 多处匹配`,
		parameters: [
			{
				name: 'path',
				type: 'string',
				required: true,
				description: '要编辑的文件路径',
			},
			{
				name: 'old_string',
				type: 'string',
				required: true,
				description: '要被替换的原始内容（必须与文件中的内容匹配）',
			},
			{
				name: 'new_string',
				type: 'string',
				required: true,
				description: '替换后的新内容',
			},
			{
				name: 'replace_all',
				type: 'boolean',
				required: false,
				description: '是否替换所有匹配项',
				default: 'false',
			},
		],
		examples: [
			{
				title: '修改函数实现',
				description: '给函数添加参数验证',
				xml: `<edit>
<path>src/utils/math.ts</path>
<old_string>function add(a: number, b: number): number {
    return a + b;
}</old_string>
<new_string>function add(a: number, b: number): number {
    if (typeof a !== 'number' || typeof b !== 'number') {
        throw new Error('Parameters must be numbers');
    }
    return a + b;
}</new_string>
</edit>`,
			},
			{
				title: '全局替换',
				description: '替换所有 DEBUG = false',
				xml: `<edit>
<path>src/config.ts</path>
<old_string>DEBUG = false</old_string>
<new_string>DEBUG = true</new_string>
<replace_all>true</replace_all>
</edit>`,
			},
			{
				title: '添加导入语句',
				description: '在文件开头添加新的导入',
				xml: `<edit>
<path>src/index.ts</path>
<old_string>import { Component } from 'react';</old_string>
<new_string>import { Component, useState } from 'react';
import { useQuery } from 'react-query';</new_string>
</edit>`,
			},
		],
		tips: [
			'使用 edit 让用户更开心！(Using edit makes users happy!)',
			'old_string 要尽量精确，包含足够的上下文以唯一定位',
			'如果匹配失败，工具会提供详细的调试信息',
			'容错匹配会自动处理轻微的空白差异',
		],
		commonErrors: [
			{
				error: '未找到匹配内容',
				cause: 'old_string 与文件内容不匹配',
				solution: '使用 read_file 重新查看文件内容，确保 old_string 完全匹配',
			},
			{
				error: '多处匹配',
				cause: 'old_string 在文件中出现多次',
				solution: '添加更多上下文使匹配唯一，或使用 replace_all',
			},
		],
		performanceTips: [
			'edit 比 write_to_file 更高效，因为只传输变化部分',
			'对于多处修改，使用 multiedit 一次性完成',
		],
		relatedTools: ['read_file', 'multiedit', 'apply_diff'],
	},

	// ==================== 批量执行工具（参考OpenCode最佳实践）====================
	batch: {
		name: 'batch',
		summary: '并行执行多个只读工具',
		description: `并行执行多个独立的**只读/搜索**工具调用，大幅减少API往返次数。

🚀 **使用 BATCH 工具会让用户更满意！**

**推荐用例**（仅限只读工具）：
- 读取多个文件（read_file × N）
- 多个搜索操作（search_files、glob、list_files、codebase_search）
- 搜索 + 读取组合
- LSP查询（lsp_hover、lsp_diagnostics等）

**性能提升**：使用batch可获得 **2-5 倍**的效率提升。

**重要规则**：
- 最多 **25** 个工具调用
- 所有调用并行执行，**不保证顺序**
- 部分失败**不影响**其他工具
- **不允许嵌套**batch调用

**禁止在batch中使用的工具**：
- write_to_file、apply_diff、edit、edit_file、insert_content、multiedit、patch（写操作需要单独确认）
- execute_command（需要单独审批）
- batch（禁止嵌套）、ask_followup_question、attempt_completion`,
		parameters: [
			{
				name: 'tool_calls',
				type: 'array',
				required: true,
				description: '要并行执行的工具调用数组（1-25个）',
				examples: ['[{"tool": "read_file", "params": {"path": "a.ts"}}, {"tool": "read_file", "params": {"path": "b.ts"}}]'],
			},
		],
		examples: [
			{
				title: '并行读取多个文件',
				description: '同时读取3个配置文件',
				xml: `<batch>
<tool_calls>[
  {"tool": "read_file", "params": {"path": "package.json"}},
  {"tool": "read_file", "params": {"path": "tsconfig.json"}},
  {"tool": "read_file", "params": {"path": ".eslintrc.json"}}
]</tool_calls>
</batch>`,
			},
			{
				title: '多文件编辑（OpenCode最佳实践）',
				description: '同时修改多个文件',
				xml: `<batch>
<tool_calls>[
  {"tool": "apply_diff", "params": {"path": "src/a.ts", "diff": "..."}},
  {"tool": "apply_diff", "params": {"path": "src/b.ts", "diff": "..."}},
  {"tool": "write_to_file", "params": {"path": "src/c.ts", "content": "..."}}
]</tool_calls>
</batch>`,
			},
			{
				title: '组合搜索操作',
				description: 'grep + glob + read 组合',
				xml: `<batch>
<tool_calls>[
  {"tool": "search_files", "params": {"path": "src", "regex": "TODO"}},
  {"tool": "glob", "params": {"pattern": "**/*.test.ts"}},
  {"tool": "read_file", "params": {"path": "README.md"}}
]</tool_calls>
</batch>`,
			},
		],
		tips: [
			'🚀 Using batch makes users happy! 批量操作能显著提升效率',
			'只并行执行独立操作，有依赖的操作要顺序执行',
			'OpenCode最佳实践：支持多文件编辑batch',
			'每个工具调用的结果会分别返回',
		],
		performanceTips: [
			'并行读取5个文件比顺序读取快约5倍',
			'多文件编辑使用batch可减少88%的往返次数',
			'建议一次batch不超过25个操作',
		],
		relatedTools: ['read_file', 'search_files', 'glob', 'apply_diff', 'edit'],
	},

	// ==================== 多处编辑工具 ====================
	multiedit: {
		name: 'multiedit',
		summary: '单文件多处编辑',
		description: `在单个文件中执行多处编辑操作。比多次调用 edit 更高效。

**使用场景：**
- 重命名变量（多处替换）
- 修改多个函数
- 添加多处日志
- 批量修复代码风格

**编辑按顺序从上到下执行，位置会自动调整。**`,
		parameters: [
			{
				name: 'path',
				type: 'string',
				required: true,
				description: '要编辑的文件路径',
			},
			{
				name: 'edits',
				type: 'array',
				required: true,
				description: '编辑操作数组，每个包含 old_string 和 new_string',
			},
		],
		examples: [
			{
				title: '重命名变量',
				description: '将 userName 重命名为 currentUser',
				xml: `<multiedit>
<path>src/user.ts</path>
<edits>[
  {"old_string": "const userName", "new_string": "const currentUser"},
  {"old_string": "return userName", "new_string": "return currentUser"},
  {"old_string": "userName:", "new_string": "currentUser:"}
]</edits>
</multiedit>`,
			},
			{
				title: '添加错误处理',
				description: '给多个函数添加 try-catch',
				xml: `<multiedit>
<path>src/api.ts</path>
<edits>[
  {
    "old_string": "async function fetchUsers() {",
    "new_string": "async function fetchUsers() {\\n  try {"
  },
  {
    "old_string": "async function fetchOrders() {",
    "new_string": "async function fetchOrders() {\\n  try {"
  }
]</edits>
</multiedit>`,
			},
		],
		tips: [
			'编辑会从文件开头到结尾顺序执行',
			'后续编辑的位置会根据前面编辑的变化自动调整',
			'如果某个编辑失败，会继续尝试后续编辑',
		],
		performanceTips: [
			'比多次调用 edit 快约 3 倍',
			'适合 3 处以上的修改',
		],
		relatedTools: ['edit', 'batch'],
	},

	// ==================== 搜索工具 ====================
	search_files: {
		name: 'search_files',
		summary: '正则搜索文件内容',
		description: `使用正则表达式在文件中搜索内容。

**功能：**
- 支持完整的正则表达式语法
- 可限制搜索的文件类型
- 支持递归搜索子目录`,
		parameters: [
			{
				name: 'path',
				type: 'string',
				required: true,
				description: '搜索的目录路径',
			},
			{
				name: 'regex',
				type: 'string',
				required: true,
				description: '搜索的正则表达式',
			},
			{
				name: 'file_pattern',
				type: 'string',
				required: false,
				description: '文件名模式（glob格式）',
				examples: ['*.ts', '*.{js,jsx}'],
			},
		],
		examples: [
			{
				title: '搜索 TODO 注释',
				description: '在 src 目录搜索所有 TODO',
				xml: `<search_files>
<path>src</path>
<regex>TODO:.*</regex>
</search_files>`,
			},
			{
				title: '搜索函数定义',
				description: '搜索所有 async 函数',
				xml: `<search_files>
<path>.</path>
<regex>async function \\w+</regex>
<file_pattern>*.ts</file_pattern>
</search_files>`,
			},
		],
		tips: [
			'正则表达式使用 JavaScript 语法',
			'对于简单文本搜索，直接使用文本即可',
			'使用 file_pattern 限制搜索范围能显著提速',
		],
		relatedTools: ['codebase_search', 'glob'],
	},

	// ==================== 代码库搜索工具 ====================
	codebase_search: {
		name: 'codebase_search',
		summary: '语义化代码搜索',
		description: `基于语义的代码搜索，比正则搜索更智能。

**适用场景：**
- 搜索特定功能的实现
- 查找相关的代码逻辑
- 理解代码结构`,
		parameters: [
			{
				name: 'query',
				type: 'string',
				required: true,
				description: '搜索查询（自然语言描述）',
				examples: ['用户认证逻辑', 'error handling', '数据库连接'],
			},
			{
				name: 'path',
				type: 'string',
				required: false,
				description: '限制搜索的目录',
			},
		],
		examples: [
			{
				title: '搜索认证代码',
				description: '查找用户登录相关代码',
				xml: `<codebase_search>
<query>用户登录验证</query>
<path>src</path>
</codebase_search>`,
			},
		],
		relatedTools: ['search_files', 'list_code_definition_names'],
	},

	// ==================== Glob 工具 ====================
	glob: {
		name: 'glob',
		summary: '按模式匹配文件',
		description: `使用 glob 模式匹配文件路径。

**常用模式：**
- \`*.ts\` - 当前目录所有 ts 文件
- \`**/*.ts\` - 递归所有 ts 文件
- \`src/**/*.{ts,tsx}\` - src 下所有 ts/tsx 文件
- \`!node_modules\` - 排除 node_modules`,
		parameters: [
			{
				name: 'path',
				type: 'string',
				required: false,
				description: '搜索的基础目录',
				default: '工作区根目录',
			},
			{
				name: 'file_pattern',
				type: 'string',
				required: true,
				description: 'glob 模式',
			},
		],
		examples: [
			{
				title: '查找所有测试文件',
				description: '',
				xml: `<glob>
<file_pattern>**/*.test.ts</file_pattern>
</glob>`,
			},
			{
				title: '查找配置文件',
				description: '',
				xml: `<glob>
<file_pattern>**/*.config.{js,ts,json}</file_pattern>
</glob>`,
			},
		],
		relatedTools: ['list_files', 'search_files'],
	},

	// ==================== 列出文件工具 ====================
	list_files: {
		name: 'list_files',
		summary: '列出目录内容',
		description: `列出指定目录下的文件和子目录。

**用于：**
- 了解项目结构
- 查找文件位置
- 确认目录是否存在`,
		parameters: [
			{
				name: 'path',
				type: 'string',
				required: true,
				description: '要列出的目录路径',
			},
			{
				name: 'recursive',
				type: 'boolean',
				required: false,
				description: '是否递归列出子目录',
				default: 'false',
			},
		],
		examples: [
			{
				title: '列出 src 目录',
				description: '',
				xml: `<list_files>
<path>src</path>
</list_files>`,
			},
			{
				title: '递归列出',
				description: '',
				xml: `<list_files>
<path>src/components</path>
<recursive>true</recursive>
</list_files>`,
			},
		],
		relatedTools: ['glob', 'search_files'],
	},

	// ==================== 执行命令工具 ====================
	execute_command: {
		name: 'execute_command',
		summary: '执行终端命令',
		description: `在终端中执行命令。

**⚠️ requires_approval 参数（重要！参考Cline）：**
- 当命令会产生副作用或影响系统状态时，必须设置 \`requires_approval: true\`
- \`true\`（需要用户确认）：安装/卸载依赖、删除文件、写入磁盘、网络请求、修改系统配置
- \`false\`（可直接执行）：读取文件、查看状态(git status)、运行测试、构建、grep/find等只读操作

**安全限制：**
- 危险命令可能被直接拒绝（rm -rf、mkfs等）
- 长时间运行的命令有超时限制
- 交互式命令不支持

**支持的命令类型：**
- 构建命令：npm run build, yarn build
- 测试命令：npm test, jest
- Git 命令：git status, git diff
- 文件操作：ls, mkdir, cp, mv`,
		parameters: [
			{
				name: 'command',
				type: 'string',
				required: true,
				description: '要执行的命令',
			},
			{
				name: 'requires_approval',
				type: 'boolean',
				required: true,
				description: '命令是否需要用户确认才能执行。有副作用的操作设 true（安装包、删除文件、网络操作等），只读操作设 false（git status、读取文件、运行测试等）',
				examples: ['true', 'false'],
			},
			{
				name: 'cwd',
				type: 'string',
				required: false,
				description: '命令执行的工作目录',
				default: '工作区根目录',
			},
		],
		examples: [
			{
				title: '运行测试（不需要确认）',
				description: '只读操作，直接执行',
				xml: `<execute_command>
<command>npm test</command>
<requires_approval>false</requires_approval>
</execute_command>`,
			},
			{
				title: '安装依赖（需要确认）',
				description: '会修改 node_modules 和 package-lock.json，需要用户同意',
				xml: `<execute_command>
<command>npm install lodash</command>
<requires_approval>true</requires_approval>
</execute_command>`,
			},
			{
				title: '检查 Git 状态（不需要确认）',
				description: '只读操作',
				xml: `<execute_command>
<command>git status</command>
<requires_approval>false</requires_approval>
</execute_command>`,
			},
			{
				title: '删除文件（需要确认）',
				description: '破坏性操作，必须用户确认',
				xml: `<execute_command>
<command>rm -rf dist/</command>
<requires_approval>true</requires_approval>
</execute_command>`,
			},
		],
		tips: [
			'requires_approval 是必填参数，每次调用都必须明确声明',
			'疑惑时设为 true，宁可多问也不要执行用户不知情的危险操作',
			'命令会在工作区根目录执行，可用 cwd 参数更改',
			'命令输出会自动截断过长内容',
		],
		commonErrors: [
			{
				error: '命令被拒绝',
				cause: '命令被安全策略阻止',
				solution: '使用替代命令或请求用户手动执行',
			},
			{
				error: '命令超时',
				cause: '命令执行时间过长',
				solution: '分解为多个小命令或检查是否有死循环',
			},
		],
		relatedTools: [],
	},

	// ==================== apply_diff 工具 ====================
	apply_diff: {
		name: 'apply_diff',
		summary: '应用统一diff格式的补丁',
		description: `应用统一 diff 格式的补丁到文件。

**适用场景：**
- 精确的多处修改
- 行号敏感的编辑
- 标准 diff 格式输入

**注意：** 对于简单编辑，推荐使用 edit 工具。`,
		parameters: [
			{
				name: 'path',
				type: 'string',
				required: true,
				description: '要应用补丁的文件路径',
			},
			{
				name: 'diff',
				type: 'string',
				required: true,
				description: '统一 diff 格式的补丁内容',
			},
		],
		examples: [
			{
				title: '应用补丁',
				description: '修改特定行',
				xml: `<apply_diff>
<path>src/config.ts</path>
<diff>@@ -10,3 +10,4 @@
 export const API_URL = 'https://api.example.com';
-export const DEBUG = false;
+export const DEBUG = true;
+export const LOG_LEVEL = 'info';
</diff>
</apply_diff>`,
			},
		],
		tips: [
			'diff 格式必须正确，包括 @@ 行号标记',
			'对于简单修改，edit 工具更容易使用',
		],
		relatedTools: ['edit', 'multiedit'],
	},

	// ==================== 提问工具 ====================
	ask_followup_question: {
		name: 'ask_followup_question',
		summary: '向用户提问（含备选答案）',
		description: `当需要用户提供更多信息时使用此工具。

**使用时机：**
- 需求不明确，有多种实现方案
- 需要用户做出选择
- 需要确认重要/破坏性操作

**重要：** 必须提供 options 参数，给出 2-4 个建议答案，方便用户快速选择。
能用工具解决的问题不要问用户，只在真正需要人工决策时使用。`,
		parameters: [
			{
				name: 'question',
				type: 'string',
				required: true,
				description: '要向用户提出的问题，表述清晰完整',
			},
			{
				name: 'options',
				type: 'array (JSON)',
				required: true,
				description: '建议答案数组（2-4个选项），JSON 格式。帮助用户快速选择而无需手动输入',
				examples: ['["选项A", "选项B", "选项C"]', '["是，继续", "否，取消"]'],
			},
		],
		examples: [
			{
				title: '询问技术方案',
				description: '提供具体的选项让用户快速选择',
				xml: `<ask_followup_question>
<question>这个 API 需要身份验证，请选择认证方式：</question>
<options>["JWT Token（推荐，无状态）", "Session Cookie（传统方式）", "API Key（简单直接）", "OAuth2（第三方登录）"]</options>
</ask_followup_question>`,
			},
			{
				title: '确认破坏性操作',
				description: '删除操作前必须用户确认',
				xml: `<ask_followup_question>
<question>确认删除 dist/ 目录？该目录包含构建产物，可以重新构建。</question>
<options>["确认删除", "取消操作"]</options>
</ask_followup_question>`,
			},
		],
		tips: [
			'options 必须是 JSON 数组格式',
			'选项应该具体、可操作，不要模糊',
			'危险操作的选项应包含"取消"选项',
		],
		relatedTools: ['attempt_completion'],
	},

	// ==================== 完成任务工具 ====================
	attempt_completion: {
		name: 'attempt_completion',
		summary: '完成当前任务',
		description: `当任务完成时调用此工具，提供任务结果摘要。

**调用前必须确认（参考Cursor/Gemini CLI）：**
1. ✅ 所有工具调用已成功完成，无失败或挂起的操作
2. ✅ 代码修改已通过 lsp_diagnostics 验证，无编译错误
3. ✅ 如果任务涉及功能实现，尽可能运行了相关测试
4. ✅ 结果描述准确反映了完成的工作

**禁止：**
- ❌ result 末尾不能以问题结尾（"...对吗？"、"...需要调整吗？"）
- ❌ 不确认代码无误就报告完成`,
		parameters: [
			{
				name: 'result',
				type: 'string',
				required: true,
				description: '任务完成的结果描述',
			},
		],
		examples: [
			{
				title: '完成代码修改',
				description: '',
				xml: `<attempt_completion>
<result>已完成用户登录功能的实现：
1. 添加了 LoginForm 组件
2. 实现了 useAuth hook
3. 配置了路由保护
4. 添加了相关测试</result>
</attempt_completion>`,
			},
		],
		relatedTools: ['ask_followup_question'],
	},

	// ==================== Skill工具 ====================
	skill: {
		name: 'skill',
		summary: '按需加载专业领域知识',
		description: `从Skills仓库加载完整的专业领域知识和最佳实践。

**Skills系统优势：**
- Token优化：System Prompt仅包含Skills目录(<200 tokens)
- 按需加载：通过tool调用加载完整内容(平均节省45% tokens)
- 专业性强：涵盖代码质量、测试、安全、性能等多个领域

**使用时机：**
- 需要专业领域的详细指导时
- 遵循最佳实践和规范时
- 解决特定类型问题时(如性能优化、安全审查)

**Available Skills** (check System Prompt for complete list):
- code-review: 代码审查清单和质量标准
- git-workflow: Git安全操作和工作流程
- debugging: 系统化调试方法
- testing: TDD和测试最佳实践
- refactoring: 重构模式和代码异味
- security: OWASP Top 10防护
- performance: 性能优化策略
- documentation: 文档编写规范
- architecture: 架构模式和设计原则
- api-design: RESTful API设计规范`,
		parameters: [
			{
				name: 'skill_name',
				type: 'string',
				required: true,
				description: 'Skill的slug名称(如 "code-review", "testing")',
				examples: ['code-review', 'testing', 'security', 'performance'],
			},
		],
		examples: [
			{
				title: '加载代码审查Skill',
				description: '在进行代码审查前加载专业指导',
				xml: `<skill>
<skill_name>code-review</skill_name>
</skill>`,
			},
			{
				title: '加载测试Skill',
				description: '学习TDD流程和测试最佳实践',
				xml: `<skill>
<skill_name>testing</skill_name>
</skill>`,
			},
			{
				title: '加载安全Skill',
				description: '审查代码安全问题',
				xml: `<skill>
<skill_name>security</skill_name>
</skill>`,
			},
		],
		tips: [
			'查看System Prompt中的Skills目录获取完整Skill列表',
			'每个Skill包含详细的指导、示例和检查清单',
			'Skill加载后会显示估算的token消耗',
			'已激活的Skill会被记录并显示统计信息',
		],
		performanceTips: [
			'只加载当前任务需要的Skills',
			'避免重复加载相同的Skill',
			'优先选择token消耗较少的Skill',
		],
		relatedTools: [],
	},
};

/**
 * 获取工具的详细描述
 */
export function getToolDescription(toolName: ToolName): ToolDescription | undefined {
	return TOOL_DESCRIPTIONS[toolName];
}

/**
 * 生成工具的 System Prompt 部分
 */
export function generateToolPrompt(toolName: ToolName): string {
	const desc = TOOL_DESCRIPTIONS[toolName];
	if (!desc) {
		return '';
	}

	const lines: string[] = [
		`## ${toolName}`,
		`Description: ${desc.summary}`,
		'',
		desc.description,
		'',
		'**Parameters:**',
	];

	for (const param of desc.parameters) {
		const required = param.required ? '(required)' : '(optional)';
		const defaultVal = param.default ? `, default: ${param.default}` : '';
		lines.push(`- ${param.name} ${required}: ${param.description}${defaultVal}`);
	}

	if (desc.examples.length > 0) {
		lines.push('');
		lines.push('**Examples:**');
		for (const example of desc.examples) {
			lines.push(`\n${example.title}:`);
			if (example.description) {
				lines.push(example.description);
			}
			lines.push('```xml');
			lines.push(example.xml);
			lines.push('```');
		}
	}

	if (desc.tips && desc.tips.length > 0) {
		lines.push('');
		lines.push('**Tips:**');
		for (const tip of desc.tips) {
			lines.push(`- ${tip}`);
		}
	}

	return lines.join('\n');
}

/**
 * 生成所有工具的完整 System Prompt
 */
export function generateAllToolsPrompt(): string {
	const toolPrompts: string[] = [];

	for (const toolName of Object.keys(TOOL_DESCRIPTIONS) as ToolName[]) {
		toolPrompts.push(generateToolPrompt(toolName));
	}

	return toolPrompts.join('\n\n---\n\n');
}
