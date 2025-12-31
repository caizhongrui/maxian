# 码弦 Agent 优化计划（数据库架构版）

> 基于现有的后端数据库提示词管理架构
> 数据库：qdport_ai.ai_prompt_template
> 后端服务：AiPromptAssemblyService

---

## 架构现状

### 当前架构
```
前端IDE (maxianService.ts)
    ↓ (生成本地提示词，但后端可能不使用)
后端API (AiProxyServiceImpl)
    ↓ (根据 businessCode 查询)
数据库 (ai_prompt_template)
    ↓ (存储31个提示词模板)
AiPromptAssemblyService
    ↓ (组装最终提示词)
AI模型
```

### 已有的提示词（31个）
- **IDE系统级**: 7个（capabilities, markdown_formatting, modes, objective, rules等）
- **IDE角色定义**: 5个（architect, code, ask, debug, orchestrator）
- **IDE自定义指令**: 4个
- **代码生成**: 6个（测试、业务代码、类、方法等）
- **代码补全**: 1个
- **注释生成**: 3个
- **数据库功能**: 5个（SQL优化、表设计、健康检查等）

### 业务场景配置（19个）
- IDE_CHAT_CODE → qwen-plus
- IDE_CHAT_ARCHITECT → qwen-plus
- IDE_CODE_COMPLETION → qwen3-coder-flash
- IDE_DB_SQL_OPTIMIZE → qwen3-coder-flash
- 等...

---

## 优化策略：混合架构

**核心原则**：
- ✅ **静态提示词** → 后端数据库存储（方便管理、多租户）
- ✅ **动态上下文** → 前端IDE生成（实时状态、性能）

---

## Phase 1：前端动态上下文增强（2周）

### 1.1 environment_details 动态注入
**优先级**: P0 | **影响**: 25%+ | **难度**: 低

**实现位置**: 前端 IDE

**方案**:
```typescript
// 新增文件: src/vs/workbench/contrib/maxian/common/context/environmentDetails.ts

export class EnvironmentDetailsProvider {
    /**
     * 生成环境详情（不修改系统提示词，作为用户消息附加）
     */
    async generate(): Promise<string> {
        const sections: string[] = [];

        // 1. 可见文件
        const visibleFiles = await this.getVisibleFiles();
        if (visibleFiles.length > 0) {
            sections.push(`# 可见文件\n${visibleFiles.join('\n')}`);
        }

        // 2. 打开的Tab
        const openTabs = await this.getOpenTabs();
        if (openTabs.length > 0) {
            sections.push(`# 打开的标签\n${openTabs.join('\n')}`);
        }

        // 3. 活跃终端
        const terminals = await this.getActiveTerminals();
        if (terminals.length > 0) {
            sections.push(`# 活跃终端\n${this.formatTerminals(terminals)}`);
        }

        // 4. 最近修改的文件
        const recentFiles = this.fileContextTracker.getRecentlyModifiedFiles();
        if (recentFiles.length > 0) {
            sections.push(`# 最近修改\n${recentFiles.join('\n')}`);
        }

        // 5. 当前时间
        sections.push(`# 当前时间\n${new Date().toLocaleString('zh-CN')}`);

        return `<environment_details>\n${sections.join('\n\n')}\n</environment_details>`;
    }
}

// maxianService.ts 修改
private async startTask(task: string): Promise<void> {
    // 生成动态环境详情
    const envDetails = await this.environmentDetailsProvider.generate();

    // 附加到用户消息
    const fullUserMessage = `${task}\n\n${envDetails}`;

    // 创建任务（后端从数据库获取静态提示词）
    await this.taskService.start(fullUserMessage);
}
```

**数据库无需修改**

**验收标准**:
- [ ] 模型知道当前打开的文件
- [ ] 模型知道最近的修改
- [ ] 减少1-3次探索性工具调用

---

### 1.2 RepoMap 代码地图
**优先级**: P0 | **影响**: 50%+ | **难度**: 高

**实现位置**: 前端 IDE

**方案**:
```typescript
// 新增文件: src/vs/workbench/contrib/maxian/common/repomap/RepoMapGenerator.ts

import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Java from 'tree-sitter-java';

interface CodeSymbol {
    file: string;
    name: string;
    type: 'class' | 'function' | 'method' | 'interface';
    signature: string;
    line: number;
}

export class RepoMapGenerator {
    private parser: Parser;
    private cache: Map<string, CodeSymbol[]> = new Map();
    private maxTokens = 2048;

