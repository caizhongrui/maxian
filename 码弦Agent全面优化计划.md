# 码弦 Agent 全面优化计划

> 基于 Cline、Aider、Cursor、Windsurf、Continue 等工具的深度分析
> 目标：达到业界领先水平的 AI 编程助手效率

---

## 一、优化概览

### 预期效果
- 任务完成效率提升 **3-5倍**
- API 调用次数减少 **50%+**
- 用户体验显著改善

### 优化分类

| 阶段 | 优化项数量 | 预计周期 | 累计效率提升 |
|------|-----------|----------|-------------|
| Phase 1 | 6项 | 2周 | 100%+ |
| Phase 2 | 6项 | 3周 | 150%+ |
| Phase 3 | 6项 | 3周 | 200%+ |
| Phase 4 | 5项 | 2周 | 250%+ |

---

## 二、Phase 1：基础效率优化（最高优先级）

### 1.1 原生并行工具调用
**优先级**: P0 | **预期提升**: 30%+ | **难度**: 低

**问题**: 当前依赖 batch 工具模拟并行，模型经常不遵守

**方案**:
```typescript
// 1. 确保 API 请求启用 parallel_tool_calls
const requestBody = {
  model: this.config.model,
  messages: messages,
  tools: tools,
  parallel_tool_calls: true,  // 关键参数
  stream: true
};

// 2. 检查后端代理是否正确转发
// 3. 验证千问API是否支持此参数
```

**参考**: Cline `/src/core/api/transform/tool-call-processor.ts`

**验收标准**:
- [ ] 一次 API 响应可返回多个 tool_calls
- [ ] 读取 3 个文件只需 1 次 API 调用

---

### 1.2 environment_details 上下文注入
**优先级**: P0 | **预期提升**: 25%+ | **难度**: 中

**问题**: 模型每次都需要调用工具了解环境，浪费调用次数

**方案**:
```typescript
// 新增文件: src/vs/workbench/contrib/maxian/common/context/environmentDetails.ts

interface EnvironmentDetails {
  visibleFiles: string[];      // 当前可见文件
  openTabs: string[];          // 打开的标签
  activeTerminals: TerminalInfo[];  // 活跃终端及输出
  recentlyModifiedFiles: string[];  // 最近修改的文件
  currentTime: string;         // 当前时间
  workspaceStructure: string;  // 项目结构（前200个文件）
  detectedTools: string[];     // 检测到的CLI工具
  contextUsage: string;        // 上下文使用情况
  currentMode: string;         // 当前模式
}

async function getEnvironmentDetails(): Promise<string> {
  const details: string[] = [];

  // 1. 可见文件
  const visibleFiles = await this.getVisibleFiles();
  details.push(`# Visible Files\n${visibleFiles.join('\n')}`);

  // 2. 打开的Tab
  const openTabs = await this.getOpenTabs();
  details.push(`# Open Tabs\n${openTabs.join('\n')}`);

  // 3. 活跃终端
  const terminals = await this.getActiveTerminals();
  if (terminals.length > 0) {
    details.push(`# Active Terminals\n${formatTerminals(terminals)}`);
  }

  // 4. 最近修改的文件
  const recentFiles = this.fileContextTracker.getRecentlyModifiedFiles();
  if (recentFiles.length > 0) {
    details.push(`# Recently Modified Files\n${recentFiles.join('\n')}`);
  }

  // 5. 当前时间
  details.push(`# Current Time\n${new Date().toLocaleString()}`);

  // 6. 项目结构（首次请求）
  if (this.isFirstRequest) {
    const structure = await this.getWorkspaceStructure();
    details.push(`# Project Structure\n${structure}`);
  }

  // 7. 上下文使用情况
  const usage = this.getContextUsage();
  details.push(`# Context Usage\n${usage.used}/${usage.total} tokens (${usage.percent}%)`);

  // 8. 当前模式
  details.push(`# Current Mode\n${this.currentMode.toUpperCase()} MODE`);

  return `<environment_details>\n${details.join('\n\n')}\n</environment_details>`;
}
```

**注入位置**: 每次用户消息末尾自动附加

**参考**: Cline `/src/core/task/index.ts:3149-3359`

**验收标准**:
- [ ] 每次请求自动注入环境信息
- [ ] 模型无需调用 list_files 即可知道项目结构
- [ ] 模型知道哪些文件已打开

---

### 1.3 RepoMap 代码地图（核心功能）
**优先级**: P0 | **预期提升**: 50%+ | **难度**: 高

**问题**: 模型不知道代码库结构，需要多次探索

**方案**:
```typescript
// 新增文件: src/vs/workbench/contrib/maxian/common/repomap/RepoMapGenerator.ts

import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Java from 'tree-sitter-java';

interface CodeDefinition {
  file: string;
  name: string;
  type: 'class' | 'function' | 'method' | 'interface';
  signature: string;
  startLine: number;
  endLine: number;
  dependencies: string[];
}

class RepoMapGenerator {
  private parser: Parser;
  private maxTokens: number = 2048;
  private cache: Map<string, CodeDefinition[]> = new Map();

