---
name: Code Review
slug: code-review
description: 代码审查检查清单和最佳实践
category: code-quality
estimatedTokens: 1500
version: 1.0.0
author: Official
tags: [review, quality, best-practices, checklist]
official: true
createdAt: 2026-01-27
updatedAt: 2026-01-27
---

# Code Review Skill

## 概述

本 Skill 提供全面的代码审查检查清单和最佳实践，帮助进行高质量的代码审查。

## 适用场景

- 审查 Pull Request
- 代码质量检查
- 重构前的代码评估
- 团队代码规范执行

## ⚠️ 重要：审查模式识别

**在开始审查前，先判断审查类型：**

### 类型 A：代码片段审查（用户直接提供代码）

**识别标志：**
- 用户消息中包含代码块
- 没有提到文件路径、PR链接、分支等
- 典型问法："审查这段代码"、"这段代码有什么问题"

**执行方式：**
1. ✅ **直接审查提供的代码**
2. ❌ **不要搜索文件**（这只是示例代码）
3. ❌ **不要询问** "这是不是独立模块？要不要完整实现？"
4. ✅ **基于代码本身指出问题和建议**

**流程：**
```
用户提供代码 → 直接分析代码 → 指出问题 → 给出建议 → 完成
```

### 类型 B：项目代码审查（PR审查、文件审查）

**识别标志：**
- 提到了PR号、分支名、文件路径
- 需要理解上下文和依赖关系

**执行方式：**
1. ✅ 可以搜索相关文件理解上下文
2. ✅ 可以查看依赖和关联代码
3. ✅ 需要确认变更范围

---

## 代码审查流程

### 阶段 1: 理解需求（5-10分钟）

**⚠️ 注意：如果是"类型A：代码片段审查"，跳过此阶段，直接进入阶段2**

**目标：** 确保理解代码要解决的问题（仅适用于"类型B：项目代码审查"）

- [ ] 阅读相关的 Issue 或任务描述
- [ ] 理解业务需求和技术背景
- [ ] 确认代码变更的范围和影响
- [ ] 检查是否有相关文档更新

### 阶段 2: 代码质量检查（20-30分钟）

#### 2.1 命名规范

- [ ] 变量名是否清晰表意？
- [ ] 函数名是否准确描述其功能？
- [ ] 类名是否符合单一职责原则？
- [ ] 常量是否使用 UPPER_CASE 命名？
- [ ] 布尔变量是否使用 is/has/should 等前缀？

#### 2.2 代码结构

- [ ] 函数是否过长？（建议 <50 行）
- [ ] 类是否过大？（建议 <300 行）
- [ ] 是否有重复代码？能否提取公共方法？
- [ ] 嵌套层级是否过深？（建议 <3 层）
- [ ] 是否遵循单一职责原则？

#### 2.3 可读性

- [ ] 代码逻辑是否清晰易懂？
- [ ] 是否有必要的注释？
- [ ] 注释是否准确、最新？
- [ ] 复杂逻辑是否有解释？
- [ ] 是否避免了"魔法数字"？

#### 2.4 错误处理

- [ ] 是否正确处理了所有可能的错误？
- [ ] 错误信息是否清晰有用？
- [ ] 是否使用了适当的异常类型？
- [ ] 资源是否正确释放？（文件、连接等）
- [ ] 是否有合适的日志记录？

### 阶段 3: 安全检查（10-15分钟）

- [ ] 是否存在 SQL 注入风险？
- [ ] 用户输入是否经过验证和清理？
- [ ] 敏感信息是否硬编码？（密码、密钥）
- [ ] 是否存在 XSS 攻击风险？
- [ ] 文件上传是否有安全检查？
- [ ] 是否使用了安全的加密算法？
- [ ] 会话管理是否安全？

### 阶段 4: 性能检查（10-15分钟）

- [ ] 是否有 N+1 查询问题？
- [ ] 循环中是否有重复计算？
- [ ] 是否合理使用了缓存？
- [ ] 大数据集是否分页处理？
- [ ] 是否有不必要的网络请求？
- [ ] 数据库查询是否优化？
- [ ] 是否有内存泄漏风险？

### 阶段 5: 测试检查（15-20分钟）

- [ ] 是否添加了单元测试？
- [ ] 测试覆盖率是否足够？（建议 >80%）
- [ ] 是否测试了边界条件？
- [ ] 是否测试了错误情况？
- [ ] 测试是否可维护？
- [ ] 是否有集成测试？
- [ ] 测试命名是否清晰？

### 阶段 6: 文档检查（5-10分钟）

- [ ] 是否更新了 README？
- [ ] 是否更新了 API 文档？
- [ ] 是否添加了变更日志？
- [ ] 复杂功能是否有设计文档？
- [ ] 公共 API 是否有充分的注释？

