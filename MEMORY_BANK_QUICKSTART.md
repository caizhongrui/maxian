# Memory Bank 快速开始指南

## 5分钟快速上手

### 步骤1：初始化 Memory Bank（30秒）

打开命令面板（`Cmd/Ctrl + Shift + P`），输入：

```
Memory Bank: 初始化项目记忆库
```

这将在你的项目中创建 `.zhikai/memory-bank/` 目录结构。

### 步骤2：学习项目（2分钟）

继续在命令面板中执行：

```
Memory Bank: 学习项目结构
```

然后执行：

```
Memory Bank: 学习编码规范
```

系统会自动分析你的项目，提取项目结构、技术栈、编码规范等信息。

### 步骤3：查看学习结果（1分钟）

执行命令：

```
Memory Bank: 查看所有记忆
```

你会看到系统自动生成的记忆条目列表。

### 步骤4：生成上下文摘要（1分钟）

执行命令：

```
Memory Bank: 生成项目上下文摘要
```

查看控制台输出，你会看到完整的项目上下文摘要，这些内容会在 AI 代码生成时自动使用。

### 步骤5：在代码中使用（30秒）

现在，当你使用 AI 生成代码时，系统会自动引用这些记忆，生成符合项目规范的代码！

## 核心概念

### 什么是 Memory Bank？

Memory Bank 是一个智能的项目学习系统，它可以：

1. **自动学习**：分析项目代码，提取结构、规范、模式
2. **记忆存储**：将学习结果存储为结构化的记忆条目
3. **AI 增强**：在 AI 代码生成时自动引用这些记忆，确保生成的代码符合项目规范

### 记忆类别

- **架构设计** (`architecture`)：项目架构、技术栈、设计模式
- **编码规范** (`coding-style`)：代码风格、命名规范、注释规范
- **项目结构** (`project-structure`)：目录结构、文件组织
- **依赖关系** (`dependencies`)：项目依赖、版本管理
- **最佳实践** (`best-practices`)：开发规范、代码质量
- **常用模式** (`common-patterns`)：设计模式、API 模式
- **自定义** (`custom`)：你自己添加的记忆

## 常用场景

### 场景1：新项目接入

```bash
# 1. 初始化
Memory Bank: 初始化项目记忆库

# 2. 一键学习（如果你有增强版）
# 或者手动学习
Memory Bank: 学习项目结构
Memory Bank: 学习编码规范

# 3. 验证
Memory Bank: 查看所有记忆
```

### 场景2：添加自定义规范

```bash
# 打开命令面板
Memory Bank: 添加自定义记忆

# 按提示输入
标题: API 响应格式规范
内容: 统一使用 { code: 200, message: 'success', data: {...} }
类别: 最佳实践
标签: api, response, standard
```

### 场景3：AI 代码生成

Memory Bank 会自动工作！当你使用 AI 生成代码时：

```typescript
// 在你的 AI 服务中
const integration = new MemoryBankAIIntegration(memoryBankService, aiService);

// 生成代码时会自动引用项目记忆
const code = await integration.generateContextAwareCode(
    workspaceUri,
    '创建一个用户管理 Controller',
    'controller'
);

// 生成的代码会自动遵循项目规范！
```

## 代码集成示例

### 基础使用

```typescript
import { IMemoryBankService } from 'vs/workbench/services/memoryBank/common/memoryBank';

// 通过依赖注入获取服务
constructor(
    @IMemoryBankService private readonly memoryBankService: IMemoryBankService
) {}

// 使用
async initializeProject(workspaceUri: URI) {
    // 初始化
    await this.memoryBankService.initialize(workspaceUri);

    // 学习项目
    await this.memoryBankService.learnProjectStructure(workspaceUri);

    // 获取记忆
    const memories = await this.memoryBankService.getAllEntries(workspaceUri);
    console.log(`学到 ${memories.length} 条记忆`);
}
```

### 高级使用

```typescript
import { MemoryBankEnhancedFeatures } from 'vs/workbench/services/memoryBank/browser/memoryBankEnhanced';
import { MemoryBankAIIntegration } from 'vs/workbench/contrib/memoryBank/browser/memoryBankIntegration';

// 创建增强功能
const enhanced = new MemoryBankEnhancedFeatures(
    memoryBankService,
    fileService,
    projectAnalyzer,
    aiService
);

// 一键学习整个项目
await enhanced.autoLearnProject(workspaceUri);

// 创建 AI 集成
const integration = new MemoryBankAIIntegration(memoryBankService, aiService);

// 生成上下文感知的代码
const code = await integration.generateContextAwareCode(
    workspaceUri,
    '创建订单服务，包含创建、查询、更新、取消功能',
    'service'
);
```