  constructor() {
    this.parser = new Parser();
  }

  /**
   * 生成代码库地图
   */
  async generateRepoMap(workspaceRoot: string): Promise<string> {
    // 1. 获取所有代码文件
    const files = await this.getCodeFiles(workspaceRoot);

    // 2. 解析每个文件，提取定义
    const allDefinitions: CodeDefinition[] = [];
    for (const file of files) {
      const definitions = await this.parseFile(file);
      allDefinitions.push(...definitions);
    }

    // 3. 构建依赖图
    const graph = this.buildDependencyGraph(allDefinitions);

    // 4. 按重要性排序（PageRank算法）
    const ranked = this.rankByImportance(graph);

    // 5. 生成地图（控制token预算）
    return this.formatRepoMap(ranked);
  }

  /**
   * 解析单个文件
   */
  private async parseFile(filePath: string): Promise<CodeDefinition[]> {
    // 检查缓存
    const cached = this.cache.get(filePath);
    if (cached) return cached;

    const content = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath);

    // 设置语言
    this.setLanguage(ext);

    // 解析AST
    const tree = this.parser.parse(content);

    // 提取定义
    const definitions = this.extractDefinitions(tree.rootNode, filePath);

    // 缓存结果
    this.cache.set(filePath, definitions);

    return definitions;
  }

  /**
   * 提取代码定义
   */
  private extractDefinitions(node: Parser.SyntaxNode, filePath: string): CodeDefinition[] {
    const definitions: CodeDefinition[] = [];

    const visit = (node: Parser.SyntaxNode) => {
      // 类定义
      if (node.type === 'class_declaration' || node.type === 'class_definition') {
        definitions.push(this.extractClassDefinition(node, filePath));
      }
      // 函数定义
      else if (node.type === 'function_declaration' || node.type === 'function_definition') {
        definitions.push(this.extractFunctionDefinition(node, filePath));
      }
      // 方法定义
      else if (node.type === 'method_definition' || node.type === 'method_declaration') {
        definitions.push(this.extractMethodDefinition(node, filePath));
      }
      // 接口定义
      else if (node.type === 'interface_declaration') {
        definitions.push(this.extractInterfaceDefinition(node, filePath));
      }

      // 递归遍历子节点
      for (const child of node.children) {
        visit(child);
      }
    };

    visit(node);
    return definitions;
  }

  /**
   * 格式化输出
   */
  private formatRepoMap(definitions: CodeDefinition[]): string {
    const byFile = new Map<string, CodeDefinition[]>();

    // 按文件分组
    for (const def of definitions) {
      const list = byFile.get(def.file) || [];
      list.push(def);
      byFile.set(def.file, list);
    }

    // 生成输出
    const lines: string[] = [];
    let tokens = 0;

    for (const [file, defs] of byFile) {
      const fileSection = `${file}:\n${defs.map(d => `  ${d.signature}`).join('\n')}`;
      const sectionTokens = this.estimateTokens(fileSection);

      if (tokens + sectionTokens > this.maxTokens) break;

      lines.push(fileSection);
      tokens += sectionTokens;
    }

    return lines.join('\n\n');
  }
}

// 输出示例：
/*
src/services/UserService.ts:
  class UserService
    constructor(private db: Database)
    async createUser(data: CreateUserDto): Promise<User>
    async getUserById(id: string): Promise<User | null>
    async updateUser(id: string, data: UpdateUserDto): Promise<User>
    async deleteUser(id: string): Promise<void>

src/controllers/UserController.ts:
  class UserController
    constructor(private userService: UserService)
    @Post() create(req: Request): Promise<Response>
    @Get(':id') getById(req: Request): Promise<Response>
    @Put(':id') update(req: Request): Promise<Response>

src/models/User.ts:
  interface User
    id: string
    name: string
    email: string
    createdAt: Date

src/utils/validation.ts:
  function validateEmail(email: string): boolean
  function validatePassword(password: string): boolean
*/
```

**集成方式**:
1. 首次请求时生成并缓存
2. 文件变化时增量更新
3. 作为 environment_details 的一部分注入

**参考**:
- Aider `/aider/repomap.py`
- Continue `/core/util/generateRepoMap.ts`

**验收标准**:
- [ ] 模型首次请求即知道整个代码库结构
- [ ] 地图控制在 2k tokens 以内
- [ ] 支持增量更新

---

### 1.4 提示词变体系统
**优先级**: P0 | **预期提升**: 20%+ | **难度**: 中

**问题**: 所有模型使用同一套提示词，未针对千问优化

**方案**:
```typescript
// 新增目录: src/vs/workbench/contrib/maxian/common/prompts/variants/

// variants/index.ts
export enum ModelFamily {
  QWEN = 'qwen',
  OPENAI = 'openai',
  CLAUDE = 'claude',
  GENERIC = 'generic'
}

