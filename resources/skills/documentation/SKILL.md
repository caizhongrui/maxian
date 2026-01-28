---
name: Documentation
slug: documentation
description: 文档编写最佳实践和规范
category: documentation
estimatedTokens: 700
version: 1.0.0
author: Official
tags: [documentation, readme, jsdoc, api-docs]
official: true
createdAt: 2026-01-27
updatedAt: 2026-01-27
---

# Documentation Skill

## 概述

高质量文档编写规范,包括代码注释、README、API 文档等。

## 代码注释

### JSDoc/TSDoc

```typescript
/**
 * 计算两个数的和
 *
 * @param a - 第一个数字
 * @param b - 第二个数字
 * @returns 两数之和
 *
 * @example
 * ```ts
 * add(2, 3); // 5
 * ```
 */
function add(a: number, b: number): number {
  return a + b;
}

/**
 * 用户服务类
 *
 * @remarks
 * 负责用户相关的业务逻辑
 *
 * @example
 * ```ts
 * const service = new UserService();
 * const user = await service.create({ name: 'Alice' });
 * ```
 */
class UserService {
  /**
   * 创建新用户
   *
   * @param data - 用户数据
   * @returns 创建的用户对象
   * @throws {ValidationError} 如果数据无效
   *
   * @public
   */
  async create(data: CreateUserDto): Promise<User> {
    // ...
  }
}
```

### 何时添加注释

```typescript
// ✅ 好的注释 - 解释"为什么"
// 使用 setTimeout 而不是 setInterval
// 因为需要等待上一次执行完成后再开始下一次
setTimeout(function tick() {
  doWork();
  setTimeout(tick, 1000);
}, 1000);

// ❌ 不好的注释 - 重复代码内容
// 设置用户名为 Alice
user.name = 'Alice';

// ✅ 好的注释 - 解释复杂逻辑
// Fisher-Yates 洗牌算法 - O(n) 时间复杂度
for (let i = array.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [array[i], array[j]] = [array[j], array[i]];
}

// ✅ 好的注释 - 标记技术债
// TODO: 重构为异步处理以提升性能
// FIXME: 处理边界情况 - 当 array 为空时
// HACK: 临时方案,等待后端 API 修复后移除
```

### 注释原则

- **代码即文档** - 优先通过清晰的命名和结构表达意图
- **解释为什么** - 而不是解释做什么
- **保持同步** - 修改代码时同步更新注释
- **避免冗余** - 不要注释显而易见的内容

## README 文档

### 基本结构

```markdown
# 项目名称

简短的一句话描述项目

![CI Status](badge-url) ![Coverage](badge-url)

## 功能特性

- ✨ 特性 1
- 🚀 特性 2
- 🔒 特性 3

## 快速开始

### 安装

\```bash
npm install package-name
\```

### 基本使用

\```typescript
import { Feature } from 'package-name';

const instance = new Feature();
instance.doSomething();
\```

## API 文档

详细的 API 说明...

## 示例

更多示例代码...

## 配置

配置选项说明...

## 常见问题

Q: 问题1?
A: 答案1

## 贡献指南

欢迎贡献! 请查看 [CONTRIBUTING.md](CONTRIBUTING.md)

## 许可证

MIT © [作者名称](链接)
```

### 优秀 README 要素

- [ ] **清晰的标题和描述** - 一句话说明项目是什么
- [ ] **徽章** - CI、覆盖率、版本号
- [ ] **快速开始** - 5 分钟内能运行示例
- [ ] **视觉效果** - 截图、GIF、视频
- [ ] **API 文档** - 主要接口说明
- [ ] **示例代码** - 可复制粘贴的代码
- [ ] **贡献指南** - 如何参与贡献
- [ ] **许可证** - 明确说明

## API 文档

### RESTful API

```markdown
## 创建用户

创建新用户账户

**URL**: `/api/users`

**Method**: `POST`

**认证**: 需要

**请求体**:

\```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "password": "secretpassword"
}
\```

**成功响应**:

- **Code**: 201 Created
- **Content**:

\```json
{
  "id": 1,
  "name": "Alice",
  "email": "alice@example.com",
  "createdAt": "2024-01-01T00:00:00Z"
}
\```

**错误响应**:

- **Code**: 400 Bad Request
- **Content**:

\```json
{
  "error": "Validation failed",
  "details": ["Email already exists"]
}
\```

**示例**:

\```bash
curl -X POST https://api.example.com/users \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Alice","email":"alice@example.com","password":"secret"}'
\```
```

### 函数文档

```markdown
## `fetchUser(id)`

根据 ID 获取用户信息

### 参数

- `id` (number): 用户 ID

### 返回值

返回 `Promise<User>` - 用户对象

### 异常

- `NotFoundError` - 用户不存在
- `NetworkError` - 网络请求失败

### 示例

\```typescript
const user = await fetchUser(123);
console.log(user.name);
\```
```

## 变更日志（CHANGELOG）

遵循 [Keep a Changelog](https://keepachangelog.com/) 格式:

```markdown
# Changelog

## [Unreleased]

### Added
- 新增功能 X

### Changed
- 修改了功能 Y

### Deprecated
- 即将废弃的功能 Z

## [1.2.0] - 2024-01-15

### Added
- 新增用户认证功能
- 添加单元测试覆盖

### Fixed
- 修复登录页面样式问题 (#123)
- 修复内存泄漏 (#124)

## [1.1.0] - 2024-01-01

### Added
- 初始版本发布
```

## 文档类型

### 1. 面向用户

- **README** - 项目概览
- **教程（Tutorial）** - 一步步引导
- **操作指南（How-to）** - 解决特定问题
- **FAQ** - 常见问题

### 2. 面向开发者

- **API 参考** - 完整的 API 列表
- **架构文档** - 系统设计说明
- **贡献指南** - 如何参与开发
- **代码注释** - 内联文档

## 文档工具

### 自动生成

```bash
# TypeScript - TypeDoc
npm install --save-dev typedoc
typedoc src/

# JavaScript - JSDoc
npm install --save-dev jsdoc
jsdoc src/

# API 文档 - Swagger/OpenAPI
# 从代码注解生成
```

### 文档站点

- **VuePress** - Vue 驱动的静态站点
- **Docusaurus** - React 驱动的文档站点
- **GitBook** - 在线文档平台
- **Read the Docs** - 开源文档托管

## 文档维护

### 保持更新

- [ ] 代码变更时同步更新文档
- [ ] 定期审查文档准确性
- [ ] 收集用户反馈改进文档
- [ ] 使用版本控制管理文档

### 文档测试

```typescript
// 确保示例代码能运行
describe('README Examples', () => {
  test('basic usage example', () => {
    // 从 README 复制的代码
    const instance = new Feature();
    expect(instance.doSomething()).toBeDefined();
  });
});
```

## 最佳实践

- **用户视角** - 从用户角度写文档
- **简洁明了** - 避免冗长和术语
- **示例优先** - 提供可运行的示例
- **结构清晰** - 使用标题、列表、表格
- **搜索友好** - 使用关键词便于搜索
- **及时更新** - 代码变更同步文档

## 参考资料

- [Write the Docs](https://www.writethedocs.org/)
- [Google Developer Documentation Style Guide](https://developers.google.com/style)
- [Keep a Changelog](https://keepachangelog.com/)
