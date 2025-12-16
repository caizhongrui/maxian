# 码弦IDE优化计划 - 对标Claude Code

> 基于Claude Code v2.0.70系统提示词分析，制定全面优化方案
> 参考资源：
> - [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)
> - [Claude Code Tools Reference](https://www.vtrivedy.com/posts/claudecode-tools-reference)
> - [Claude Code 2.0 System Prompt Changes](https://mikhail.io/2025/09/sonnet-4-5-system-prompt-changes/)

---

## 一、核心差距总览

| 维度 | 当前实现 | Claude Code | 差距程度 |
|------|----------|-------------|----------|
| 系统提示词 | ~800 tokens | ~5000+ tokens (动态组合) | 严重 |
| 工具描述 | 简单描述 | 详细场景+最佳实践+决策树 | 严重 |
| TodoWrite | 基础 | 2167 tokens详细指导 | 中等 |
| 子Agent系统 | 无 | Explore/Plan/Task三种 | 严重 |
| 上下文管理 | 无 | 滑动窗口+智能摘要 | 中等 |
| Git安全协议 | 无 | 完整协议 | 中等 |
| 工具并行 | 无 | 支持并行执行 | 中等 |

---

## 二、分阶段优化计划

### Phase 1: 提示词工程深度优化 (核心优先级)

#### 1.1 重写工具描述 (toolDescriptions.ts)

**目标**：从当前~20行/工具 提升到 ~100行/工具

**当前问题**：
```typescript
// 当前：过于简单
read_file: `## read_file
读取指定文件的内容
**参数**：- path (string, required): 文件路径`
```

**改进为Claude Code风格**：
```typescript
read_file: `## read_file
读取文件内容，支持行范围限制

**何时使用**：
- 需要查看完整文件内容时
- 已知确切文件路径时
- 修改文件前了解当前内容

**何时不使用**：
- 搜索关键词 → 用 search_files
- 查找文件 → 用 glob
- 只需要部分内容 → 使用 start_line/end_line 参数
- 理解代码结构 → 优先用 codebase_search

**参数**：
- path (string, required): 文件的绝对或相对路径
- start_line (number, optional): 起始行号（从1开始）
- end_line (number, optional): 结束行号

**最佳实践**：
1. 大文件（>500行）先用行范围限制
2. 二进制文件会返回警告，不要尝试读取
3. 文件不存在会返回错误，先用 glob 确认
4. 读取后立即用于修改，不要间隔太多步骤

**输出格式**：
- 返回带行号的文件内容
- 超过5000行自动截断
- 包含文件总行数信息

**常见错误**：
- 路径拼写错误 → 先用 list_files 确认
- 权限不足 → 检查文件权限
- 文件过大 → 使用行范围参数`
```

**需要重写的工具**（按优先级）：
1. `read_file` - 最常用
2. `write_to_file` - 危险操作需详细指导
3. `apply_diff` - 核心编辑能力
4. `search_files` / `codebase_search` - 搜索策略
5. `execute_command` - 安全关键
6. `ask_followup_question` - 交互质量
7. `attempt_completion` - 任务结束质量

#### 1.2 增加工具使用决策树

**新增文件**: `src/vs/workbench/contrib/maxian/common/prompts/sections/toolDecisionTree.ts`

```typescript
export function getToolDecisionTreeSection(): string {
  return `====

TOOL SELECTION DECISION TREE

当你需要获取信息时，按以下顺序决策：

## 探索未知代码
\`\`\`
需要理解代码功能？
├── 是：首先使用 codebase_search（语义搜索）
│   └── 找到相关文件后 → read_file
└── 知道关键词？
    ├── 是：search_files（正则搜索）
    └── 否：list_files 浏览目录结构
\`\`\`

## 修改文件
\`\`\`
需要修改文件？
├── 小改动（<20行）
│   └── apply_diff（SEARCH/REPLACE块）
├── 新文件或完全重写
│   └── write_to_file
└── 多处修改
    └── 多个 apply_diff 块在同一次调用中
\`\`\`

## 搜索文件
\`\`\`
需要找文件？
├── 知道文件名模式（*.ts, test_*.py）
│   └── glob
├── 知道文件内容关键词
│   └── search_files
└── 不确定在哪里
    └── codebase_search → 然后 read_file
\`\`\`

## 执行命令
\`\`\`
需要执行命令？
├── 安装依赖：npm install / pip install
├── 构建项目：npm run build / make
├── 运行测试：npm test / pytest
├── 启动服务：npm start（需要告知用户是长时间运行）
└── 危险命令：rm -rf / git push --force
    └── 必须先询问用户确认
\`\`\`

**关键原则**：
1. 探索优先于修改 - 先理解，再动手
2. 语义搜索优先于关键词搜索
3. 小改动用diff，大改动用write
4. 并行独立操作，串行依赖操作
`;
}
```

#### 1.3 增加探索优先策略

**新增文件**: `src/vs/workbench/contrib/maxian/common/prompts/sections/explorationStrategy.ts`

```typescript
export function getExplorationStrategySection(): string {
  return `====

EXPLORATION BEFORE MODIFICATION

**核心原则**：在修改任何代码之前，必须先充分理解现有实现。

## 探索步骤（必须遵循）

1. **语义探索**
   使用 codebase_search 查找相关功能
   示例："用户认证逻辑"、"数据库连接"、"API路由定义"

2. **结构探索**
   使用 list_files 了解项目结构
   重点关注：src/、lib/、components/、services/

3. **内容探索**
   使用 read_file 阅读关键文件
   先读取：入口文件、配置文件、类型定义

4. **模式识别**
   使用 search_files 查找类似实现
   示例：找到现有的API endpoint实现作为参考

## 探索清单

修改代码前，确认以下信息：
- [ ] 理解现有代码的功能和目的
- [ ] 找到相关的类型定义
- [ ] 识别依赖关系
- [ ] 找到类似功能的现有实现
- [ ] 确认修改不会破坏现有功能

## 禁止行为

- 不要在不了解文件内容的情况下修改它
- 不要假设文件结构，先用 list_files 确认
- 不要猜测函数签名，先 read_file 查看
- 不要忽略错误处理，先看现有的错误处理模式
`;
}
```

#### 1.4 重写TodoWrite工具描述

**参考Claude Code的2167 tokens TodoWrite描述**：

```typescript
update_todo_list: `## update_todo_list
管理和跟踪任务进度的结构化工具

**何时使用此工具**：
在以下场景主动使用：
1. 复杂多步骤任务 - 任务需要3个或更多独立步骤
2. 非简单任务 - 需要仔细规划或多个操作
3. 用户明确要求 - 用户直接要求使用待办列表
4. 用户提供多个任务 - 用户给出编号或逗号分隔的任务列表
5. 收到新指令后 - 立即将用户需求记录为待办
6. 开始处理任务时 - 在开始工作前标记为 in_progress
7. 完成任务后 - 立即标记为 completed

**何时不使用**：
- 只有一个简单任务
- 任务很简单，不需要跟踪
- 可以在3个简单步骤内完成
- 纯对话或信息查询

**任务状态管理**：
1. pending - 待处理
2. in_progress - 正在处理（同时只有一个）
3. completed - 已完成

**关键规则**：
- 完成任务后立即标记为completed，不要批量更新
- 同一时间只有一个任务为in_progress
- 遇到错误或阻塞时，保持in_progress状态
- 任务描述使用祈使句（如"运行测试"而非"运行测试中"）

**任务完成要求**：
只有在以下情况才标记为completed：
- 测试通过
- 实现完整
- 没有未解决的错误
- 找到了所有必要的文件

**示例**：
用户："运行构建并修复所有类型错误"
正确做法：
1. 创建待办：[运行构建] [修复类型错误]
2. 标记"运行构建"为in_progress
3. 运行构建，发现10个错误
4. 为每个错误创建子任务
5. 逐个修复，每修完一个标记completed
6. 全部完成后验证构建通过

**参数**：
- todos (array, required): 待办事项数组
  - content (string): 任务描述
  - status (enum): pending | in_progress | completed
  - id (string): 任务唯一标识`
```

#### 1.5 增加Git安全协议

**新增文件**: `src/vs/workbench/contrib/maxian/common/prompts/sections/gitSafetyProtocol.ts`

```typescript
export function getGitSafetyProtocolSection(): string {
  return `====

GIT SAFETY PROTOCOL

**核心安全规则**：
- 永远不要更新 git config
- 永远不要执行破坏性/不可逆的git命令，除非用户明确要求
- 永远不要跳过hooks（--no-verify, --no-gpg-sign等）
- 永远不要强制推送到 main/master，即使用户要求也要警告
- 避免使用 git commit --amend，除非用户明确要求或pre-commit hook修改了文件

**创建提交的步骤**：
只有用户明确要求时才创建提交。

1. 并行运行以下命令了解当前状态：
   - git status（查看未跟踪文件）
   - git diff（查看暂存和未暂存的更改）
   - git log --oneline -5（查看最近提交风格）

2. 分析所有更改并起草提交信息：
   - 总结更改性质（新功能、bug修复、重构等）
   - 不要提交可能包含密钥的文件（.env, credentials.json等）
   - 提交信息聚焦"为什么"而非"做了什么"
   - 保持简洁（1-2句话）

3. 执行提交：
   - git add 相关文件
   - git commit -m "提交信息"
   - git status 验证成功

4. pre-commit hook失败处理：
   - 只重试一次
   - 如果文件被hook修改，验证后可以amend
   - 检查HEAD提交确认是你的提交才能amend

**禁止的命令**：
- git push --force（除非用户明确要求且不是main/master）
- git reset --hard（不可逆）
- git clean -fd（删除未跟踪文件）
- git rebase -i（交互模式不支持）
- git add -i（交互模式不支持）

**创建PR的步骤**：
1. 了解分支状态：
   - git status
   - git diff
   - git log base-branch..HEAD
   - 检查是否需要推送到远程

2. 创建PR：
   使用 gh pr create 命令
   PR描述格式：
   ## Summary
   <1-3个要点>

   ## Test plan
   [测试清单]
`;
}
```

---

### Phase 2: Agent循环策略优化

#### 2.1 增加探索-规划-执行-验证循环

**修改文件**: `src/vs/workbench/contrib/maxian/common/task/TaskService.ts`

```typescript
/**
 * 任务执行策略 - 增加探索和验证阶段
 */
private async executeTaskWithStrategy(task: string): Promise<void> {
  // 阶段1: 探索
  await this.explorePhase(task);

  // 阶段2: 规划
  const plan = await this.planPhase(task);

  // 阶段3: 执行
  for (const step of plan.steps) {
    await this.executeStep(step);
  }

  // 阶段4: 验证
  await this.verifyPhase(plan);
}

/**
 * 探索阶段 - 理解任务上下文
 */
private async explorePhase(task: string): Promise<void> {
  // 1. 使用codebase_search理解相关代码
  // 2. 使用list_files了解项目结构
  // 3. 使用read_file阅读关键文件
}

/**
 * 验证阶段 - 确认更改正确
 */
private async verifyPhase(plan: TaskPlan): Promise<void> {
  // 1. 读取修改后的文件确认内容
  // 2. 运行相关测试
  // 3. 检查构建是否通过
}
```

#### 2.2 实现子Agent系统

**新增文件**: `src/vs/workbench/contrib/maxian/common/agents/`

```
agents/
├── AgentTypes.ts        # Agent类型定义
├── ExploreAgent.ts      # 探索Agent（快速代码库探索）
├── PlanAgent.ts         # 规划Agent（架构设计和实现规划）
├── TaskAgent.ts         # 任务Agent（复杂多步骤任务）
└── AgentOrchestrator.ts # Agent编排器
```

**ExploreAgent 系统提示词**（参考Claude Code 516 tokens）：

```typescript
const EXPLORE_AGENT_PROMPT = `
你是一个专门用于快速探索代码库的Agent。

**你的能力**：
- 使用 glob 查找文件
- 使用 grep 搜索内容
- 使用 read_file 阅读文件
- 使用 codebase_search 语义搜索

**你的限制**：
- 不能修改任何文件
- 不能执行命令
- 不能创建文件

**探索策略**：
1. 从用户的问题中提取关键信息
2. 使用语义搜索找到相关代码
3. 阅读关键文件理解实现
4. 返回结构化的探索结果

**返回格式**：
- 相关文件列表及其作用
- 关键代码片段
- 代码结构和依赖关系
- 回答用户的具体问题
`;
```

**PlanAgent 系统提示词**（参考Claude Code 633 tokens）：

```typescript
const PLAN_AGENT_PROMPT = `
你是一个软件架构师Agent，专门用于设计实现方案。

**你的任务**：
- 分析任务需求
- 设计实现方案
- 识别关键文件和修改点
- 考虑架构权衡

**输出格式**：
## 任务分析
[任务的目标和范围]

## 实现方案
[步骤化的实现计划]

## 关键文件
[需要修改或创建的文件]

## 风险和注意事项
[可能的问题和解决方案]

**规划原则**：
- 最小化修改范围
- 复用现有代码模式
- 考虑测试策略
- 不估计时间，只关注步骤
`;
```

---

### Phase 3: 上下文管理优化

#### 3.1 实现滑动窗口

**新增文件**: `src/vs/workbench/contrib/maxian/common/context/ContextManager.ts`

```typescript
/**
 * 上下文管理器 - 智能管理对话历史
 */
export class ContextManager {
  private readonly maxTokens: number = 100000; // 上下文限制
  private readonly reserveTokens: number = 20000; // 预留给响应的tokens

  /**
   * 压缩对话历史
   */
  compressHistory(messages: MessageParam[]): MessageParam[] {
    const currentTokens = this.estimateTokens(messages);

    if (currentTokens <= this.maxTokens - this.reserveTokens) {
      return messages;
    }

    // 策略1: 移除早期的工具结果详情
    // 策略2: 摘要早期对话
    // 策略3: 保留最近N轮完整对话

    return this.applyCompressionStrategies(messages);
  }

  /**
   * 生成对话摘要
   */
  async summarizeConversation(messages: MessageParam[]): Promise<string> {
    // 使用小模型生成摘要
    // 保留关键决策和上下文
  }
}
```

#### 3.2 实现智能上下文选择

```typescript
/**
 * 智能选择相关上下文
 */
selectRelevantContext(task: string, history: MessageParam[]): MessageParam[] {
  // 1. 分析当前任务关键词
  // 2. 匹配历史中的相关信息
  // 3. 保留最相关的上下文
  // 4. 丢弃不相关的工具调用详情
}
```

---

### Phase 4: 工具执行优化

#### 4.1 工具并行执行

**修改文件**: `src/vs/workbench/contrib/maxian/browser/tools/toolExecutorImpl.ts`

```typescript
/**
 * 并行执行多个独立工具
 */
async executeToolsInParallel(
  toolUses: ToolUse[]
): Promise<ToolResult[]> {
  // 分析工具依赖关系
  const { independent, dependent } = this.analyzeDependencies(toolUses);

  // 并行执行独立工具
  const independentResults = await Promise.all(
    independent.map(tool => this.executeTool(tool))
  );

  // 串行执行依赖工具
  const dependentResults = [];
  for (const tool of dependent) {
    dependentResults.push(await this.executeTool(tool));
  }

  return [...independentResults, ...dependentResults];
}
```

#### 4.2 工具执行缓存

```typescript
/**
 * 缓存工具执行结果（只读工具）
 */
private readonly toolCache = new Map<string, {
  result: any;
  timestamp: number;
}>();

async executeWithCache(toolUse: ToolUse): Promise<any> {
  // 只读工具可以缓存
  if (this.isReadOnlyTool(toolUse.name)) {
    const cacheKey = this.getCacheKey(toolUse);
    const cached = this.toolCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < 30000) {
      return cached.result;
    }
  }

  const result = await this.executeTool(toolUse);

  if (this.isReadOnlyTool(toolUse.name)) {
    this.toolCache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });
  }

  return result;
}
```

---

### Phase 5: 错误处理与恢复

#### 5.1 智能错误恢复

**修改文件**: `src/vs/workbench/contrib/maxian/common/task/TaskService.ts`

```typescript
/**
 * 错误恢复策略
 */