// variants/qwen/template.ts
export const QWEN_TEMPLATE = {
  TOOL_USE: `你可以使用以下工具来完成任务。当多个操作相互独立时，你应该在一次响应中返回多个工具调用。

重要规则：
- 读取多个文件时，在一次响应中同时调用多个 read_file
- 搜索多个关键词时，在一次响应中同时调用多个 search_files
- 绝不要连续单独调用相同的工具`,

  RULES: `规则：
- 工作目录：{{CWD}}
- 修改文件前必须先读取
- 优先使用 apply_diff 进行局部修改
- 任务完成后使用 attempt_completion`,

  OBJECTIVE: `目标：
1. 分析用户任务，制定清晰目标
2. 利用 environment_details 中的信息，避免重复探索
3. 高效执行，减少不必要的工具调用
4. 完成后使用 attempt_completion 汇报结果`
};

// variants/registry.ts
class PromptVariantRegistry {
  private variants: Map<ModelFamily, PromptTemplate> = new Map();

  register(family: ModelFamily, template: PromptTemplate) {
    this.variants.set(family, template);
  }

  get(modelId: string): PromptTemplate {
    const family = this.detectModelFamily(modelId);
    return this.variants.get(family) || this.variants.get(ModelFamily.GENERIC)!;
  }

  private detectModelFamily(modelId: string): ModelFamily {
    if (modelId.includes('qwen')) return ModelFamily.QWEN;
    if (modelId.includes('gpt')) return ModelFamily.OPENAI;
    if (modelId.includes('claude')) return ModelFamily.CLAUDE;
    return ModelFamily.GENERIC;
  }
}
```

**参考**: Cline `/src/core/prompts/system-prompt/variants/`

**验收标准**:
- [ ] 千问有专属提示词
- [ ] 模型更好地遵循并行调用指令
- [ ] 可扩展支持其他模型

---

### 1.5 UI 增量渲染
**优先级**: P0 | **预期提升**: 体验 | **难度**: 低

**问题**: 每次 chunk 全量重渲染 Markdown，随文本增长越来越卡

**方案**:
```typescript
// 修改: src/vs/workbench/contrib/maxian/browser/maxianView.ts

class MaxianView {
  private renderPending = false;
  private pendingContent = '';

  /**
   * 流式内容处理（节流渲染）
   */
  private handleStreamChunk(chunk: string) {
    this.pendingContent += chunk;

    // 使用 requestAnimationFrame 节流
    if (!this.renderPending) {
      this.renderPending = true;
      requestAnimationFrame(() => {
        this.doRender();
        this.renderPending = false;
      });
    }
  }

  /**
   * 增量渲染
   */
  private doRender() {
    // 方案A: 流式时显示纯文本，结束后渲染 Markdown
    if (this.isStreaming) {
      this.renderPlainText(this.pendingContent);
    } else {
      this.renderMarkdown(this.pendingContent);
    }

    // 节流滚动
    this.throttledScrollToBottom();
  }

  /**
   * 节流滚动
   */
  private throttledScrollToBottom = throttle(() => {
    this.messageArea.scrollTop = this.messageArea.scrollHeight;
  }, 100);
}
```

**验收标准**:
- [ ] 渲染帧率稳定 60fps
- [ ] 长文本不卡顿
- [ ] 滚动流畅

---

### 1.6 工具参数流式显示
**优先级**: P1 | **预期提升**: 体验 | **难度**: 低

**问题**: 工具调用等待完整解析后才显示，用户感知延迟

**方案**:
```typescript
// 工具调用流式显示
private handleToolCallDelta(delta: ToolCallDelta) {
  // 1. 立即显示工具名称
  if (delta.function?.name && !this.currentToolDisplay) {
    this.currentToolDisplay = this.createToolDisplay(delta.function.name);
    this.showToolDisplay(this.currentToolDisplay);
  }

  // 2. 逐步填充参数
  if (delta.function?.arguments) {
    this.currentToolDisplay.updateArguments(delta.function.arguments);
  }

  // 3. 完成时显示完整信息
  if (delta.isComplete) {
    this.currentToolDisplay.markComplete();
  }
}
```

**验收标准**:
- [ ] 工具名称立即显示
- [ ] 参数逐步填充
- [ ] 用户能看到进度

---

## 三、Phase 2：智能上下文管理

### 2.1 智能上下文压缩（summarize_task）
**优先级**: P1 | **预期提升**: 15%+ | **难度**: 高

**问题**: 简单截断丢失重要上下文，模型重复工作

**方案**:
```typescript
// 新增文件: src/vs/workbench/contrib/maxian/common/context/summarizeTask.ts

interface TaskSummary {
  primaryRequest: string;        // 原始需求
  technicalConcepts: string[];   // 技术概念
  filesAndCode: FileCodeSummary[]; // 文件和代码
  problemsSolved: string[];      // 已解决问题
  pendingTasks: string[];        // 待完成任务
  currentWork: string;           // 当前工作
  nextStep: string;              // 下一步
  requiredFiles: string[];       // 必需文件
}

class TaskSummarizer {
  /**
   * 当上下文接近限制时，生成摘要
   */
  async summarize(messages: Message[]): Promise<TaskSummary> {
    const prompt = this.buildSummarizePrompt(messages);

    // 调用模型生成摘要
    const response = await this.apiHandler.createMessage(
      SUMMARIZE_SYSTEM_PROMPT,
      [{ role: 'user', content: prompt }],
      []
    );

    return this.parseSummary(response);
  }

