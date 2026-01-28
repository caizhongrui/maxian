# 码弦 IDE - 内置 Skills 说明

## 📚 Skills 目录结构

本目录包含随 IDE 打包分发的官方 Skills。每个 Skill 都是一个独立的目录，包含：

```
resources/skills/
├── spring-security/        # Spring Security 集成指南
│   └── SKILL.md           # Skill 定义文件（必需）
├── mybatis-plus/          # MyBatis-Plus ORM 框架
│   └── SKILL.md
├── redis-integration/     # Redis 缓存和分布式锁
│   └── SKILL.md
├── vue3-composition-api/  # Vue 3 组合式 API
│   └── SKILL.md
├── pinia-state-management/# Pinia 状态管理
│   └── SKILL.md
├── element-plus/          # Element Plus UI 组件
│   └── SKILL.md
└── ...                    # 更多官方 Skills
```

## 🔧 Skills 加载机制

IDE 使用以下优先级加载 Skills：

1. **用户自定义目录** - `~/.claude/skills/`
   - 如果用户创建了此目录并添加了 Skills，将优先使用
   - 用户可以覆盖或扩展内置 Skills
   - 支持个性化定制

2. **IDE 内置目录** - `{IDE安装目录}/resources/skills/`
   - 随 IDE 打包分发的官方 Skills
   - 无需额外安装，开箱即用
   - 随 IDE 版本更新自动升级

3. **开发环境** - `{项目根目录}/resources/skills/`
   - 仅用于开发和调试

## 📝 Skill 文件格式

每个 Skill 必须包含一个 `SKILL.md` 文件（**文件名必须全大写**），格式如下：

```markdown
---
name: Spring Security
slug: spring-security
description: Spring Security安全框架，实现认证、授权、JWT等功能
version: 1.0.0
category: development
author: System
tags: [spring, security, jwt, authentication]
estimatedTokens: 2000
official: true
---

# Spring Security Integration Guide

## 核心概念

### 1. 基础配置
...

## 最佳实践
...
```

## 🎯 官方内置 Skills 列表

### Java 后端开发
- **spring-security** - Spring Security 安全框架（JWT、OAuth2、认证授权）
- **mybatis-plus** - MyBatis-Plus ORM 框架（CRUD、分页、条件构造）
- **redis-integration** - Redis 集成（缓存、分布式锁、Session）
- **spring-boot** - Spring Boot 核心功能
- **jpa-hibernate** - JPA/Hibernate ORM

### Vue 前端开发
- **vue3-composition-api** - Vue 3 组合式 API（setup、响应式、生命周期）
- **pinia-state-management** - Pinia 状态管理（Store、Actions、Getters）
- **element-plus** - Element Plus UI 组件库（表单、表格、对话框）

### 通用开发
- **git-workflow** - Git 工作流和最佳实践
- **code-review** - 代码审查规范
- **debugging** - 系统化调试方法
- **testing** - 测试驱动开发
- **refactoring** - 代码重构技巧
- **documentation** - 文档编写规范
- **performance** - 性能优化指南
- **security** - 安全编程实践
- **api-design** - API 设计规范
- **architecture** - 软件架构设计

## 🚀 为用户提供自定义 Skills

用户可以在自己的主目录创建 Skills：

```bash
# 1. 创建 Skills 目录
mkdir -p ~/.claude/skills/my-custom-skill

# 2. 创建 SKILL.md 文件
cat > ~/.claude/skills/my-custom-skill/SKILL.md << 'EOF'
---
name: My Custom Skill
slug: my-custom-skill
description: 我的自定义技能
version: 1.0.0
category: custom
author: Your Name
tags: [custom]
estimatedTokens: 500
---

# My Custom Skill

这是我的自定义 Skill 内容...
EOF

# 3. 重启 IDE，新 Skill 将自动加载
```

## 🔄 更新 Skills

- **内置 Skills** 随 IDE 版本更新自动升级
- **用户 Skills** 需要手动维护，可以使用 Git 进行版本管理：
  ```bash
  cd ~/.claude/skills
  git init
  git add .
  git commit -m "Initial skills"
  ```

## 📦 打包配置

在 IDE 构建过程中，`resources/skills/` 目录会被自动打包进应用。

确保构建配置包含此目录：
- Electron Builder: 在 `extraResources` 中包含
- VS Code 打包: 在资源文件列表中包含

## 🛠 开发者指南

### 添加新的官方 Skill

1. 在 `resources/skills/` 创建新目录
2. 添加 `SKILL.md` 文件（参考现有 Skills 格式）
3. 设置 `official: true` 标记为官方 Skill
4. 提交代码并更新文档

### 测试 Skills

```bash
# 运行 IDE 开发版本
npm run watch

# Skills 会从 resources/skills/ 加载
# 修改后重启 IDE 查看效果
```

## 📄 许可证

所有内置 Skills 遵循 IDE 的许可证协议。

---

**码弦 IDE** - 让 AI 开发更智能
