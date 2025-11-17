# 🔍 AI 代码补全调试指南

## 📍 日志查看位置

### 方法 1：浏览器开发者工具（推荐）

1. **打开 IDE**
   ```bash
   cd /Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/tianhe-zhikai-ide
   ./scripts/code.sh .
   ```

2. **打开开发者工具**
   - 菜单：`Help → Toggle Developer Tools`
   - 或快捷键：`Cmd+Option+I` (Mac) / `Ctrl+Shift+I` (Windows/Linux)

3. **查看 Console 标签**
   - 查找关键日志：
     - `[AI Service]` - AI 服务层日志
     - `[AI Inline Completions]` - 内联补全日志
     - `[AI Completion]` - 旧的补全系统日志

4. **查看 Network 标签**
   - 筛选：`dashscope`
   - 查看请求详情：
     - Request Headers
     - Request Payload
     - Response

---

## 🐛 当前问题诊断

您的 curl 请求显示 prompt 是空的：
```json
{
  "content": "Complete this code:\n"
}
```

这说明可能有**两个不同的 AI 补全系统**在运行：

### 系统 1：旧的 aiCompletion（可能是问题源）
- 位置：`src/vs/workbench/contrib/aiCompletion/`
- 快捷键：Alt+K
- 可能发送简单的 prompt

### 系统 2：新的 aiInlineCompletions（我们刚修复的）
- 位置：`src/vs/workbench/contrib/aiInlineCompletions/`
- 触发：自动或 Ctrl+Space
- 发送详细的上下文 prompt

---

## 🔧 解决方案：禁用旧系统

让我们检查并禁用旧的 AI 补全系统：

### 步骤 1：检查旧系统

```bash
cd /Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/tianhe-zhikai-ide
cat src/vs/workbench/contrib/aiCompletion/browser/aiCompletion.contribution.ts
```

### 步骤 2：如果存在旧系统，暂时禁用它

在文件中添加 return：

```typescript
async provideInlineCompletions(...) {
    return undefined;  // 临时禁用
    // ... 其他代码
}
```

---

## ✅ 正确的测试流程

### 1. 完全重启 IDE

```bash
# 1. 杀掉所有进程
pkill -f "天和·智开"
pkill -f "Code - OSS"

# 2. 清理编译缓存（可选）
npm run clean

# 3. 重新编译
npm run compile

# 4. 启动 IDE
./scripts/code.sh .
```

### 2. 验证新系统已加载

打开开发者工具 Console，应该看到：
```
[AI Inline Completions] Provider registered
```

**不应该**看到：
```
[AI Completion] ... (旧系统)
```

### 3. 创建测试文件

**test-completion.java**:
```java
public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }

    // 将光标放在这里，输入 'public int sub'

}
```

### 4. 触发补全

**方法 A：自动触发**
- 输入代码（至少3个字符）
- 等待 1-2 秒
- 应该看到灰色的内联建议

**方法 B：手动触发**
- 输入一些代码
- 按 `Ctrl+Space`（Mac: `Cmd+Space`）
- 查看是否有建议

### 5. 查看网络请求

在 Network 标签中找到对 `dashscope.aliyuncs.com` 的请求：

**正确的请求**应该包含：
```json
{
  "model": "qwen-coder-turbo",
  "messages": [{
    "role": "user",
    "content": "You are a precise code completion tool for java...\n\nCRITICAL RULES:\n..."
  }],
  "temperature": 0.2,
  "max_tokens": 500
}
```

**错误的请求**（需要修复）：
```json
{
  "messages": [{
    "content": "Complete this code:\n"
  }]
}
```

---

## 📊 调试检查清单

### Console 日志检查

- [ ] 看到 `[AI Inline Completions] Provider registered`
- [ ] **没有**看到 `[AI Completion]` 相关日志（旧系统）
- [ ] 触发时看到 `[AI Service] Calling Qwen API, prompt length: XXX`
- [ ] 响应时看到 `[AI Service] API call successful, response length: XXX`

### Network 请求检查

- [ ] 请求 URL 是 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
- [ ] Authorization header 包含正确的 API Key
- [ ] Request payload 中 `content` 长度 > 100（包含详细 prompt）
- [ ] `temperature` = 0.2
- [ ] Response status = 200

### 响应内容检查

**好的响应**：
```json
{
  "choices": [{
    "message": {
      "content": "tract(int a, int b) {\n    return a - b;\n}"
    }
  }]
}
```

**坏的响应**（触发过滤）：
```json
{
  "choices": [{
    "message": {
      "content": "It seems like you're trying to..."
    }
  }]
}
```

看到坏响应时，Console 会输出：
```
[AI Inline Completions] Filtered conversational response: It seems like you're trying to...
```

---

## 🔬 高级调试

### 添加更多日志

编辑 `aiInlineCompletions.ts`，添加调试日志：

```typescript
async provideInlineCompletions(...) {
    console.log('[DEBUG] Trigger kind:', context.triggerKind);
    console.log('[DEBUG] Position:', position.lineNumber, position.column);
    console.log('[DEBUG] Prefix:', prefix);
    console.log('[DEBUG] Context lines:', previousLines.length);
    console.log('[DEBUG] Prompt length:', prompt.length);
    console.log('[DEBUG] Full prompt:', prompt.substring(0, 200) + '...');

    // ... 继续原有代码
}
```

### 模拟 API 响应

```typescript
// 临时跳过 API 调用，测试提取逻辑
const aiResponse = 'tract(int a, int b) { return a - b; }';
// const aiResponse = await this.aiService.complete(prompt);
```

---

## 🎯 预期结果

### 成功标志

1. **Console 日志**：
   ```
   [AI Inline Completions] Provider registered
   [AI Service] Calling Qwen API, prompt length: 487
   [AI Service] API call successful, response length: 42
   ```

2. **Network 请求**：
   - Prompt 包含完整上下文
   - Temperature = 0.2
   - Response 包含纯代码

3. **编辑器效果**：
   - 输入代码后看到灰色内联建议
   - 按 Tab 接受补全
   - 补全内容合理

### 失败情况

| 症状 | 原因 | 解决方法 |
|------|------|---------|
| 没有任何反应 | Provider 未注册 | 检查 Console 是否有错误 |
| Prompt 是空的 | 旧系统在运行 | 禁用 aiCompletion |
| 返回对话式文本 | Prompt 或过滤有问题 | 检查 Network 请求内容 |
| 返回被过滤掉 | 过滤规则太严格 | 调整 extractCompletion |

---

## 💡 快速修复命令

```bash
# 1. 完全清理并重新编译
cd /Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/tianhe-zhikai-ide
npm run clean && npm run compile

# 2. 杀掉所有进程
pkill -9 -f "天和·智开" && pkill -9 -f "Code - OSS"

# 3. 重启 IDE（等待编译完成）
./scripts/code.sh .

# 4. 打开开发者工具验证
# Help → Toggle Developer Tools → Console
```

---

## 📞 需要更多帮助？

如果问题仍然存在，请提供：

1. **Console 完整日志**（截图或复制文本）
2. **Network 请求详情**（Request 和 Response）
3. **您执行的具体操作**（输入的代码、按的键）
4. **预期结果 vs 实际结果**

我会根据这些信息提供更精准的解决方案！

---

**更新日期**: 2025-11-04 20:48
**状态**: 已修复 temperature 和 prompt，待验证
