/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * 工具选择决策树 Section
 * 帮助AI在不同场景下选择最合适的工具
 */
export function getToolDecisionTreeSection(): string {
	return `====

TOOL SELECTION DECISION TREE

在使用工具之前，请根据以下决策树选择最合适的工具：

## 获取信息

\`\`\`
需要获取代码/文件信息？
├── 探索未知代码区域
│   └── codebase_search（语义搜索，首选）
│       └── 找到相关文件后 → read_file 深入了解
│
├── 知道要搜索的关键词
│   └── search_files（正则搜索）
│       └── 搜索后 → read_file 查看上下文
│
├── 按文件名/类型查找
│   └── glob（文件名模式匹配）
│
├── 浏览目录结构
│   └── list_files
│
└── 已知文件路径
    └── read_file（直接读取）
\`\`\`

## 修改文件

\`\`\`
需要修改文件？
├── 创建新文件
│   └── write_to_file
│
├── 修改现有文件
│   ├── 局部修改（任意大小）
│   │   └── apply_diff（首选）
│   │
│   ├── 完全重写（变化>50%）
│   │   └── write_to_file
│   │
│
└── 修改前必须先做
    └── read_file（了解当前内容）
\`\`\`

## 执行操作

\`\`\`
需要执行操作？
├── 构建/测试/安装
│   └── execute_command
│       └── npm install / npm run build / npm test 等
│
├── Git 操作
│   └── execute_command
│       └── 遵循 Git 安全协议
│
└── 危险操作
    └── 先 ask_followup_question 询问用户
\`\`\`

## 交互决策

\`\`\`
需要与用户交互？
├── 缺少关键信息
│   └── ask_followup_question
│
├── 任务完成
│   └── attempt_completion
│
└── 复杂任务
    └── 先明确步骤列表再逐步执行
\`\`\`

## 关键原则

1. **探索优先于修改**
   - 修改代码前，必须先理解现有代码
   - 使用 codebase_search 或 read_file 先了解上下文

2. **apply_diff 优先于 write_to_file**
   - 除非创建新文件或完全重写
   - apply_diff 更精确、更安全

3. **codebase_search 优先于 search_files**
   - 当不确定关键词时
   - 探索未知代码区域时

4. **一次做好**
   - 多个相关修改用一次 apply_diff 完成
   - 减少工具调用次数`;
}
