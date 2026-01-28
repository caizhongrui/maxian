# Skills vs System Prompts：架构对比

## 核心区别

| 维度 | System Prompt | Skills |
|------|--------------|--------|
| **加载时机** | 每次请求都发送 | 按需加载（只在需要时） |
| **Token消耗** | 持续消耗 (~3000-5000) | 仅在使用时消耗 (~100-1500/个) |
| **内容定位** | 基础能力和规则 | 专业领域知识 |
| **更新频率** | 相对稳定 | 可频繁迭代 |
| **扩展性** | 有限（会膨胀） | 无限（独立管理） |
| **复用性** | 全局复用 | 场景复用 |

## 详细对比

### 1. System Prompt（系统提示词）

**定位：** AI的"操作系统"- 定义基础身份、能力和行为规范

**内容：**
- ✅ 角色定义："你是MaXian AI编程助手"
- ✅ 基础格式规范：Markdown使用规则
- ✅ 工具列表：可用工具的简要说明
- ✅ 核心规则：安全协议、禁止事项
- ✅ 系统信息：工作区、平台、环境
- ❌ 详细最佳实践（应移到Skills）
- ❌ 具体工作流程（应移到Skills）
- ❌ 专业领域知识（应移到Skills）

**当前问题：**
```typescript
// 当前系统提示词：~3000-5000 tokens
// 包含大量详细规则和最佳实践，每次请求都发送
const systemPrompt = SystemPromptGenerator.generate(...);
// 每次API调用消耗：3000-5000 tokens
```

**优化目标（Week 1）：**
```typescript
// 优化后系统提示词：~500-800 tokens
// 只保留基础能力，详细规则移到Skills
const systemPrompt = SystemPromptGenerator.generate(...);
// 每次API调用消耗：500-800 tokens
// Token节省：70-84%
```

### 2. Skills（技能）

**定位：** AI的"应用程序"- 按需加载的专业领域知识

**内容：**
- ✅ 详细最佳实践：代码审查检查清单
- ✅ 具体工作流程：Git工作流程详细步骤
- ✅ 专业领域知识：性能优化具体策略
- ✅ 模板和示例：测试代码模板
- ✅ 检查清单：安全审查清单
- ❌ 基础能力定义（应在System Prompt）
- ❌ 工具定义（应在System Prompt）

**使用方式：**
```typescript
// 系统提示词（500 tokens）：定义基础能力
systemPrompt: "你是MaXian，可以进行代码审查。详细规则请加载code-review Skill。"

// AI判断需要代码审查时，按需加载Skill（1500 tokens）
skill: {
  name: "code-review",
  content: `
    ## 代码审查检查清单

    ### 1. 代码质量（30分钟）
    - [ ] 命名是否清晰表意？
    - [ ] 是否有重复代码？
    - [ ] 函数是否过长？（建议<50行）
    ...

    ### 2. 安全检查（15分钟）
    - [ ] 是否存在SQL注入风险？
    - [ ] 敏感信息是否硬编码？
    ...
  `
}

// 只在这次请求消耗：500 + 1500 = 2000 tokens
// 下次不需要代码审查时，只消耗：500 tokens
```

## Token效率对比

### 场景1：简单问答（不需要专业知识）

**当前实现：**
```
系统提示词：3000 tokens（包含大量用不到的详细规则）
用户问题：50 tokens
总消耗：3050 tokens
```

**使用Skills后：**
```
系统提示词：500 tokens（精简到基础能力）
用户问题：50 tokens
Skills：0 tokens（不需要加载）
总消耗：550 tokens
节省：82%
```

### 场景2：代码审查（需要专业知识）

**当前实现：**
```
系统提示词：3000 tokens（已包含代码审查规则）
用户代码：1000 tokens
总消耗：4000 tokens
```

**使用Skills后：**
```
系统提示词：500 tokens
用户代码：1000 tokens
code-review Skill：1500 tokens（按需加载）
总消耗：3000 tokens
节省：25%
```

### 场景3：复杂任务（需要多个专业知识）

**当前实现：**
```
系统提示词：3000 tokens（包含有限的详细规则）
用户需求：500 tokens
问题：系统提示词无法包含所有专业知识，AI能力受限
总消耗：3500 tokens
```

**使用Skills后：**
```
系统提示词：500 tokens
用户需求：500 tokens
code-review Skill：1500 tokens
security Skill：800 tokens
performance Skill：1200 tokens
总消耗：4500 tokens
优势：虽然token增加，但获得3个领域的专业知识，能力提升300%
```

## 总体效果

### Token消耗统计（基于100次请求）

**当前实现：**
```
简单问答：60次 × 3050 = 183,000 tokens
代码审查：20次 × 4000 = 80,000 tokens
复杂任务：20次 × 3500 = 70,000 tokens
总计：333,000 tokens
```

**使用Skills后：**
```
简单问答：60次 × 550 = 33,000 tokens
代码审查：20次 × 3000 = 60,000 tokens
复杂任务：20次 × 4500 = 90,000 tokens
总计：183,000 tokens
节省：45%（150,000 tokens）
```

**成本节省：**
- 按GPT-4定价：$0.03/1K tokens（输入）
- 节省：150K tokens × $0.03/1K = **$4.5 per 100 requests**
- 年度节省（假设10万用户，每人100次/月）：
  - 10万 × 100 × 12 × $4.5 = **$540万/年**

## 设计原则

### System Prompt 设计原则

1. **最小化原则**
   - 只包含必需的基础能力
   - 详细规则移到Skills
   - 目标：<800 tokens

2. **稳定性原则**
   - 不频繁修改
   - 向后兼容
   - 版本控制

