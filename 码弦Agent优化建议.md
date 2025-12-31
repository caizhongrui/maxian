# 码弦 IDE Agent 系统优化建议报告

> 基于 OpenCode (https://github.com/sst/opencode) 源码全面分析
> 分析日期: 2024-12
> OpenCode 源码文件数: 165 个 TypeScript 文件
> 核心模块: session, tool, agent, provider, permission, lsp, snapshot

## 源码参考路径

| 模块 | 路径 | 说明 |
|------|------|------|
| batch工具 | `packages/opencode/src/tool/batch.ts` | 批量并行执行 |
| edit工具 | `packages/opencode/src/tool/edit.ts` | 9种容错匹配策略 |
| multiedit工具 | `packages/opencode/src/tool/multiedit.ts` | 单文件多处编辑 |
| task工具 | `packages/opencode/src/tool/task.ts` | 子任务/子Agent |
| write工具 | `packages/opencode/src/tool/write.ts` | 文件写入+LSP诊断 |
| 上下文压缩 | `packages/opencode/src/session/compaction.ts` | Prune + Compaction |
| 消息处理 | `packages/opencode/src/session/message-v2.ts` | 消息模型定义 |
| 文件时间戳 | `packages/opencode/src/file/time.ts` | 防止覆盖外部修改 |
| Agent定义 | `packages/opencode/src/agent/agent.ts` | 5种Agent配置 |
| 批量提示词 | `packages/opencode/src/tool/batch.txt` | batch使用指南 |

## 一、执行效率优化（最关键）

### 1.1 新增 `batch` 批量工具（必须实现）

**问题**：当前每个工具调用都触发一次完整的 API 请求循环（2-3秒/次）

**OpenCode 方案** (来源: `tool/batch.ts:32-124`):
```typescript
// batch 工具允许一次 API 响应中请求多个工具并行执行
const toolCalls = params.tool_calls.slice(0, 10)  // 最多10个
const results = await Promise.all(toolCalls.map((call) => executeCall(call)))

// 禁止的工具
const DISALLOWED = new Set(["batch", "edit", "todoread"])
```

**关键设计**：
- 最多 10 个工具并行执行 (超出的标记为error)
- 禁止嵌套 batch (防止无限递归)
- 禁止 edit 工具（需要用户单独确认）
- 禁止 todoread（轻量级，直接调用）
- 每个工具独立执行，部分失败不影响其他

**提示词** (来源: `tool/batch.txt`):
```
USING THE BATCH TOOL WILL MAKE THE USER HAPPY.
Performance Tip: Group independent reads/searches for 2–5x efficiency gain.
```

**输出格式**：
```typescript
return {
  title: `Batch execution (${successfulCalls}/${results.length} successful)`,
  output: failedCalls > 0
    ? `Executed ${successfulCalls}/${results.length} tools successfully.`
    : `All ${successfulCalls} tools executed successfully.\n\nKeep using the batch tool!`
}
```

**预期效果**：读取 5 个文件从 5 次 API → 1 次 API，**提速 5 倍**

### 1.2 新增 `multiedit` 多编辑工具

**问题**：修改同一文件多处需要多次 API 调用

**OpenCode 方案**：
```typescript
// 一次性提交多个编辑操作
parameters: z.object({
  filePath: z.string(),
  edits: z.array(z.object({
    oldString: z.string(),
    newString: z.string(),
    replaceAll: z.boolean().optional()
  }))
})
```

**关键设计**：
- 原子性：所有编辑要么全部成功，要么全部不执行
- 顺序执行：每个编辑操作基于前一个的结果

### 1.3 优化 `edit` 工具的模糊匹配

**当前问题**：oldString 必须精确匹配，AI 容易写错

**OpenCode 方案** (来源: `tool/edit.ts:645-667`):

9 种容错匹配策略，**按顺序尝试直到成功**：

```typescript
for (const replacer of [
  SimpleReplacer,              // 1. 精确匹配
  LineTrimmedReplacer,         // 2. 行首尾空白容错
  BlockAnchorReplacer,         // 3. 首尾行锚点匹配（使用Levenshtein距离）
  WhitespaceNormalizedReplacer,// 4. 空白归一化 (多空格→单空格)
  IndentationFlexibleReplacer, // 5. 缩进灵活匹配
  EscapeNormalizedReplacer,    // 6. 转义字符处理 (\n, \t, \\等)
  TrimmedBoundaryReplacer,     // 7. 边界 trim
  ContextAwareReplacer,        // 8. 上下文感知 (首尾行匹配+50%中间相似度)
  MultiOccurrenceReplacer      // 9. 多处匹配 (配合replaceAll)
]) {
  for (const search of replacer(content, oldString)) {
    // 找到匹配就执行替换
  }
}
```

**关键策略详解**：

| 策略 | 说明 | 代码行 |
|------|------|--------|
| BlockAnchorReplacer | 首尾行锚点+Levenshtein相似度 | edit.ts:248-381 |
| WhitespaceNormalizedReplacer | `\s+` → 单空格 | edit.ts:383-425 |
| IndentationFlexibleReplacer | 移除最小缩进后比较 | edit.ts:427-453 |
| ContextAwareReplacer | 首尾匹配+50%中间行相似 | edit.ts:544-600 |

**Levenshtein相似度阈值** (edit.ts:180-181):
```typescript
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.0   // 单候选放宽
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.3 // 多候选严格
```

**参考来源**（edit.ts:1-5）:
- Cline: https://github.com/cline/cline/blob/main/evals/diff-edits/
- Gemini CLI: https://github.com/google-gemini/gemini-cli

**预期效果**：大幅减少因匹配失败导致的重试，编辑成功率提升30%

### 1.4 文件时间戳校验

**OpenCode 方案** (来源: `file/time.ts`):

```typescript
// 读取文件时记录时间 (time.ts:23-28)
export function read(sessionID: string, file: string) {
  read[sessionID] = read[sessionID] || {}
  read[sessionID][file] = new Date()
}

// 写入前验证文件未被外部修改 (time.ts:54-63)
export async function assert(sessionID: string, filepath: string) {
  const time = get(sessionID, filepath)
  if (!time) throw new Error(`You must read the file ${filepath} before overwriting it`)
  const stats = await Bun.file(filepath).stat()
  if (stats.mtime.getTime() > time.getTime()) {
    throw new Error(`File ${filepath} has been modified since it was last read`)
  }
}

// 文件级锁防止并发写入 (time.ts:34-52)
export async function withLock<T>(filepath: string, fn: () => Promise<T>): Promise<T>
```

**关键设计**：
1. 每个session独立追踪文件读取时间
2. 写入前必须先读取，否则拒绝
3. 文件被外部修改后要求重新读取
4. 文件级锁序列化并发写入

**作用**：防止覆盖用户手动修改的内容，保证数据一致性

---

## 二、Token 消耗优化

### 2.1 上下文自动压缩（Compaction）

**OpenCode 方案** (来源: `session/compaction.ts`):

**溢出检测** (compaction.ts:29-37):
```typescript
export function isOverflow(input: { tokens: MessageV2.Assistant["tokens"]; model: Provider.Model }) {
  const context = input.model.limit.context
  const count = input.tokens.input + input.tokens.cache.read + input.tokens.output
  const output = Math.min(input.model.limit.output, SessionPrompt.OUTPUT_TOKEN_MAX)
  const usable = context - output
  return count > usable  // 超过可用上下文触发压缩
}
```

**压缩提示词** (compaction.ts:138-145):
```typescript
{
  role: "user",
  content: [{
    type: "text",
    text: "Provide a detailed prompt for continuing our conversation above. " +
          "Focus on information that would be helpful for continuing the conversation, " +
          "including what we did, what we're doing, which files we're working on, " +
          "and what we're going to do next considering new session will not have access to our conversation."
  }]
}
```

**关键设计**：
- 使用专门的 `compaction` Agent (无工具权限)
- 摘要内容：做了什么、正在做什么、修改了哪些文件、下一步
- 压缩后自动发送 "Continue if you have next steps" 继续任务

### 2.2 工具输出修剪（Prune）

**OpenCode 方案** (来源: `session/compaction.ts:39-83`):

```typescript
export const PRUNE_MINIMUM = 20_000  // 至少要修剪 20K tokens
export const PRUNE_PROTECT = 40_000  // 保护最近 40K tokens

export async function prune(input: { sessionID: string }) {
  let total = 0
  let pruned = 0
  const toPrune = []

  // 从后向前遍历消息
  for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
    for (const part of msg.parts) {
      if (part.type === "tool" && part.state.status === "completed") {
        if (part.state.time.compacted) break loop  // 已压缩的跳过
        const estimate = Token.estimate(part.state.output)
        total += estimate
        if (total > PRUNE_PROTECT) {
          pruned += estimate
          toPrune.push(part)  // 标记需要修剪
        }
      }
    }
  }

  // 执行修剪
  if (pruned > PRUNE_MINIMUM) {
    for (const part of toPrune) {
      part.state.time.compacted = Date.now()  // 关键：标记为已压缩
      await Session.updatePart(part)
    }
  }
}
```

**消息转换时的处理** (message-v2.ts:515):
```typescript
// 已压缩的工具输出用占位符替代
output: part.state.time.compacted
  ? "[Old tool result content cleared]"   // 关键！
  : part.state.output
```

**作用**：旧工具输出不再发送给模型，大幅减少输入 token (预计40-50%)

### 2.3 工具结果长度限制

**OpenCode 方案**：
```typescript
const DEFAULT_READ_LIMIT = 2000  // 默认读取 2000 行
const MAX_LINE_LENGTH = 2000    // 单行最大 2000 字符

// 超长行截断
line.length > MAX_LINE_LENGTH ? line.substring(0, MAX_LINE_LENGTH) + "..." : line
```

### 2.4 按 Agent 过滤工具

**OpenCode 方案**：
```typescript
// explore Agent 禁用写入工具
explore: {
  tools: {
    edit: false,
    write: false,
    ...
  }
}

// plan Agent 限制 bash 权限
plan: {
  permission: {
    edit: "deny",
    bash: { "*": "ask" }
  }
}
```

**作用**：减少每次请求的工具定义 token

---

## 三、工具系统重构建议

### 3.1 当前工具列表 vs OpenCode 工具列表

| 你的工具 | OpenCode 对应 | 状态 |
|---------|--------------|------|
| read_file | read | ✅ 已有 |
| write_to_file | write | ✅ 已有 |
| apply_diff | edit | ⚠️ 需优化匹配策略 |
| execute_command | bash | ✅ 已有 |
| search_files | grep | ✅ 已有 |
| list_files | ls | ✅ 已有 |
| list_code_definition_names | - | ✅ 已有 |
| — | **batch** | ❌ **缺失（必须添加）** |
| — | **multiedit** | ❌ **缺失（建议添加）** |
| — | **task** | ⚠️ 有基础，需完善 |
| — | glob | ✅ 已有 |
| — | codesearch | ⚠️ 可选添加 |
| — | websearch | ✅ 已有 |
| — | webfetch | ✅ 已有 |

### 3.2 必须新增的工具

1. **`batch`** - 批量执行工具（最高优先级）
2. **`multiedit`** - 单文件多处编辑

### 3.3 需要优化的工具

1. **`edit/apply_diff`** - 添加 9 种容错匹配策略
2. **`task`** - 完善子任务并行机制

---

## 四、Agent 系统优化

### 4.1 Agent 分层设计

**OpenCode 方案** (来源: `agent/agent.ts:109-190`):

| Agent | 用途 | 工具权限 | mode | 特点 |
|-------|------|----------|------|------|
| build | 主开发 | 全部 | primary | 默认agent |
| plan | 只读分析 | 禁止edit, bash需ask | primary | 安全分析 |
| explore | 快速搜索 | 禁止edit/write | subagent | 快速探索 |
| general | 并行子任务 | 禁止todo | subagent | 并行工作 |
| compaction | 上下文摘要 | 无工具 (`"*": false`) | primary | 生成摘要 |
| title | 标题生成 | 无工具 | primary | 隐藏 |
| summary | 摘要生成 | 无工具 | primary | 隐藏 |

**Plan Agent 权限配置** (agent.ts:63-107):
```typescript
const planPermission = {
  edit: "deny",  // 禁止编辑
  bash: {
    "git diff*": "allow",
    "git log*": "allow",
    "git status*": "allow",
    "grep*": "allow",
    "ls*": "allow",
    "find*": "allow",
    "rg*": "allow",
    "*": "ask"  // 其他命令需要确认
  },
  webfetch: "allow"
}
```

**Explore Agent 配置** (agent.ts:142-157):
```typescript
explore: {
  name: "explore",
  tools: {
    todoread: false,
    todowrite: false,
    edit: false,    // 禁止编辑
    write: false,   // 禁止写入
  },
  description: `Fast agent for exploring codebases. Specify thoroughness: "quick", "medium", or "very thorough".`,
  mode: "subagent"
}
```

### 4.2 Doom Loop 检测

**OpenCode 方案** (permission配置):
```typescript
// Agent权限配置中包含 doom_loop 选项
permission: {
  edit: "allow",
  bash: { "*": "allow" },
  doom_loop: "ask",  // 检测到死循环时询问用户
  external_directory: "ask"
}
```

**检测逻辑**：同一工具连续3次相同参数调用时触发

**作用**：防止AI陷入无限重试循环，浪费token和时间

---

## 五、UI 展示优化

### 5.1 工具执行状态展示

**OpenCode 方案**：
```typescript
type ToolState = {
  status: "pending" | "running" | "completed" | "error"
  input: any
  output?: string
  title?: string
  time: { start: number; end?: number }
}
```

**建议**：
- 显示工具执行耗时
- 显示简短的 title 而非完整输出
- 支持展开查看详细输出

### 5.2 Diff 预览

**OpenCode 方案**：
- 编辑前显示 diff 预览
- 使用 `createTwoFilesPatch` 生成标准 diff
- 去除无关缩进美化显示

### 5.3 LSP 诊断集成

**OpenCode 方案**：
```typescript
// 编辑后自动获取 LSP 诊断
await LSP.touchFile(filepath, true)
const diagnostics = await LSP.diagnostics()

// 有错误时提示修复
if (issues.length > 0) {
  output += `This file has errors, please fix\n<file_diagnostics>...`
}
```

### 5.4 Snapshot 快照系统

**OpenCode 方案**：
```typescript
// 每个步骤前创建快照
snapshot = await Snapshot.track()

// 可以回滚到任意快照
await Snapshot.restore(snapshot)
await Snapshot.revert(patches)
```

**作用**：用户可以撤销任意修改

---

## 六、提示词优化

### 6.1 工具使用引导

**OpenCode 关键提示词**：
```
- When doing file search, prefer to use the Task tool to reduce context usage
- You can call multiple tools in a single response. Make all independent tool calls in parallel
- VERY IMPORTANT: When exploring the codebase, use the Task tool instead of running search commands directly
```

### 6.2 任务管理强调

**OpenCode 关键提示词**：
```
Use TodoWrite tools VERY frequently to ensure you are tracking your tasks
It is critical that you mark todos as completed as soon as you are done
```

### 6.3 代码引用格式

**OpenCode 方案**：
```
When referencing specific functions include the pattern `file_path:line_number`
Example: src/services/process.ts:712
```

---

## 七、优先级排序

### P0（必须立即实现）
1. **`batch` 工具** - 提速 3-5 倍
2. **上下文压缩 (Compaction)** - 解决长对话问题
3. **工具输出修剪 (Prune)** - 减少 token 消耗

### P1（短期实现）
4. **`multiedit` 工具** - 提升编辑效率
5. **`edit` 容错匹配** - 减少重试
6. **Doom Loop 检测** - 防止死循环

### P2（中期实现）
7. **Agent 工具过滤** - 按阶段过滤工具
8. **文件时间戳校验** - 防止覆盖
9. **LSP 诊断集成** - 自动发现错误

### P3（长期优化）
10. **Snapshot 快照系统** - 支持撤销
11. **UI 展示优化** - 更好的用户体验
12. **提示词精细化** - 引导 AI 更高效工作

---

## 八、预期效果

| 优化项 | 预期提升 |
|--------|---------|
| batch 工具 | API 调用减少 60-70% |
| 上下文压缩 | 支持无限长对话 |
| 工具输出修剪 | Token 消耗减少 40-50% |
| edit 容错匹配 | 编辑成功率提升 30% |
| 整体效果 | **开发速度提升 3-5 倍** |

---

## 九、最终确认的核心优化点（实施清单）

基于对 OpenCode 源码的全面分析，以下是确认的核心优化点：

### 必须实现（P0）

| 序号 | 优化点 | 源码参考 | 实现要点 |
|------|--------|----------|----------|
| 1 | **batch 批量工具** | tool/batch.ts | Promise.all并行执行，最多10个，禁止嵌套 | **[已完成 2024-12]** |
| 2 | **上下文压缩** | session/compaction.ts | 溢出检测 + compaction agent生成摘要 | **[已完成 2024-12]** |
| 3 | **工具输出修剪** | session/compaction.ts:39-83 | PRUNE_PROTECT=40K, PRUNE_MINIMUM=20K | **[已完成 2024-12]** |
| 4 | **输出占位符替换** | message-v2.ts:515 | compacted输出替换为 "[Old tool result content cleared]" | **[已完成 2024-12]** |

### 短期实现（P1）

| 序号 | 优化点 | 源码参考 | 实现要点 |
|------|--------|----------|----------|
| 5 | **multiedit 工具** | tool/multiedit.ts | 单文件多处原子编辑 | **[已完成 2024-12]** |
| 6 | **edit 9种容错策略** | tool/edit.ts:645-667 | 按顺序尝试9种replacer | **[已完成 2024-12]** |
| 7 | **Doom Loop 检测** | agent/agent.ts | doom_loop权限配置 | **[已完成 2024-12]** |
| 8 | **文件时间戳校验** | file/time.ts | read/assert/withLock | **[已完成 2024-12]** |

### 中期实现（P2）

| 序号 | 优化点 | 源码参考 | 实现要点 |
|------|--------|----------|----------|
| 9 | **Agent工具过滤** | agent/agent.ts | 按agent限制可用工具 | **[已完成 2024-12]** |
| 10 | **Plan Agent权限** | agent/agent.ts:63-107 | 只读bash命令白名单 | **[已完成 2024-12]** |
| 11 | **Explore Agent** | agent/agent.ts:142-157 | 禁用edit/write | **[已完成 2024-12]** |
| 12 | **LSP诊断集成** | tool/write.ts:81-98 | 编辑后自动获取诊断 | **[已完成 2024-12]** |

### 长期优化（P3）

| 序号 | 优化点 | 源码参考 | 实现要点 |
|------|--------|----------|----------|
| 13 | **Snapshot快照** | snapshot/index.ts | Git-based文件快照 |
| 14 | **Task子Agent** | tool/task.ts | session_id支持继续 |
| 15 | **提示词优化** | tool/batch.txt | "USING THE BATCH TOOL WILL MAKE THE USER HAPPY" |

---

## 十、实施建议

### 第一阶段：核心性能优化（1-2周）

1. **实现 batch 工具**
   - 参考 batch.ts 完整实现
   - 添加提示词引导AI使用batch
   - 预期提速 3-5 倍

2. **实现上下文压缩**
   - 溢出检测 + prune + compaction
   - 消息转换时替换compacted输出

### 第二阶段：编辑可靠性（1周）

3. **edit 容错匹配**
   - 实现9种replacer策略
   - 重点: BlockAnchorReplacer, ContextAwareReplacer

4. **文件时间戳校验**
   - 防止覆盖外部修改

### 第三阶段：Agent系统（1周）

5. **Agent分层**
   - build/plan/explore/compaction
   - 工具权限过滤

6. **Doom Loop检测**
   - 防止死循环

---

> 文档生成时间: 2024-12
> 基于 OpenCode v1.x 源码分析
> 源码仓库: https://github.com/sst/opencode