  /**
   * 检查是否需要压缩
   */
  shouldCompress(tokenCount: number, maxTokens: number): boolean {
    const threshold = 0.75;
    return tokenCount / maxTokens >= threshold;
  }
}

const SUMMARIZE_SYSTEM_PROMPT = `
你的任务是生成对话摘要。这个摘要将用于继续工作，所以必须包含所有关键信息。

摘要必须包含：
1. 用户的原始请求
2. 已完成的工作
3. 待完成的任务
4. 当前工作状态
5. 下一步行动
6. 必需的文件列表

格式：使用结构化的 JSON 输出。
`;
```

**参考**: Cline `/src/core/prompts/contextManagement.ts`

**验收标准**:
- [ ] 上下文接近限制时自动压缩
- [ ] 压缩后保留关键信息
- [ ] 不丢失任务进度

---

### 2.2 Focus Chain 任务进度追踪
**优先级**: P1 | **预期提升**: 15% | **难度**: 中

**问题**: 模型可能忘记任务进度，重复工作

**方案**:
```typescript
// 新增文件: src/vs/workbench/contrib/maxian/common/focusChain/FocusChainManager.ts

class FocusChainManager {
  private currentChecklist: string | null = null;
  private apiRequestsSinceLastUpdate = 0;

  /**
   * 生成任务进度指令
   */
  generateInstructions(): string {
    if (!this.currentChecklist) {
      return FOCUS_CHAIN_INITIAL_PROMPT;
    }

    const { totalItems, completedItems } = this.parseChecklist();
    const percent = Math.round((completedItems / totalItems) * 100);

    return `
# 任务进度 - 必须更新

**当前进度: ${completedItems}/${totalItems} (${percent}%)**

${this.currentChecklist}

请在下一个工具调用中包含 task_progress 参数来更新进度。
`;
  }

  /**
   * 从工具响应更新进度
   */
  updateFromToolResponse(taskProgress: string | undefined) {
    if (taskProgress) {
      this.currentChecklist = taskProgress;
      this.apiRequestsSinceLastUpdate = 0;
      this.saveToFile();
    }
  }
}
```

**参考**: Cline `/src/core/task/focus-chain/`

**验收标准**:
- [ ] 任务进度持久化到文件
- [ ] 模型每次响应更新进度
- [ ] UI 显示进度百分比

---

### 2.3 ACT/PLAN 模式分离
**优先级**: P1 | **预期提升**: 15% | **难度**: 中

**问题**: 模型边做边想，容易走弯路

**方案**:
```typescript
// 新增文件: src/vs/workbench/contrib/maxian/common/modes/modeManager.ts

enum TaskMode {
  ACT = 'act',    // 执行模式
  PLAN = 'plan'   // 规划模式
}

class ModeManager {
  private currentMode: TaskMode = TaskMode.ACT;

  /**
   * 获取模式特定的工具列表
   */
  getToolsForMode(): ToolName[] {
    if (this.currentMode === TaskMode.PLAN) {
      // 规划模式：只有读取和搜索工具
      return ['read_file', 'list_files', 'search_files', 'codebase_search', 'plan_mode_respond'];
    }
    // 执行模式：所有工具
    return ALL_TOOLS;
  }

  /**
   * 获取模式指令
   */
  getModeInstructions(): string {
    if (this.currentMode === TaskMode.PLAN) {
      return `
# PLAN MODE

你正处于规划模式。在此模式下：
1. 只能使用读取和搜索工具
2. 收集足够信息后，制定详细计划
3. 使用 plan_mode_respond 工具提交计划
4. 用户确认后将切换到 ACT MODE 执行
`;
    }
    return `
# ACT MODE

你正处于执行模式。在此模式下：
1. 可以使用所有工具
2. 按计划执行任务
3. 完成后使用 attempt_completion
`;
  }

  /**
   * 切换模式
   */
  switchMode(mode: TaskMode) {
    this.currentMode = mode;
    this.notifyModeChange();
  }
}
```

**参考**: Cline `/src/core/prompts/system-prompt/variants/native-gpt-5/template.ts`

**验收标准**:
- [ ] 支持 /plan 和 /act 命令切换
- [ ] 规划模式限制工具使用
- [ ] 执行模式按计划工作

---

### 2.4 @提及系统
**优先级**: P1 | **预期提升**: 10% | **难度**: 中

**问题**: 用户需要手动复制粘贴文件内容

**方案**:
```typescript
// 新增文件: src/vs/workbench/contrib/maxian/common/mentions/mentionParser.ts

const MENTION_REGEX = /@(\S+)/g;

interface MentionType {
  file: RegExp;      // @/path/to/file.ts
  folder: RegExp;    // @/path/to/folder/
  url: RegExp;       // @https://...
  problems: RegExp;  // @problems
  terminal: RegExp;  // @terminal
  git: RegExp;       // @git-changes, @abc1234
}

