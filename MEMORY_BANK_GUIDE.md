# Memory Bank 项目学习系统

## 概述

Memory Bank 是一个智能的项目学习和记忆系统，参考 KiloCode 的设计理念，为 AI 辅助开发提供项目特定的上下文信息。

## 核心功能

### 1. 自动项目学习

Memory Bank 可以自动分析项目并提取以下信息：

- **项目结构分析**：识别项目类型、框架、语言、目录结构
- **技术栈分析**：提取依赖关系、核心技术
- **编码规范学习**：通过分析代码示例，提取编码风格和规范
- **设计模式识别**：识别项目中常用的设计模式
- **最佳实践提取**：发现项目中的最佳实践和开发规范

### 2. 记忆类别

记忆条目按以下类别组织：

- `architecture`：架构设计文档
- `coding-style`：编码规范和风格指南
- `project-structure`：项目结构说明
- `dependencies`：依赖关系文档
- `best-practices`：最佳实践
- `common-patterns`：常用设计模式
- `custom`：自定义记忆

### 3. 存储位置

所有记忆条目存储在项目的 `.zhikai/memory-bank/` 目录下，按类别分目录存储，使用 Markdown 格式。

## 使用方法

### 方式一：通过命令面板

1. 打开命令面板（`Cmd/Ctrl + Shift + P`）
2. 输入 "Memory Bank" 查看可用命令：
   - `Memory Bank: 初始化项目记忆库`
   - `Memory Bank: 学习项目结构`
   - `Memory Bank: 学习编码规范`
   - `Memory Bank: 添加自定义记忆`
   - `Memory Bank: 查看所有记忆`
   - `Memory Bank: 生成项目上下文摘要`

### 方式二：通过代码使用服务

```typescript
import { IMemoryBankService } from 'vs/workbench/services/memoryBank/common/memoryBank';

// 依赖注入获取服务
constructor(
    @IMemoryBankService private readonly memoryBankService: IMemoryBankService
) {}

// 初始化 Memory Bank
await this.memoryBankService.initialize(workspaceUri);

// 学习项目结构
await this.memoryBankService.learnProjectStructure(workspaceUri);

// 学习编码规范
const sampleFiles = [/* URI[] */];
await this.memoryBankService.learnCodingStyle(workspaceUri, sampleFiles);

// 添加自定义记忆
await this.memoryBankService.addEntry(workspaceUri, {
    title: '数据库连接规范',
    content: '使用连接池，最大连接数 50...',
    category: 'best-practices',
    tags: ['database', 'connection']
});

// 获取所有记忆
const memories = await this.memoryBankService.getAllEntries(workspaceUri);

// 生成上下文摘要（用于 AI prompt）
const summary = await this.memoryBankService.generateContextSummary(workspaceUri);
```

### 方式三：使用增强功能

```typescript
import { MemoryBankEnhancedFeatures } from 'vs/workbench/services/memoryBank/browser/memoryBankEnhanced';

// 创建增强功能实例
const enhanced = new MemoryBankEnhancedFeatures(
    memoryBankService,
    fileService,
    projectAnalyzer,
    aiService
);

// 一键自动学习整个项目
await enhanced.autoLearnProject(workspaceUri);

// 生成增强的 AI prompt
const enhancedPrompt = await enhanced.generateEnhancedPrompt(
    workspaceUri,
    '帮我创建一个用户服务',
    ['architecture', 'coding-style', 'common-patterns']
);

// 智能搜索记忆
const relevantMemories = await enhanced.smartSearch(
    workspaceUri,
    ['controller', 'rest', 'api']
);
```

## 工作流程示例

### 新项目接入

1. **初始化**
   ```typescript
   await memoryBankService.initialize(workspaceUri);
   ```

2. **一键学习**
   ```typescript
   await enhanced.autoLearnProject(workspaceUri);
   ```

3. **验证记忆**
   ```typescript
   const memories = await memoryBankService.getAllEntries(workspaceUri);
   console.log(`学习完成，生成 ${memories.length} 条记忆`);
   ```

### AI 代码生成时使用记忆

```typescript
// 1. 获取项目上下文
const context = await memoryBankService.generateContextSummary(workspaceUri);

// 2. 构建增强的 prompt
const prompt = `
${context}

【用户需求】
${userRequirement}

请根据以上项目上下文，生成符合项目规范的代码。
`;

// 3. 调用 AI 生成
const result = await aiService.complete(prompt);
```

### 持续学习

```typescript
// 当发现新的最佳实践时
await memoryBankService.addEntry(workspaceUri, {
    title: '分页查询标准实现',
    content: `
# 分页查询规范

## Controller 层
\`\`\`java
@GetMapping("/list")
public Result<Page<User>> list(PageRequest pageRequest) {
    return Result.success(userService.page(pageRequest));
}
\`\`\`

## Service 层
使用 MyBatis-Plus 的 Page 对象...
    `,
    category: 'best-practices',
    tags: ['pagination', 'mybatis-plus', 'api']
});
```

## 记忆文件格式

每个记忆条目存储为独立的 Markdown 文件，包含 YAML frontmatter：

```markdown
---
id: abc123xyz
title: 项目结构
category: project-structure
tags: structure, auto-generated, spring-boot
created: 2025-01-14T00:00:00.000Z
updated: 2025-01-14T00:00:00.000Z
---