    /**
     * 生成仓库地图
     */
    async generate(workspaceRoot: string): Promise<string> {
        const files = await this.getCodeFiles(workspaceRoot, 200); // 限制200个文件
        const symbols: CodeSymbol[] = [];

        for (const file of files) {
            const fileSymbols = await this.parseFile(file);
            symbols.push(...fileSymbols);
        }

        return this.format(symbols);
    }

    /**
     * 解析文件提取符号
     */
    private async parseFile(filePath: string): Promise<CodeSymbol[]> {
        const cached = this.cache.get(filePath);
        if (cached) return cached;

        const content = await fs.readFile(filePath, 'utf-8');
        const ext = path.extname(filePath);

        // 根据扩展名设置语言
        this.setLanguage(ext);

        const tree = this.parser.parse(content);
        const symbols = this.extractSymbols(tree.rootNode, filePath);

        this.cache.set(filePath, symbols);
        return symbols;
    }

    /**
     * 格式化输出
     */
    private format(symbols: CodeSymbol[]): string {
        const byFile = new Map<string, CodeSymbol[]>();

        for (const symbol of symbols) {
            const list = byFile.get(symbol.file) || [];
            list.push(symbol);
            byFile.set(symbol.file, list);
        }

        const lines: string[] = [];
        let tokens = 0;

        for (const [file, syms] of byFile) {
            const section = `${file}:\n${syms.map(s => `  ${s.signature}`).join('\n')}`;
            const sectionTokens = Math.ceil(section.length / 2.5);

            if (tokens + sectionTokens > this.maxTokens) break;

            lines.push(section);
            tokens += sectionTokens;
        }

        return `<repo_map>\n${lines.join('\n\n')}\n</repo_map>`;
    }
}
```

**使用方式**:
```typescript
// maxianService.ts
private async startTask(task: string): Promise<void> {
    // 1. 生成 RepoMap（首次或文件变化时）
    const repoMap = await this.repoMapGenerator.generate(this.workspaceRoot);

    // 2. 生成 environment_details
    const envDetails = await this.environmentDetailsProvider.generate();

    // 3. 组合用户消息
    const fullUserMessage = `${task}\n\n${envDetails}\n\n${repoMap}`;

    // 4. 后端从数据库获取静态提示词
    await this.taskService.start(fullUserMessage);
}
```

**数据库无需修改**

**验收标准**:
- [ ] 模型看到完整代码结构
- [ ] 减少50%的文件读取
- [ ] 支持TS/JS/Python/Java

---

### 1.3 并行工具调用确认
**优先级**: P0 | **影响**: 30%+ | **难度**: 低

**方案**:
```typescript
// 修改: aiProxyHandler.ts
const requestBody = {
    username: this.config.username,
    password: this.config.password,
    businessCode: this.config.businessCode,
    messages: aiProxyMessages,
    tools: aiProxyTools,
    stream: true,
    parallel_tool_calls: true,  // ✅ 确保启用
    parallelToolCalls: true     // ✅ 兼容两种格式
};
```

**后端检查**: `AiProxyServiceImpl.java`
```java
// 确保转发到千问API时保留此参数
private JSONObject buildRequestBody(CodeReviewAiConfig config, AiProxyRequest request) {
    JSONObject body = new JSONObject();
    // ...
    if (request.getParallelToolCalls() != null) {
        body.set("parallel_tool_calls", request.getParallelToolCalls());
    }
    return body;
}
```

**验收标准**:
- [ ] 一次响应返回多个tool_calls
- [ ] 读取3个文件只需1次API调用

---

### 1.4 UI 增量渲染
**优先级**: P0 | **影响**: 体验 | **难度**: 低

（同之前方案，无需数据库）

---

### 1.5 工具参数流式显示
**优先级**: P1 | **影响**: 体验 | **难度**: 低

（同之前方案，无需数据库）

---

### 1.6 提示词变体优化（数据库版）
**优先级**: P0 | **影响**: 20%+ | **难度**: 中

**实现位置**: 后端数据库 + 服务

**方案**:

**1. 数据库增加模型家族字段**
```sql
ALTER TABLE ai_prompt_template
ADD COLUMN model_family VARCHAR(50) DEFAULT 'generic' COMMENT '模型家族(qwen/openai/claude/generic)';