class MentionParser {
  /**
   * 解析消息中的@提及
   */
  async parseMentions(text: string): Promise<ParsedMessage> {
    const mentions: Mention[] = [];
    let parsedText = text;

    // 解析文件提及
    parsedText = parsedText.replace(/@\/([^\s]+)/g, (match, path) => {
      mentions.push({ type: 'file', path });
      return `'${path}' (see below for file content)`;
    });

    // 解析问题提及
    if (text.includes('@problems')) {
      mentions.push({ type: 'problems' });
      parsedText = parsedText.replace(/@problems/g, 'Workspace Problems (see below)');
    }

    // 解析终端提及
    if (text.includes('@terminal')) {
      mentions.push({ type: 'terminal' });
      parsedText = parsedText.replace(/@terminal/g, 'Terminal Output (see below)');
    }

    // 获取提及内容
    const contents = await this.fetchMentionContents(mentions);

    return { parsedText, mentions, contents };
  }

  /**
   * 获取提及内容
   */
  private async fetchMentionContents(mentions: Mention[]): Promise<string> {
    const sections: string[] = [];

    for (const mention of mentions) {
      switch (mention.type) {
        case 'file':
          const content = await this.readFile(mention.path);
          sections.push(`<file path="${mention.path}">\n${content}\n</file>`);
          break;
        case 'problems':
          const problems = await this.getWorkspaceProblems();
          sections.push(`<problems>\n${problems}\n</problems>`);
          break;
        case 'terminal':
          const output = await this.getTerminalOutput();
          sections.push(`<terminal>\n${output}\n</terminal>`);
          break;
      }
    }

    return sections.join('\n\n');
  }
}
```

**参考**: Cline `/src/core/mentions/index.ts`

**验收标准**:
- [ ] 支持 @/path/file 引用文件
- [ ] 支持 @problems 引用问题
- [ ] 支持 @terminal 引用终端
- [ ] 自动补全提示

---

### 2.5 自动记忆系统
**优先级**: P1 | **预期提升**: 20% | **难度**: 高

**问题**: 每次会话重新开始，模型不记得之前的决定

**方案**:
```typescript
// 新增文件: src/vs/workbench/contrib/maxian/common/memory/MemoryManager.ts

interface Memory {
  id: string;
  type: 'user' | 'auto';
  content: string;
  createdAt: Date;
  relevanceScore: number;
}

class MemoryManager {
  private memories: Memory[] = [];
  private memoryFile: string;

  /**
   * 自动提取记忆
   */
  async extractMemories(conversation: Message[]): Promise<void> {
    // 使用 sidecar 模型分析对话
    const analysis = await this.analyzeConversation(conversation);

    // 提取重要决定和上下文
    for (const item of analysis.importantItems) {
      this.addMemory({
        type: 'auto',
        content: item.content,
        relevanceScore: item.score
      });
    }
  }

  /**
   * 获取相关记忆
   */
  async getRelevantMemories(context: string): Promise<Memory[]> {
    // 计算相关性分数
    const scored = this.memories.map(m => ({
      ...m,
      relevance: this.calculateRelevance(m.content, context)
    }));

    // 返回最相关的记忆
    return scored
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10);
  }

  /**
   * 注入记忆到提示词
   */
  formatMemoriesForPrompt(memories: Memory[]): string {
    if (memories.length === 0) return '';

    return `
# 项目记忆

以下是之前对话中的重要信息：

${memories.map(m => `- ${m.content}`).join('\n')}

请在回答时考虑这些信息。
`;
  }
}
```

**参考**: Cursor Memories, Windsurf Memories

**验收标准**:
- [ ] 自动提取重要决定
- [ ] 跨会话保留
- [ ] 按相关性注入

---

### 2.6 语义代码索引
**优先级**: P1 | **预期提升**: 30% | **难度**: 高

**问题**: 关键词搜索不够智能，经常找不到相关代码

**方案**:
```typescript
// 新增文件: src/vs/workbench/contrib/maxian/common/indexing/SemanticIndex.ts

class SemanticCodeIndex {
  private embeddings: Map<string, number[]> = new Map();
  private chunkSize = 500;  // 字符

  /**
   * 索引代码库
   */
  async indexWorkspace(workspaceRoot: string): Promise<void> {
    const files = await this.getCodeFiles(workspaceRoot);

    for (const file of files) {
      const content = await fs.readFile(file, 'utf-8');
      const chunks = this.chunkCode(content);

      for (const chunk of chunks) {
        const embedding = await this.getEmbedding(chunk.content);
        const key = `${file}:${chunk.startLine}-${chunk.endLine}`;
        this.embeddings.set(key, embedding);
      }
    }

    this.saveIndex();
  }

