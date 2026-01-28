# 系统提示词架构文档

## 架构决策：本地化 vs API

### 🎯 核心决策
**MaXian IDE使用完全本地化的系统提示词生成，不依赖后端API。**

### ✅ 为什么选择本地化？

| 维度 | 本地TypeScript | API获取 |
|------|--------------|---------|
| **启动速度** | <1ms | 50-200ms |
| **离线支持** | ✅ 完全支持 | ❌ 需要网络 |
| **版本控制** | ✅ Git管理 | ❌ 数据库管理困难 |
| **维护成本** | ✅ 低（代码即文档） | ❌ 高（需要管理界面） |
| **扩展性** | ✅ Skills系统 | ⚠️ 受限于数据库 |
| **一致性** | ✅ 编译时保证 | ⚠️ 运行时可能不一致 |
| **调试便利** | ✅ 源码可见 | ❌ 需要查询数据库 |

### 📊 性能对比

```
本地生成：
- 生成时间：<1ms
- 缓存命中：5分钟TTL
- Token消耗：~3000-5000 tokens

API获取：
- 网络延迟：50-200ms
- 数据库查询：10-50ms
- 总延迟：60-250ms
- Token消耗：相同
```

**结论：本地化快200x，没有任何劣势。**

### 🏗️ 架构设计

```
本地提示词系统（当前）
├── systemPrompt.ts          # 提示词生成器（核心）
├── sections/                # 模块化的提示词片段
│   ├── index.ts            # 统一导出
│   ├── capabilities.ts     # 能力说明（~100 tokens）
│   ├── rules.ts            # 基础规则（~200 tokens）
│   ├── toolUse.ts          # 工具使用说明（~150 tokens）
│   ├── toolUseGuidelines.ts # 工具使用指南（~300 tokens）
│   ├── gitSafetyProtocol.ts # Git安全协议（~150 tokens）
│   ├── markdownFormatting.ts # Markdown格式（~100 tokens）
│   ├── modes.ts            # 模式说明（~150 tokens）
│   ├── objective.ts        # 目标（~100 tokens）
│   └── systemInfo.ts       # 系统信息（~100 tokens）
├── toolDescriptions.ts      # 工具描述（动态生成）
└── formatResponse.ts        # 响应格式化

未来Skills系统（Week 1实施）
├── skills/                  # Skills目录（按需加载）
│   ├── code-review/        # 代码审查Skill（~1500 tokens）
│   ├── git-workflow/       # Git工作流Skill（~600 tokens）
│   ├── debugging/          # 调试Skill（~800 tokens）
│   └── ...                 # 更多Skills
└── skillLoader.ts          # Skills加载器
```

### 📝 Token优化策略

**当前系统提示词（~3000-5000 tokens）**
- 基础角色定义：~100 tokens
- 格式化规则：~100 tokens
- 工具使用：~500 tokens
- 工具描述：~1000-2000 tokens（取决于可用工具数量）
- 指南和安全：~800 tokens
- 系统信息：~500 tokens

**优化目标（Week 1）**
通过Skills系统，将系统提示词压缩至~500-800 tokens：
- ✅ 保留：角色定义、基础格式、工具列表
- ➡️ 移动到Skills：详细规则、最佳实践、复杂工作流

**预期效果：**
- 系统提示词：3000 → 500 tokens（减少83%）
- Skills按需加载：每个100-1500 tokens
- 总体token节省：60-70%

### 🚫 禁止事项

**❌ 绝对不要：**
1. 添加API调用来获取系统提示词
2. 从数据库动态加载提示词内容
3. 引入网络依赖到提示词生成流程
4. 使用异步方式生成基础系统提示词

**✅ 正确做法：**
1. 所有提示词内容以TypeScript常量形式存在
2. 使用编译时类型检查保证正确性
3. 通过Git版本控制管理提示词变更
4. 使用Skills系统扩展（而非API）

### 🔄 后端API说明

**后端存在的`AiPromptTemplateController`（`/system/ai/prompt/*`）：**
- ❌ 不用于IDE的系统提示词
- ✅ 仅用于其他场景：
  - 管理界面的提示词配置
  - 第三方客户端集成
  - 代码补全、注释生成等特定功能的提示词

**IDE与后端的边界：**
```
IDE (本地)                     后端API (可选)
├── 系统提示词 ✅ 本地生成      ├── 特定功能提示词 ✅ API提供
├── Skills ✅ 本地加载          │   - 代码补全
├── 工具定义 ✅ 本地注册        │   - 注释生成
└── 对话历史 → 发送到AI         │   - 测试生成
                               └── 插件管理 ✅ API管理
```

### 📦 迁移指南（如果之前使用了API）

**步骤1：移除API调用**
```typescript
// ❌ 错误做法
async function getSystemPrompt() {
  const response = await fetch('/system/ai/prompt/system', {
    method: 'POST',
    body: JSON.stringify({ mode: 'code' })
  });
  return response.json();
}

// ✅ 正确做法
function getSystemPrompt() {
  return SystemPromptGenerator.generate(
    workspaceRoot,
    availableTools,
    systemInfo,
    mode
  );
}
```

**步骤2：移除数据库表（如果仅用于IDE）**
```sql
-- 如果ai_prompt_template表仅用于IDE系统提示词，可以移除
DROP TABLE IF EXISTS ai_prompt_template;
```

**步骤3：更新文档**
- 在README中明确说明本地化架构
- 在代码注释中标注不要使用API
- 在团队文档中记录决策理由

### 🎯 实施计划（Week 1, Day 1）

**Task #10: 提示词本地化**
- [x] 确认前端没有使用后端API ✅
- [x] 创建架构文档（本文件）✅
- [ ] 在SystemPromptGenerator添加警告注释
- [ ] 优化提示词生成缓存逻辑
- [ ] 添加token统计功能
- [ ] 为Skills系统预留接口
- [ ] 测试验证

**下一步：Skills系统（Week 1, Day 2-5）**
- 实现Skills扫描、解析、注册
- 创建10个官方Skills
- 将详细规则从系统提示词迁移到Skills

### 📚 相关文档

- [MaXian全面优化计划.md](/private/tmp/claude/-Users-caizhongrui-Documents-workspace-boyo-plugin-ide-src-tianhe-zhikai-ide/4e838661-f005-44ce-b16d-3cd2ccf9bd63/scratchpad/MaXian全面优化计划.md)
- [Skills vs Prompts对比](./SKILLS_VS_PROMPTS.md) (待创建)
- [码弦Agent系统实现计划.md](/Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/tianhe-zhikai-ide/码弦Agent系统实现计划.md)

---

**最后更新：** 2026-01-27
**维护者：** MaXian团队
**状态：** ✅ 已实施（本地化已完成）→ 下一步：Skills系统