private async handleToolError(
  toolUse: ToolUse,
  error: Error
): Promise<{ shouldRetry: boolean; modifiedInput?: any }> {
  const errorType = this.classifyError(error);

  switch (errorType) {
    case 'FILE_NOT_FOUND':
      // 尝试用glob找到正确的文件
      const suggestions = await this.findSimilarFiles(toolUse.input.path);
      return {
        shouldRetry: suggestions.length > 0,
        modifiedInput: { ...toolUse.input, path: suggestions[0] }
      };

    case 'DIFF_NOT_MATCH':
      // 重新读取文件获取最新内容
      const currentContent = await this.readFile(toolUse.input.path);
      return {
        shouldRetry: true,
        suggestion: `文件内容已更改，请基于最新内容重新生成diff`
      };

    case 'PERMISSION_DENIED':
      return { shouldRetry: false, suggestion: '权限不足，请检查文件权限' };

    default:
      return { shouldRetry: false };
  }
}
```

#### 5.2 自我修正机制

```typescript
/**
 * 执行后自动验证
 */
private async verifyToolExecution(
  toolUse: ToolUse,
  result: any
): Promise<boolean> {
  switch (toolUse.name) {
    case 'write_to_file':
    case 'apply_diff':
      // 验证文件内容
      const actual = await this.readFile(toolUse.input.path);
      return this.verifyContent(actual, toolUse.input);

    case 'execute_command':
      // 检查命令退出码
      return result.exitCode === 0;

    default:
      return true;
  }
}
```

---

## 三、实施路线图

### 第一周: 提示词工程

| 天 | 任务 | 产出 |
|----|------|------|
| 1 | 重写 read_file, write_to_file 工具描述 | toolDescriptions.ts 更新 |
| 2 | 重写 apply_diff, search_files 工具描述 | toolDescriptions.ts 更新 |
| 3 | 重写其余工具描述 | toolDescriptions.ts 完成 |
| 4 | 添加工具决策树 section | toolDecisionTree.ts |
| 5 | 添加探索策略 section | explorationStrategy.ts |
| 6 | 添加Git安全协议 | gitSafetyProtocol.ts |
| 7 | 重写TodoWrite描述 + 集成测试 | 完整提示词系统 |

### 第二周: Agent循环优化

| 天 | 任务 | 产出 |
|----|------|------|
| 1-2 | 实现探索-规划-执行-验证循环 | TaskService.ts 更新 |
| 3-4 | 实现ExploreAgent | ExploreAgent.ts |
| 5-6 | 实现PlanAgent | PlanAgent.ts |
| 7 | Agent编排器 + 集成测试 | AgentOrchestrator.ts |

### 第三周: 上下文和工具优化

| 天 | 任务 | 产出 |
|----|------|------|
| 1-2 | 实现上下文滑动窗口 | ContextManager.ts |
| 3-4 | 实现工具并行执行 | toolExecutorImpl.ts 更新 |
| 5-6 | 实现错误恢复机制 | TaskService.ts 更新 |
| 7 | 端到端测试和调优 | 完整系统 |

---

## 四、关键指标

### 质量指标

| 指标 | 当前 | 目标 |
|------|------|------|
| 工具首次成功率 | ~60% | >85% |
| 任务完成率 | ~50% | >80% |
| 用户满意度 | - | >4.0/5.0 |
| 平均交互轮次 | ~8 | <5 |

### 技术指标

| 指标 | 当前 | 目标 |
|------|------|------|
| 系统提示词tokens | ~800 | ~3000 |
| 工具描述tokens | ~1500 | ~5000 |
| 首次响应时间 | 3-5s | <3s |
| 上下文利用率 | ~30% | >70% |

---

## 五、参考资源

### Claude Code 提示词仓库
- https://github.com/Piebald-AI/claude-code-system-prompts
- 包含所有系统提示词、工具描述、子Agent提示词
- 每个版本的CHANGELOG

### 关键Gists
- https://gist.github.com/yaodong/a520a3dbf3386689323eb1331ffc57c4
- https://gist.github.com/wong2/e0f34aac66caf890a332f7b6f9e2ba8f
- https://gist.github.com/transitive-bullshit/487c9cb52c75a9701d312334ed53b20c

### 分析文章
- https://mikhail.io/2025/09/sonnet-4-5-system-prompt-changes/
- https://www.vtrivedy.com/posts/claudecode-tools-reference
- https://pierce.dev/notes/under-the-hood-of-claude-code

---

## 六、总结

**核心改进方向**：

1. **提示词深度** - 从简单描述到详细的使用场景、决策树、最佳实践
2. **探索优先** - 在修改前强制进行代码库探索
3. **子Agent系统** - 专门的探索、规划、执行Agent
4. **上下文管理** - 智能压缩和选择相关上下文
5. **工具优化** - 并行执行、缓存、错误恢复

**预期效果**：
- 更准确的工具选择
- 更少的重复和错误
- 更好的任务理解
- 更高的完成率

即使使用相同的底层模型，通过这些优化也能显著提升AI编程助手的效果。