# 项目结构

## 项目类型
spring-boot

## 框架
Spring Boot

## 主要语言
java

## 目录结构
- 源码目录: /path/to/src/main/java
- 测试目录: /path/to/src/test/java
...
```

## 与 AI 集成

Memory Bank 与 AI 服务深度集成：

### 自动学习编码规范

```typescript
// AI 会分析代码样本并提取规范
await memoryBankService.learnCodingStyle(workspaceUri, sampleFiles);

// 生成的记忆示例：
/*
# 编码规范

## 缩进风格
- 使用 4 个空格缩进
- 不使用 Tab

## 命名约定
- 类名：PascalCase
- 方法名：camelCase
- 常量：UPPER_SNAKE_CASE

## 注释风格
- 使用 JavaDoc 格式
- 方法注释包含 @param 和 @return
...
*/
```

### 智能 Prompt 增强

```typescript
// 原始 prompt
const userPrompt = "创建一个用户服务类";

// 增强后的 prompt（自动添加项目上下文）
const enhanced = await enhanced.generateEnhancedPrompt(
    workspaceUri,
    userPrompt,
    ['architecture', 'coding-style']
);

/*
【项目上下文】

## 架构设计
### 技术栈分析
- 项目类型: spring-boot
- 主要框架: Spring Boot
- 开发语言: java
...

## 编码规范
### 编码风格指南
- 使用依赖注入
- Service 层使用 @Service 注解
...

【用户需求】
创建一个用户服务类
*/
```

## 高级特性

### 1. 智能搜索

根据关键词智能匹配最相关的记忆：

```typescript
const memories = await enhanced.smartSearch(
    workspaceUri,
    ['authentication', 'jwt', 'security']
);

// 返回相关度最高的记忆条目
```

### 2. 记忆更新

随着项目演进，可以更新记忆：

```typescript
await memoryBankService.updateEntry(workspaceUri, memoryId, {
    content: '更新后的内容...',
    tags: ['tag1', 'tag2', 'new-tag']
});
```

### 3. 类别筛选

只获取特定类别的记忆：

```typescript
const architectureMemories = await memoryBankService.getEntriesByCategory(
    workspaceUri,
    'architecture'
);
```

### 4. 标签搜索

通过标签快速查找相关记忆：

```typescript
const apiMemories = await memoryBankService.searchByTags(
    workspaceUri,
    ['api', 'rest', 'controller']
);
```

## 最佳实践

### 1. 初始化时机

- 项目首次打开时自动初始化
- 克隆新项目后立即学习
- 项目结构变化后重新学习

### 2. 记忆维护

- 定期更新过时的记忆
- 删除不再相关的记忆
- 添加新发现的最佳实践

### 3. 上下文选择

根据任务选择相关的记忆类别：

- **代码生成**：architecture + coding-style + common-patterns
- **重构**：coding-style + best-practices
- **新功能**：architecture + common-patterns + dependencies

### 4. 记忆粒度

- 保持记忆条目简洁明了
- 一个条目聚焦一个主题
- 避免重复信息

## 性能考虑

- 记忆条目缓存在内存中
- 按需加载特定类别
- 摘要生成限制长度（500字符/条目）

## 安全性

- 记忆文件存储在项目本地
- 不包含敏感信息（密码、密钥等）
- 可以添加到 .gitignore（如果不想共享）

## 团队协作

### 共享记忆库

将 `.zhikai/memory-bank/` 提交到版本控制：

```bash
git add .zhikai/memory-bank/
git commit -m "Add project memory bank"
```

### 个人化记忆

使用 `custom` 类别存储个人记忆，并添加到 `.gitignore`。

## 故障排除

### 记忆库未初始化

```typescript
// 检查是否初始化
const entries = await memoryBankService.getAllEntries(workspaceUri);
if (entries.length === 0) {
    await memoryBankService.initialize(workspaceUri);
}
```

### AI 分析失败

- 检查 AI 服务配置
- 验证 API Key 是否有效
- 确保网络连接正常

### 记忆条目损坏

- 删除损坏的文件
- 重新运行学习命令

## 未来规划

- [ ] 支持增量学习（只学习变更部分）
- [ ] 记忆条目版本管理
- [ ] 跨项目记忆共享
- [ ] 记忆质量评分
- [ ] 自动清理过时记忆
- [ ] 可视化记忆关系图
- [ ] 支持更多项目类型

## 参考资料

- [KiloCode Memory Bank 设计](https://github.com/kodu-ai/kodu)
- [VSCode Service Architecture](https://code.visualstudio.com/api)
- [Dependency Injection in VSCode](https://code.visualstudio.com/api/advanced-topics/dependency-injection)