-- 为现有数据设置
UPDATE ai_prompt_template SET model_family = 'qwen';
```

**2. 创建千问优化版本的提示词**
```sql
-- 插入千问专属的工具使用说明
INSERT INTO ai_prompt_template (
    prompt_key,
    prompt_name,
    prompt_category,
    model_family,
    template_content
) VALUES (
    'tool_use_qwen',
    '工具使用说明-千问优化版',
    'IDE系统级',
    'qwen',
    '你可以使用以下工具。当需要执行多个独立操作时，必须在一次响应中返回多个工具调用。

重要规则（千问优化）：
- 读取多个文件 → 一次响应中调用多个 read_file
- 多个搜索 → 一次响应中调用多个 search_files
- 绝对禁止连续单独调用相同工具

示例：
错误❌：
第1次响应: read_file(a.ts)
第2次响应: read_file(b.ts)

正确✅：
一次响应: [read_file(a.ts), read_file(b.ts), read_file(c.ts)]'
);

-- 插入千问专属的目标说明
INSERT INTO ai_prompt_template (
    prompt_key,
    prompt_name,
    prompt_category,
    model_family,
    template_content
) VALUES (
    'objective_qwen',
    '目标说明-千问优化版',
    'IDE系统级',
    'qwen',
    '你的任务是高效完成用户需求：

1. 分析任务 - 利用 <environment_details> 中的信息
2. 并行操作 - 需要读取多个文件时，一次调用多个工具
3. 精准执行 - 避免重复探索
4. 汇报结果 - 使用 attempt_completion'
);
```

**3. 后端服务支持模型家族**
```java
// AiPromptAssemblyServiceImpl.java 修改

@Override
public String assembleSystemPrompt(String mode, Map<String, Object> context) {
    // 获取模型家族
    String modelFamily = (String) context.getOrDefault("modelFamily", "qwen");

    List<String> sections = new ArrayList<>();

    // 1. 角色定义
    sections.add(getRoleDefinition(mode, modelFamily));

    // 2. 工具使用说明（优先查找模型特定版本）
    sections.add(getPromptSectionWithFallback("tool_use", modelFamily));

    // 3. 目标（优先查找模型特定版本）
    sections.add(getPromptSectionWithFallback("objective", modelFamily));

    // ...其他sections

    return String.join("\n\n", sections);
}

/**
 * 获取提示词section，支持模型家族回退
 */
private String getPromptSectionWithFallback(String key, String modelFamily) {
    // 1. 先尝试获取模型特定版本
    String specificKey = key + "_" + modelFamily;
    String content = getPromptSection(specificKey);

    if (content != null && !content.isEmpty()) {
        return content;
    }

    // 2. 回退到通用版本
    return getPromptSection(key);
}
```

**4. 前端传递模型信息**
```typescript
// aiProxyHandler.ts 修改
const requestBody = {
    username: this.config.username,
    password: this.config.password,
    businessCode: this.config.businessCode,
    modelFamily: 'qwen',  // 新增：告知后端使用千问优化版提示词
    messages: aiProxyMessages,
    tools: aiProxyTools,
    stream: true,
    parallel_tool_calls: true
};
```

**验收标准**:
- [ ] 千问使用专属优化提示词
- [ ] 未来可扩展OpenAI、Claude版本
- [ ] 提示词在数据库中管理

---

## Phase 2：后端提示词优化（数据库）

### 2.1 添加千问并行工具调用强化提示
**优先级**: P0 | **难度**: 低

**SQL脚本**:
```sql
-- 更新 tool_use 为千问优化版
UPDATE ai_prompt_template
SET template_content = '你可以使用以下工具。

⚠️ 【千问并行调用规则 - 必须遵守】
当需要执行2个或更多独立操作时，必须在一次响应中返回多个工具调用！

正确示例：
{
  "tool_calls": [
    {"name": "read_file", "arguments": {"path": "src/a.ts"}},
    {"name": "read_file", "arguments": {"path": "src/b.ts"}},
    {"name": "read_file", "arguments": {"path": "src/c.ts"}}
  ]
}

错误示例（禁止！）：
响应1: read_file(a.ts)
响应2: read_file(b.ts)  ← 浪费时间！

规则：
- 读取多个文件 → 一次返回多个read_file调用
- 多个搜索 → 一次返回多个search_files调用
- 搜索+列表 → 一次返回search_files和list_files

违反此规则将导致任务效率极低！'
WHERE prompt_key = 'tool_use';