## 代码质量评分标准

### 优秀（90-100分）
- 代码清晰易懂
- 遵循所有最佳实践
- 完善的测试覆盖
- 充分的文档说明
- 无安全和性能问题

### 良好（70-89分）
- 代码整体质量好
- 遵循大部分最佳实践
- 有基本的测试
- 有必要的注释
- 少量可改进的地方

### 需改进（50-69分）
- 功能正确但代码质量一般
- 存在明显的代码异味
- 测试覆盖不足
- 缺少关键注释
- 需要重构部分代码

### 不合格（<50分）
- 存在严重的设计问题
- 违反基本编码规范
- 缺少测试
- 存在安全或性能隐患
- 需要大幅重构

## 常见代码异味（Code Smells）

### 🚨 严重问题

1. **硬编码的敏感信息**
   ```typescript
   // ❌ 不好
   const apiKey = "sk-1234567890abcdef";

   // ✅ 好
   const apiKey = process.env.API_KEY;
   ```

2. **未处理的错误**
   ```typescript
   // ❌ 不好
   const data = JSON.parse(response);

   // ✅ 好
   try {
     const data = JSON.parse(response);
   } catch (error) {
     logger.error('Failed to parse response', error);
     throw new ParseError('Invalid JSON response');
   }
   ```

3. **SQL 注入风险**
   ```typescript
   // ❌ 不好
   const query = `SELECT * FROM users WHERE id = ${userId}`;

   // ✅ 好
   const query = 'SELECT * FROM users WHERE id = ?';
   db.query(query, [userId]);
   ```

### ⚠️ 需改进

4. **过长的函数**
   - 超过 50 行的函数应考虑拆分
   - 每个函数应只做一件事

5. **深度嵌套**
   ```typescript
   // ❌ 不好
   if (user) {
     if (user.isActive) {
       if (user.hasPermission) {
         // ...
       }
     }
   }

   // ✅ 好 - 早返回
   if (!user) return;
   if (!user.isActive) return;
   if (!user.hasPermission) return;
   // ...
   ```

6. **重复代码**
   - 出现 3 次以上的相似代码应提取为函数
   - 使用 DRY（Don't Repeat Yourself）原则

## 审查意见模板

### 必须修改（Blocker）

```markdown
🚨 **[Blocker]** 存在安全风险

**问题：** 在 line 42 处，用户输入未经验证直接用于 SQL 查询

**风险：** SQL 注入攻击

**建议：** 使用参数化查询或 ORM

**参考：** [OWASP SQL Injection](https://owasp.org/www-community/attacks/SQL_Injection)
```

### 建议改进（Major）

```markdown
⚠️ **[Major]** 代码可读性问题

**问题：** `processData()` 函数过长（120行），职责不清

**影响：** 难以理解和维护

**建议：** 拆分为多个小函数，每个函数专注一个任务

**示例：**
- `validateData()` - 数据验证
- `transformData()` - 数据转换
- `saveData()` - 数据保存
```

### 小问题（Minor）

```markdown
💡 **[Minor]** 命名建议

**问题：** 变量名 `temp` 不够描述性

**建议：** 改为 `parsedUserData` 更清晰
```

### 表扬（Praise）

```markdown
✨ **[Praise]** 优秀的错误处理

这里的错误处理非常完善，包含了详细的日志和用户友好的错误信息。很好的实践！
```

## 自动化检查工具推荐

### 代码质量
- **ESLint** - JavaScript/TypeScript 代码检查
- **SonarQube** - 多语言代码质量分析
- **CodeClimate** - 代码质量和技术债务

### 安全检查
- **Snyk** - 依赖安全扫描
- **npm audit** - npm 包安全检查
- **OWASP Dependency-Check** - 依赖漏洞检查

### 测试覆盖率
- **Istanbul/nyc** - JavaScript 覆盖率
- **Coverage.py** - Python 覆盖率
- **JaCoCo** - Java 覆盖率

## 参考资料

- [Google Style Guides](https://google.github.io/styleguide/)
- [Clean Code by Robert C. Martin](https://www.amazon.com/Clean-Code-Handbook-Software-Craftsmanship/dp/0132350882)
- [Code Review Best Practices](https://google.github.io/eng-practices/review/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

## 使用提示

1. **不要一次审查太多代码**
   - 建议每次审查 <400 行代码
   - 分批审查效果更好

2. **保持建设性**
   - 提出问题时说明原因
   - 提供具体的改进建议
   - 认可好的代码实践

3. **优先级排序**
   - 先解决安全和功能问题
   - 再改进代码质量
   - 最后处理风格问题

4. **持续改进**
   - 记录常见问题
   - 更新团队规范
   - 分享最佳实践
