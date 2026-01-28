# Skills 系统模式要求

## ⚠️ 重要：Skills 只在 Code 模式下可用

### 问题现象

在 Ask 模式下输入：
```
使用 code-review skill 来审查代码
```

**结果**：AI直接响应，不会调用skill工具（Console中看不到 `[SkillTool]` 日志）

### 根本原因

**Ask 模式使用 Dify 知识库接口，不支持工具调用**

从日志可以看出：
```
[Maxian] 模式: ask
[Maxian] 使用 Dify 知识库接口发送消息
difyHandler.ts:125 [Maxian] Dify 请求: /ai/chat/chat-messages
```

Dify的知识库聊天接口：
- ❌ 不会发送tools数组
- ❌ 不会处理tool_use响应
- ❌ 无法调用任何工具（包括skill工具）
- ✅ 只能做简单的问答

### 正确使用方法

#### 1. 切换到 Code 模式

**位置**：输入框左侧的下拉选择器

**操作**：
1. 点击模式选择器（显示"Ask"或当前模式）
2. 从下拉列表中选择 **"Code"**
3. 确认界面显示已切换

#### 2. 重新发送消息

```
使用 code-review skill 来审查这段代码：

function add(a, b) {
    return a + b
}
```

#### 3. 验证工具调用

**Console中应该看到**：
```
[Maxian] 模式: code
[Maxian] 生成系统提示词...
[Maxian] 可用工具: [..., skill]
[SkillTool] Loading skill: code-review
[SkillTool] Skill loaded successfully, content length: 1500
```

**AI响应应该**：
- 根据code-review Skill的专业指导进行审查
- 提供详细的代码质量分析
- 给出改进建议

## 模式对比

### Ask 模式

**特点**：
- 简单快速问答
- 使用Dify知识库
- 低Token消耗
- **不支持工具调用**

**适用场景**：
- "这个函数是做什么的？"
- "什么是闭包？"
- "如何使用Array.map？"

**限制**：
- 无法读写文件
- 无法搜索代码
- 无法执行命令
- **无法使用Skills**

### Code 模式

**特点**：
- 完整的代码助手
- 使用AI代理API（支持工具调用）
- 中等Token消耗
- **支持所有工具（包括Skills）**

**适用场景**：
- "用 code-review skill 审查代码"
- "搜索所有TODO注释"
- "重构这个函数"
- "创建新文件"

**能力**：
- ✅ 读写文件（read_file, write_file）
- ✅ 搜索代码（search_files, ripgrep_search）
- ✅ 执行命令（execute_command）
- ✅ 使用Skills（skill工具）
- ✅ 浏览器自动化（browser工具）

## 技术细节

### Ask 模式实现

```typescript
// maxianService.ts
if (mode === 'ask') {
  // 使用DifyHandler
  handler = new DifyHandler(config);

  // 发送到 Dify 知识库接口
  handler.sendMessage({
    query: userMessage,
    inputs: {},
    response_mode: 'streaming'
    // ❌ 没有 tools 参数
  });
}
```

### Code 模式实现

```typescript
// maxianService.ts
if (mode === 'code') {
  // 使用AiProxyHandler
  handler = new AiProxyHandler(config);

  // 生成系统提示词（包含Skills目录）
  const systemPrompt = SystemPromptGenerator.generate(
    workspaceRoot,
    availableTools, // ✅ 包括 'skill'
    systemInfo,
    currentMode,
    {
      reserveForSkills: true // ✅ 包含Skills目录
    },
    skillService
  );

  // 发送到AI代理API
  handler.sendMessage({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    tools: getToolDefinitions(), // ✅ 包括skill工具定义
    tool_choice: 'auto'
  });
}
```

## 快速检查清单

使用Skills前，确认：

- [ ] ✅ 已切换到 **Code 模式**（不是Ask模式）
- [ ] ✅ 输入框左侧显示 "Code"
- [ ] ✅ IDE已重新加载（Developer: Reload Window）
- [ ] ✅ Skills已初始化（主进程日志显示"扫描完成，成功注册 10 个 Skill"）
- [ ] ✅ Console中看到 `[SkillTool]` 日志

## 故障排查

### 问题：切换到Code模式后仍然没有调用skill工具

**可能原因**：

1. **AI选择不使用工具**
   - 消息描述不够明确
   - 尝试更直接的指令："使用 skill 工具加载 code-review"

2. **工具定义未正确生成**
   - 检查系统提示词是否包含skill工具描述
   - 查看Console日志确认工具列表

3. **SkillService未初始化**
   - 检查主进程日志（Output面板 → "Log (Main)"）
   - 应该看到："扫描完成，成功注册 10 个 Skill"

### 问题：找不到模式选择器

**位置**：
- 在输入框的**左侧**
- 与知识库选择器并列
- 通常显示当前模式名称（"Ask"、"Code"等）

**如果界面异常**：
1. 重新加载窗口（Developer: Reload Window）
2. 检查Console是否有UI错误
3. 尝试重启IDE

## 测试示例

### ✅ 正确使用（Code模式）

```
模式: Code

输入: 使用 code-review skill 来审查这段代码：
function add(a, b) {
    return a + b
}

Console输出:
[SkillTool] Loading skill: code-review
[SkillTool] Skill loaded successfully

AI响应:
根据code-review最佳实践，这段代码有以下问题：
1. 缺少类型注解
2. 缺少JSDoc注释
3. 没有参数验证
...
```

### ❌ 错误使用（Ask模式）

```
模式: Ask

输入: 使用 code-review skill 来审查这段代码：
function add(a, b) {
    return a + b
}

Console输出:
（没有 [SkillTool] 日志）

AI响应:
这是一个简单的加法函数...
（通用回答，没有使用skill）
```

## 总结

**记住这一点**：
> Skills 系统 = Code 模式专属功能
>
> Ask 模式 → 简单问答，无工具
> Code 模式 → 完整助手，有工具（包括Skills）

**使用Skills的正确流程**：
1. ✅ 切换到 Code 模式
2. ✅ 明确指定要使用的skill
3. ✅ 检查Console确认工具被调用
4. ✅ 获得专业的AI响应

---

**最后更新**: 2026-01-27 20:26
**状态**: Skills系统完全正常，需要在Code模式下使用