## 文件结构

初始化后，你的项目会有以下结构：

```
your-project/
├── .zhikai/
│   └── memory-bank/
│       ├── architecture/          # 架构设计记忆
│       │   └── tech-stack.md
│       ├── coding-style/          # 编码规范记忆
│       │   └── style-guide.md
│       ├── project-structure/     # 项目结构记忆
│       │   └── structure.md
│       ├── dependencies/          # 依赖关系记忆
│       │   └── deps-analysis.md
│       ├── best-practices/        # 最佳实践记忆
│       │   └── practices.md
│       ├── common-patterns/       # 常用模式记忆
│       │   └── patterns.md
│       ├── custom/                # 自定义记忆
│       │   └── your-memories.md
│       └── README.md              # 说明文档
└── ... (你的项目文件)
```

## 记忆文件示例

每个记忆文件都是 Markdown 格式：

```markdown
---
id: abc123
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
Spring Boot 3.x

## 目录结构
- 源码: src/main/java
- 资源: src/main/resources
- 测试: src/test/java

## 主要模块
- controller: REST API 控制器
- service: 业务逻辑层
- repository: 数据访问层
- model: 数据模型
```

## 最佳实践

### 1. 定期更新

项目结构变化后，重新运行学习命令：

```bash
Memory Bank: 学习项目结构
```

### 2. 添加团队规范

将团队的开发规范添加到 Memory Bank：

```bash
Memory Bank: 添加自定义记忆
```

### 3. 版本控制

将 `.zhikai/memory-bank/` 提交到 Git，让团队共享记忆：

```bash
git add .zhikai/memory-bank/
git commit -m "Add project memory bank"
git push
```

### 4. 个人记忆

如果有个人的记忆不想共享，添加到 `.gitignore`：

```
.zhikai/memory-bank/custom/
```

## 常见问题

### Q1: Memory Bank 存储在哪里？

A: 存储在项目的 `.zhikai/memory-bank/` 目录下。

### Q2: 会影响项目性能吗？

A: 不会。Memory Bank 只在你主动调用时工作，不会影响日常开发。

### Q3: 可以手动编辑记忆文件吗？

A: 可以！记忆文件是普通的 Markdown 文件，你可以直接编辑。

### Q4: 如何删除记忆？

A: 可以直接删除对应的 `.md` 文件，或者使用 API：

```typescript
await memoryBankService.deleteEntry(workspaceUri, memoryId);
```

### Q5: AI 一定会使用这些记忆吗？

A: 是的，当你使用 `MemoryBankAIIntegration` 生成代码时，系统会自动将相关记忆添加到 AI prompt 中。

## 下一步

### 了解更多

- 📖 [完整用户指南](./MEMORY_BANK_GUIDE.md)
- 🏗️ [实现文档](./MEMORY_BANK_IMPLEMENTATION.md)
- 💻 [代码示例](./src/vs/workbench/contrib/memoryBank/browser/memoryBankExample.ts)

### 核心文件

- 服务实现：`src/vs/workbench/services/memoryBank/browser/memoryBankService.ts`
- 增强功能：`src/vs/workbench/services/memoryBank/browser/memoryBankEnhanced.ts`
- AI 集成：`src/vs/workbench/contrib/memoryBank/browser/memoryBankIntegration.ts`
- 命令注册：`src/vs/workbench/contrib/memoryBank/browser/memoryBankActions.ts`

## 立即开始

打开你的项目，按 `Cmd/Ctrl + Shift + P`，输入：

```
Memory Bank: 初始化项目记忆库
```

开始你的智能项目学习之旅！🚀

## 获取帮助

如果遇到问题：

1. 查看[完整文档](./MEMORY_BANK_GUIDE.md)
2. 查看[实现细节](./MEMORY_BANK_IMPLEMENTATION.md)
3. 查看[代码示例](./src/vs/workbench/contrib/memoryBank/browser/memoryBankExample.ts)
4. 检查控制台输出的错误信息

## 反馈和贡献

欢迎提供反馈和改进建议！