3. **通用性原则**
   - 适用所有场景
   - 不包含特定领域知识
   - 提供Skills加载机制

### Skills 设计原则

1. **专注性原则**
   - 每个Skill专注单一领域
   - 独立可用
   - 清晰的边界

2. **完整性原则**
   - 包含完整的领域知识
   - 提供具体步骤
   - 包含检查清单和模板

3. **可发现性原则**
   - 清晰的命名
   - 简洁的描述
   - 在系统提示词中列出

4. **可组合性原则**
   - 可以同时加载多个Skills
   - Skills之间不冲突
   - 支持递进式加载

## 实施计划

### Phase 1: Skills基础框架（Week 1, Day 2-3）

**Task #11: Skills基础框架**
```typescript
// 1. Skill文件格式
interface Skill {
  name: string;           // 技能名称
  slug: string;           // URL友好标识
  description: string;    // 简短描述（~50 chars）
  category: string;       // 分类
  content: string;        // 完整内容（Markdown）
  estimatedTokens: number; // 预估token数
  version: string;        // 版本号
}

// 2. Skills目录结构
.claude/skills/
├── code-review/
│   ├── SKILL.md        # Skill内容
│   ├── examples/       # 示例
│   └── templates/      # 模板
├── git-workflow/
├── debugging/
└── ...

// 3. Skills注册表
class SkillRegistry {
  scan(): void;          // 扫描skills目录
  register(skill): void; // 注册Skill
  get(slug): Skill;      // 获取Skill
  list(): Skill[];       // 列出所有Skills
}
```

### Phase 2: 精简系统提示词（Week 1, Day 4）

**将以下内容移到Skills：**

1. **toolUseGuidelines.ts** (300 tokens) → `tool-usage` Skill
2. **gitSafetyProtocol.ts** (150 tokens) → `git-workflow` Skill
3. **详细规则** (部分rules.ts, ~200 tokens) → 多个Skills
4. **复杂工作流** → 对应领域Skills

**保留在系统提示词：**
- 角色定义 (100 tokens)
- 基础格式 (100 tokens)
- 工具列表 (300 tokens)
- 核心规则 (200 tokens)
- 系统信息 (100 tokens)
- **总计：~800 tokens**

### Phase 3: 创建官方Skills（Week 1, Day 5）

**Task #14: 创建10个官方Skills**

1. `code-review` (1500 tokens) - 代码审查检查清单
2. `git-workflow` (600 tokens) - Git工作流程
3. `debugging` (800 tokens) - 系统化调试方法
4. `testing` (900 tokens) - 测试策略和TDD
5. `refactoring` (1000 tokens) - 重构模式
6. `security` (1200 tokens) - 安全编码规范
7. `performance` (1000 tokens) - 性能优化
8. `documentation` (700 tokens) - 文档编写
9. `architecture` (1300 tokens) - 架构设计
10. `api-design` (800 tokens) - API设计

### Phase 4: 集成测试（Week 1, Day 6-7）

**Task #15: Sprint 1集成测试**
- 验证token节省效果
- 测试Skills加载性能
- 用户体验测试
- 文档完善

## 最佳实践

### 何时使用System Prompt

```typescript
// ✅ 基础能力定义
"你是MaXian AI编程助手"

// ✅ 核心规则
"不要执行破坏性git操作"

// ✅ 工具列表
"你可以使用以下工具：read_file, write_file, ..."

// ❌ 详细最佳实践（应该在Skill中）
"代码审查时，按照以下15个步骤..."
```

### 何时创建Skill

```typescript
// ✅ 需要详细步骤
skill: "code-review" - 包含完整的审查清单

// ✅ 特定领域知识
skill: "performance" - 包含各种优化策略

// ✅ 复杂工作流
skill: "git-workflow" - 包含分支管理详细流程

// ❌ 简单规则（应该在System Prompt中）
"使用Markdown格式输出"
```

### Skill设计模板

```markdown
# Skill名称

## 概述
简短说明这个Skill的用途（1-2句话）

## 适用场景
- 场景1
- 场景2

## 详细指南

### 步骤1: ...
具体说明

### 步骤2: ...
具体说明

## 检查清单
- [ ] 检查项1
- [ ] 检查项2

## 示例

### 示例1
```代码示例```

### 示例2
```代码示例```

## 常见问题
Q: ...
A: ...

## 参考资料
- [链接1](url)
- [链接2](url)
```

## 总结

**Skills系统的核心价值：**
1. **Token效率：** 按需加载，平均节省45%
2. **无限扩展：** 可以持续添加新Skills，不增加基础开销
3. **专业能力：** 每个Skill可以包含1000+tokens的专业知识
4. **灵活组合：** 根据任务需要组合不同Skills
5. **易于维护：** 每个Skill独立管理，修改不影响其他部分

**System Prompt的核心价值：**
1. **稳定基础：** 定义AI的基本身份和能力
2. **快速启动：** 每次请求必需，保持最小化
3. **通用能力：** 适用所有场景的基础规则
4. **Skills入口：** 提供Skills发现和加载机制

**两者关系：**
```
System Prompt (操作系统)
    ↓
提供基础能力和运行环境
    ↓
Skills (应用程序)
    ↓
提供专业领域的详细知识
    ↓
组合使用，满足各种复杂需求
```

---

**相关文档：**
- [README.md](./README.md) - 系统提示词架构文档
- [MaXian全面优化计划.md](/private/tmp/claude/-Users-caizhongrui-Documents-workspace-boyo-plugin-ide-src-tianhe-zhikai-ide/4e838661-f005-44ce-b16d-3cd2ccf9bd63/scratchpad/MaXian全面优化计划.md)

**最后更新：** 2026-01-27
**状态：** 📝 设计文档 → Week 1实施