-- 或者插入千问专属版本
INSERT INTO ai_prompt_template (
    prompt_key,
    prompt_name,
    prompt_category,
    model_family,
    template_content,
    enabled
) VALUES (
    'tool_use',
    '工具使用说明-千问强化版',
    'IDE系统级',
    'qwen',
    '...(同上)',
    1
);
```

---

### 2.2 添加 RepoMap 提示词说明
**优先级**: P0 | **难度**: 低

**SQL脚本**:
```sql
-- 插入 RepoMap 说明
INSERT INTO ai_prompt_template (
    prompt_key,
    prompt_name,
    prompt_category,
    template_content,
    enabled
) VALUES (
    'repo_map_usage',
    'RepoMap使用说明',
    'IDE系统级',
    '# 代码库地图

用户消息中可能包含 <repo_map> 标签，这是整个代码库的结构概览。

RepoMap 包含：
- 所有主要文件的路径
- 每个文件中的类、函数、方法签名
- 代码结构关系

利用 RepoMap：
1. 首先查看 RepoMap 了解代码结构
2. 确定需要详细查看哪些文件
3. 使用 read_file 读取具体文件

这样可以避免盲目搜索和多次试探。',
    1
);
```

**后端服务修改**:
```java
// AiPromptAssemblyServiceImpl.java
@Override
public String assembleSystemPrompt(String mode, Map<String, Object> context) {
    List<String> sections = new ArrayList<>();

    // ... 其他sections

    // 添加 RepoMap 使用说明
    sections.add(getPromptSection("repo_map_usage"));

    return String.join("\n\n", sections);
}
```

---

### 2.3 添加 environment_details 使用说明
**优先级**: P0 | **难度**: 低

**SQL脚本**:
```sql
INSERT INTO ai_prompt_template (
    prompt_key,
    prompt_name,
    prompt_category,
    template_content,
    enabled
) VALUES (
    'environment_details_usage',
    'Environment Details使用说明',
    'IDE系统级',
    '# 环境详情

每条用户消息末尾会自动包含 <environment_details>，包含：

1. **可见文件** - 用户当前正在查看的文件
2. **打开的标签** - 所有打开的文件
3. **活跃终端** - 正在运行的命令及输出
4. **最近修改** - 刚修改过的文件（可能需要重新读取）
5. **当前时间** - 用于时间相关操作
6. **项目结构** - 首次请求时包含

利用这些信息：
- 避免调用 list_files 了解项目结构
- 避免询问用户"打开了哪些文件"
- 直接知道哪些文件需要重新读取

这些信息是自动注入的，不需要你额外获取。',
    1
);
```

---

### 2.4 优化现有提示词
**优先级**: P1 | **难度**: 低

**SQL脚本**:
```sql
-- 1. 简化 noToolsUsed 错误提示
UPDATE ai_prompt_template
SET template_content = '[错误] 你在上一次响应中没有使用任何工具！

请立即使用工具重试。如果任务已完成，使用 attempt_completion。'
WHERE prompt_key = 'no_tools_used';

-- 2. 添加工具使用指南的并行强调
UPDATE ai_prompt_template
SET template_content = CONCAT(
    template_content,
    '\n\n⚠️ 关键规则：多个独立操作时，必须在一次响应中调用多个工具！'
)
WHERE prompt_key = 'tool_use_guidelines';
```

---

## Phase 3：后端 API 优化

### 3.1 确保 parallel_tool_calls 转发
**优先级**: P0 | **难度**: 低

**修改文件**: `AiProxyServiceImpl.java`

```java
private JSONObject buildRequestBody(CodeReviewAiConfig config, AiProxyRequest request) {
    JSONObject body = new JSONObject();

    // 基础参数
    body.set("model", request.getModel() != null ? request.getModel() : config.getDefaultModel());
    body.set("messages", request.getMessages());
    body.set("stream", request.getStream() != null ? request.getStream() : true);

    // 工具参数
    if (request.getTools() != null && !request.getTools().isEmpty()) {
        body.set("tools", request.getTools());

        // ✅ 关键：转发并行工具调用参数
        Boolean parallelToolCalls = request.getParallelToolCalls();
        if (parallelToolCalls == null) {
            parallelToolCalls = true; // 默认启用
        }
        body.set("parallel_tool_calls", parallelToolCalls);

        log.info("启用并行工具调用: {}", parallelToolCalls);
    }

    // 其他参数...

    return body;
}
```

**验收标准**:
- [ ] 参数正确转发到千问
- [ ] 日志显示已启用

---

### 3.2 添加模型家族检测
**优先级**: P1 | **难度**: 低

**新增 Service 方法**:
```java
// AiPromptAssemblyServiceImpl.java