  /**
   * 语义搜索
   */
  async search(query: string, topK: number = 10): Promise<SearchResult[]> {
    const queryEmbedding = await this.getEmbedding(query);

    const results: SearchResult[] = [];

    for (const [key, embedding] of this.embeddings) {
      const similarity = this.cosineSimilarity(queryEmbedding, embedding);
      results.push({ key, similarity });
    }

    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * 获取嵌入向量
   */
  private async getEmbedding(text: string): Promise<number[]> {
    // 调用嵌入模型 API
    // 可以使用本地模型或云端服务
    return await this.embeddingService.embed(text);
  }
}
```

**参考**: Cursor indexing, Continue CodeSnippetsIndex

**验收标准**:
- [ ] 支持语义搜索
- [ ] 增量更新索引
- [ ] 搜索结果更准确

---

## 四、Phase 3：高级功能

### 3.1 Architect 双模型架构
**优先级**: P2 | **预期提升**: 30% | **难度**: 高

**问题**: 单模型既要思考又要执行，效率不高

**方案**:
```typescript
// 新增文件: src/vs/workbench/contrib/maxian/common/architect/ArchitectMode.ts

class ArchitectMode {
  private architectModel: string;  // 主模型，负责规划
  private editorModel: string;     // 编辑模型，负责执行

  /**
   * 执行架构师模式
   */
  async execute(userRequest: string): Promise<void> {
    // 1. 架构师模型分析需求，生成计划
    const plan = await this.architect(userRequest);

    // 2. 编辑器模型执行计划
    for (const step of plan.steps) {
      await this.editor(step);
    }
  }

  /**
   * 架构师：生成解决方案
   */
  private async architect(request: string): Promise<Plan> {
    const response = await this.apiHandler.createMessage(
      ARCHITECT_SYSTEM_PROMPT,
      [{ role: 'user', content: request }],
      [], // 架构师不需要工具
      this.architectModel
    );

    return this.parsePlan(response);
  }

  /**
   * 编辑器：执行修改
   */
  private async editor(step: PlanStep): Promise<void> {
    const response = await this.apiHandler.createMessage(
      EDITOR_SYSTEM_PROMPT,
      [{ role: 'user', content: step.instruction }],
      this.editorTools,
      this.editorModel
    );

    await this.executeToolCalls(response);
  }
}

const ARCHITECT_SYSTEM_PROMPT = `
你是一个软件架构师。你的任务是分析用户需求并生成详细的解决方案。

你应该：
1. 理解用户需求
2. 分析现有代码结构
3. 设计解决方案
4. 生成详细的执行步骤

输出格式：
{
  "analysis": "需求分析",
  "approach": "解决方案",
  "steps": [
    { "file": "path/to/file", "action": "modify|create", "instruction": "具体指令" }
  ]
}
`;
```

**参考**: Aider `/aider/coders/architect_coder.py`

**验收标准**:
- [ ] 支持配置不同的架构师和编辑器模型
- [ ] 架构师生成高质量计划
- [ ] 编辑器精确执行

---

### 3.2 Flow 感知系统
**优先级**: P2 | **预期提升**: 体验 | **难度**: 高

**问题**: 模型不知道用户的实时行为

**方案**:
```typescript
// 新增文件: src/vs/workbench/contrib/maxian/common/flow/FlowTracker.ts

interface FlowEvent {
  type: 'file_open' | 'file_edit' | 'file_save' | 'terminal_command' | 'clipboard' | 'navigation';
  timestamp: Date;
  data: any;
}

class FlowTracker {
  private events: FlowEvent[] = [];
  private maxEvents = 100;

  /**
   * 跟踪文件打开
   */
  trackFileOpen(filePath: string) {
    this.addEvent({
      type: 'file_open',
      timestamp: new Date(),
      data: { path: filePath }
    });
  }

  /**
   * 跟踪文件编辑
   */
  trackFileEdit(filePath: string, changes: TextChange[]) {
    this.addEvent({
      type: 'file_edit',
      timestamp: new Date(),
      data: { path: filePath, changes }
    });
  }

  /**
   * 跟踪终端命令
   */
  trackTerminalCommand(command: string, output: string) {
    this.addEvent({
      type: 'terminal_command',
      timestamp: new Date(),
      data: { command, output }
    });
  }

  /**
   * 生成流上下文
   */
  generateFlowContext(): string {
    const recentEvents = this.events.slice(-20);

    return `
# 用户最近行为

${recentEvents.map(e => this.formatEvent(e)).join('\n')}

根据这些行为，用户可能正在进行的工作：
${this.inferIntent(recentEvents)}
`;
  }

  /**
   * 推断用户意图
   */
  private inferIntent(events: FlowEvent[]): string {
    // 分析事件模式，推断用户意图
    const patterns = this.detectPatterns(events);
    return patterns.map(p => `- ${p.description}`).join('\n');
  }
}
```

**参考**: Windsurf Cascade Flow Awareness

**验收标准**:
- [ ] 跟踪文件操作
- [ ] 跟踪终端命令
- [ ] 自动推断意图

---

### 3.3 MCP 协议支持
**优先级**: P2 | **预期提升**: 扩展性 | **难度**: 高

**问题**: 无法扩展连接外部工具和服务

**方案**:
```typescript
// 新增目录: src/vs/workbench/contrib/maxian/common/mcp/

// mcp/McpHub.ts
class McpHub {
  private servers: Map<string, McpServer> = new Map();

  /**
   * 注册 MCP 服务器
   */
  async registerServer(config: McpServerConfig): Promise<void> {
    const server = new McpServer(config);
    await server.connect();
    this.servers.set(config.name, server);
  }