/**
 * 检测模型家族
 */
private String detectModelFamily(String provider, String model) {
    if (model == null) {
        // 根据provider推断
        if ("qwen".equals(provider)) return "qwen";
        if ("openai".equals(provider)) return "openai";
        if ("anthropic".equals(provider)) return "claude";
        return "generic";
    }

    // 根据model名称检测
    if (model.contains("qwen")) return "qwen";
    if (model.contains("gpt")) return "openai";
    if (model.contains("claude")) return "claude";
    if (model.contains("deepseek")) return "deepseek";

    return "generic";
}

@Override
public String assembleSystemPrompt(String mode, Map<String, Object> context) {
    // 获取模型信息
    String provider = (String) context.get("provider");
    String model = (String) context.get("model");
    String modelFamily = detectModelFamily(provider, model);

    log.info("组装提示词: mode={}, provider={}, model={}, modelFamily={}",
        mode, provider, model, modelFamily);

    // 使用模型家族特定的提示词
    // ...
}
```

---

## Phase 4：前端功能增强

### 4.1 Focus Chain 深度集成
**优先级**: P1 | **难度**: 中

**方案**:
```typescript
// 前端实现 Focus Chain Manager
// 后端数据库存储相关提示词（已有 focus_chain 相关提示）
```

---

### 4.2 @提及系统
**优先级**: P1 | **难度**: 中

（前端实现，无需后端数据库修改）

---

### 4.3 自动记忆系统
**优先级**: P2 | **难度**: 高

**方案**:
```sql
-- 新增记忆表
CREATE TABLE ai_memory (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL COMMENT '用户ID',
    workspace_path VARCHAR(500) COMMENT '工作区路径',
    memory_type VARCHAR(20) NOT NULL COMMENT '记忆类型(user/auto)',
    content TEXT NOT NULL COMMENT '记忆内容',
    relevance_score DECIMAL(5,2) DEFAULT 1.0 COMMENT '相关性分数',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_workspace (user_id, workspace_path)
) COMMENT='AI记忆存储表';
```

---

## 优化优先级总结（数据库架构版）

### 立即实施（不需要改数据库）

| 优化项 | 位置 | 难度 | 影响 |
|--------|------|------|------|
| 1. environment_details 注入 | 前端 | 低 | 25%+ |
| 2. RepoMap 生成 | 前端 | 高 | 50%+ |
| 3. 并行调用参数转发 | 前后端 | 低 | 30%+ |
| 4. UI 增量渲染 | 前端 | 低 | 体验 |
| 5. 工具参数流式显示 | 前端 | 低 | 体验 |

### 第二阶段（需要修改数据库）

| 优化项 | 数据库改动 | 难度 | 影响 |
|--------|-----------|------|------|
| 6. 提示词变体系统 | 加字段+新数据 | 中 | 20%+ |
| 7. Focus Chain 提示优化 | 更新现有数据 | 低 | 15% |
| 8. 并行调用强化提示 | 更新现有数据 | 低 | 20%+ |

### 第三阶段（功能扩展）

| 优化项 | 数据库改动 | 难度 | 影响 |
|--------|-----------|------|------|
| 9. 自动记忆 | 新表 | 高 | 20%+ |
| 10. 多模型支持 | 配置表改动 | 中 | 功能 |

---

## 关键洞察

### 你的架构优势
✅ **提示词集中管理** - 便于多租户、版本控制
✅ **业务场景配置** - businessCode → 自动选模型
✅ **已有31个提示词** - 基础完善

### 优化重点
🔴 **前端生成动态上下文** - environment_details、RepoMap
🟡 **数据库优化静态提示** - 添加千问优化版、模型家族支持
🟢 **后端转发参数** - 确保 parallel_tool_calls 生效

### 不需要大改的理由
- 提示词的**静态部分**（角色、规则、能力）继续用数据库
- 提示词的**动态部分**（环境、代码地图）在前端生成
- 两者在**用户消息**中合并，不破坏现有架构

---

## 实施建议

**Week 1**:
1. 前端实现 environment_details
2. 确认 parallel_tool_calls 转发
3. UI 增量渲染

**Week 2**:
4. RepoMap 基础实现（TS/JS）
5. 数据库添加千问优化提示词
6. 工具参数流式显示

**Week 3-4**:
7. RepoMap 扩展（Python/Java）
8. 提示词变体系统（加model_family字段）
9. Focus Chain 集成

---

*基于你的数据库架构设计的优化方案，最大程度利用现有基础设施*