  /**
   * 获取所有可用工具
   */
  async getAvailableTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];

    for (const server of this.servers.values()) {
      const serverTools = await server.listTools();
      tools.push(...serverTools);
    }

    return tools;
  }

  /**
   * 调用 MCP 工具
   */
  async callTool(serverName: string, toolName: string, args: any): Promise<any> {
    const server = this.servers.get(serverName);
    if (!server) throw new Error(`MCP server ${serverName} not found`);

    return await server.callTool(toolName, args);
  }
}

// mcp/McpServer.ts
class McpServer {
  private connection: McpConnection | null = null;

  async connect(): Promise<void> {
    // 实现 MCP 协议连接
  }

  async listTools(): Promise<McpTool[]> {
    // 获取服务器提供的工具列表
  }

  async callTool(name: string, args: any): Promise<any> {
    // 调用工具
  }
}
```

**参考**: Cline MCP support, Continue MCPContextProvider

**验收标准**:
- [ ] 支持连接 MCP 服务器
- [ ] 动态加载工具
- [ ] 支持常见服务（GitHub, Jira等）

---

### 3.4 浏览器自动化
**优先级**: P2 | **预期提升**: 功能 | **难度**: 高

**问题**: 无法进行端到端测试和网页调试

**方案**:
```typescript
// 新增文件: src/vs/workbench/contrib/maxian/common/browser/BrowserSession.ts

class BrowserSession {
  private browser: Browser | null = null;
  private page: Page | null = null;

  /**
   * 启动浏览器
   */
  async launch(url: string): Promise<void> {
    this.browser = await puppeteer.launch({ headless: false });
    this.page = await this.browser.newPage();
    await this.page.goto(url);
  }

  /**
   * 截图
   */
  async screenshot(): Promise<string> {
    if (!this.page) throw new Error('No browser session');
    const buffer = await this.page.screenshot({ encoding: 'base64' });
    return buffer;
  }

  /**
   * 点击元素
   */
  async click(selector: string): Promise<void> {
    if (!this.page) throw new Error('No browser session');
    await this.page.click(selector);
  }

  /**
   * 输入文本
   */
  async type(selector: string, text: string): Promise<void> {
    if (!this.page) throw new Error('No browser session');
    await this.page.type(selector, text);
  }

  /**
   * 获取控制台日志
   */
  async getConsoleLogs(): Promise<string[]> {
    // 返回收集的控制台日志
  }
}
```

**参考**: Cline browser_action tool

**验收标准**:
- [ ] 支持启动浏览器
- [ ] 支持截图和元素交互
- [ ] 支持控制台日志捕获

---

### 3.5 多模型支持
**优先级**: P2 | **预期提升**: 20%+ | **难度**: 中

**问题**: 只支持千问，无法使用其他更强的模型

**方案**:
```typescript
// 新增文件: src/vs/workbench/contrib/maxian/common/api/providers/

// providers/index.ts
export interface ApiProvider {
  name: string;
  createMessage(systemPrompt: string, messages: Message[], tools: Tool[]): AsyncIterable<StreamChunk>;
}

// providers/openai.ts
class OpenAIProvider implements ApiProvider {
  name = 'openai';

  async *createMessage(...): AsyncIterable<StreamChunk> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: this.formatMessages(messages),
      tools: this.formatTools(tools),
      stream: true
    });

    for await (const chunk of response) {
      yield this.parseChunk(chunk);
    }
  }
}

// providers/anthropic.ts
class AnthropicProvider implements ApiProvider {
  name = 'anthropic';
  // Claude API 实现
}

// providers/ollama.ts
class OllamaProvider implements ApiProvider {
  name = 'ollama';
  // 本地模型实现
}
```

**验收标准**:
- [ ] 支持 OpenAI API
- [ ] 支持 Claude API
- [ ] 支持本地模型（Ollama）
- [ ] 统一的切换界面

---

### 3.6 钩子系统
**优先级**: P2 | **预期提升**: 扩展性 | **难度**: 中

**问题**: 无法自定义工具使用前后的行为

**方案**:
```typescript
// 新增文件: src/vs/workbench/contrib/maxian/common/hooks/HookManager.ts

type HookType = 'pre-tool-use' | 'post-tool-use' | 'pre-compact' | 'user-prompt';

interface Hook {
  type: HookType;
  command: string;
  timeout: number;
}

class HookManager {
  private hooks: Map<HookType, Hook[]> = new Map();

  /**
   * 注册钩子
   */
  register(hook: Hook): void {
    const list = this.hooks.get(hook.type) || [];
    list.push(hook);
    this.hooks.set(hook.type, list);
  }

  /**
   * 执行钩子
   */
  async execute(type: HookType, context: any): Promise<HookResult> {
    const hooks = this.hooks.get(type) || [];

    for (const hook of hooks) {
      const result = await this.runHook(hook, context);
      if (result.cancel) {
        return result;
      }
    }

    return { cancel: false };
  }
}
```

**参考**: Cline `/src/core/hooks/`

**验收标准**:
- [ ] 支持工具使用前后钩子
- [ ] 支持用户输入钩子
- [ ] 配置文件支持

---

## 五、Phase 4：性能与体验

### 4.1 增量文件索引
**优先级**: P3 | **预期提升**: 性能 | **难度**: 中

**方案**:
```typescript
class IncrementalIndexer {
  private fileHashes: Map<string, string> = new Map();

  /**
   * 检测变化并增量更新
   */
  async updateIndex(): Promise<void> {
    const files = await this.getCodeFiles();

    for (const file of files) {
      const hash = await this.hashFile(file);
      const oldHash = this.fileHashes.get(file);

      if (hash !== oldHash) {
        await this.reindexFile(file);
        this.fileHashes.set(file, hash);
      }
    }
  }
}
```

---

### 4.2 Token 使用统计
**优先级**: P3 | **预期提升**: 体验 | **难度**: 低

**方案**:
```typescript
class TokenTracker {
  private usage = {
    totalIn: 0,
    totalOut: 0,
    totalCost: 0
  };

  track(tokensIn: number, tokensOut: number, cost: number) {
    this.usage.totalIn += tokensIn;
    this.usage.totalOut += tokensOut;
    this.usage.totalCost += cost;

    this.notifyUI();
  }
}
```

---

### 4.3 错误提示优化
**优先级**: P3 | **预期提升**: 体验 | **难度**: 低

**方案**: 根据是否使用原生工具调用，使用不同的错误提示

---

### 4.4 检查点与回滚
**优先级**: P3 | **预期提升**: 体验 | **难度**: 中

**方案**: 在每次文件修改前自动创建检查点，支持一键回滚

---

### 4.5 用户规则系统
**优先级**: P3 | **预期提升**: 可定制 | **难度**: 低

**方案**:
```typescript
// 支持 .maxian/rules 目录
// 支持 .cursor/rules 兼容
// 支持 .windsurf/rules 兼容
```

---

## 六、实施时间表

### Week 1-2: Phase 1 基础效率优化
- [ ] 1.1 原生并行工具调用
- [ ] 1.2 environment_details 注入
- [ ] 1.3 RepoMap 代码地图（基础版）
- [ ] 1.4 提示词变体系统
- [ ] 1.5 UI 增量渲染
- [ ] 1.6 工具参数流式显示

### Week 3-5: Phase 2 智能上下文管理
- [ ] 2.1 智能上下文压缩
- [ ] 2.2 Focus Chain 任务进度
- [ ] 2.3 ACT/PLAN 模式分离
- [ ] 2.4 @提及系统
- [ ] 2.5 自动记忆系统
- [ ] 2.6 语义代码索引

### Week 6-8: Phase 3 高级功能
- [ ] 3.1 Architect 双模型架构
- [ ] 3.2 Flow 感知系统
- [ ] 3.3 MCP 协议支持
- [ ] 3.4 浏览器自动化
- [ ] 3.5 多模型支持
- [ ] 3.6 钩子系统

### Week 9-10: Phase 4 性能与体验
- [ ] 4.1 增量文件索引
- [ ] 4.2 Token 使用统计
- [ ] 4.3 错误提示优化
- [ ] 4.4 检查点与回滚
- [ ] 4.5 用户规则系统

---

## 七、技术依赖

### 需要添加的依赖
```json
{
  "dependencies": {
    "tree-sitter": "^0.20.0",
    "tree-sitter-typescript": "^0.20.0",
    "tree-sitter-python": "^0.20.0",
    "tree-sitter-java": "^0.20.0",
    "tree-sitter-javascript": "^0.20.0",
    "puppeteer": "^21.0.0",
    "@anthropic-ai/sdk": "^0.20.0",
    "openai": "^4.0.0",
    "chokidar": "^3.5.0"
  }
}
```

### 参考代码库
- Cline: https://github.com/cline/cline
- Aider: https://github.com/Aider-AI/aider
- Continue: https://github.com/continuedev/continue
- Roo Code: https://github.com/RooVetGit/Roo-Code

---

## 八、验收标准

### 效率指标
- [ ] 同一任务 API 调用次数减少 50%+
- [ ] 任务完成时间减少 60%+
- [ ] 首Token延迟 < 2秒

### 功能指标
- [ ] RepoMap 覆盖所有主流语言
- [ ] 语义搜索准确率 > 80%
- [ ] 多模型切换无缝

### 体验指标
- [ ] UI 渲染帧率稳定 60fps
- [ ] 流式响应无卡顿
- [ ] 进度追踪清晰可见

---

## 九、风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| tree-sitter 集成复杂 | RepoMap延期 | 先实现简化版，逐步增强 |
| 语义索引需要嵌入模型 | 成本增加 | 支持本地嵌入模型 |
| 千问不支持并行调用 | 效率受限 | 在应用层模拟并行 |
| MCP 协议复杂 | 开发周期长 | 分阶段实现，先支持核心功能 |

---

*此计划基于 Cline、Aider、Cursor、Windsurf、Continue 等工具的深度分析，旨在让码弦达到业界领先水平。*
