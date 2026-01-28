# 快速测试 LSP 功能

## 🚀 启动测试

### 1. 启动调试实例

在 VS Code 中按 **F5**（或点击"运行 > 启动调试"），会打开一个新的测试窗口。

### 2. 打开测试项目

在新窗口中，打开一个包含 TypeScript 代码的项目（或创建新文件）。

---

## 📝 创建测试文件

创建 `test.ts` 文件：

```typescript
// test.ts
interface User {
    id: number;
    name: string;
    email: string;
}

class UserService {
    private users: User[] = [];

    addUser(user: User): void {
        this.users.push(user);
    }

    getUser(id: number): User | undefined {
        return this.users.find(u => u.id === id);
    }
}

// 故意制造一个错误
const service = new UserService();
const errorVar: number = "hello";  // 类型错误
```

---

## 🔍 如何查看 LSP 工具的使用

### 方法 1：在聊天界面查看工具调用（最直观）

打开码弦聊天面板，发送消息后，你会看到：

```
[你的消息]
User 接口是什么？

[AI 的回复]
🔧 使用工具：read_file
📄 读取：test.ts

🔧 使用工具：lsp_hover              ← 这里！看到了吗？
📍 位置：test.ts:2:11
📊 结果：
interface User {
    id: number;
    name: string;
    email: string;
}

[AI 的解释]
User 是一个接口，定义了用户的基本信息...
```

**关键**：聊天界面会显示 AI 使用的每个工具，包括：
- 🔧 工具名称（如 `lsp_hover`, `lsp_definition`）
- 📍 调用参数（文件路径、行号、列号）
- 📊 返回结果

### 方法 2：查看开发者工具控制台（详细日志）

1. 在测试窗口中，按 **Cmd+Shift+I** (Mac) 或 **Ctrl+Shift+I** (Windows)
2. 切换到 **Console** 标签
3. 发送消息给 AI

你会看到详细的日志：

```console
[LspHoverService] 服务已初始化
[LspDefinitionService] 服务已初始化
[LspReferencesService] 服务已初始化
...

[ToolExecutor] 执行工具: lsp_hover                    ← 看这里
[ToolExecutor] 参数: {path: "test.ts", line: 2, column: 11}
[LspHoverService] 获取悬停信息: test.ts:2:11
[LspHoverService] 找到悬停信息，符号="User"
[ToolExecutor] lsp_hover 执行成功
```

### 方法 3：查看工具调用统计

在控制台输入：

```javascript
// 查看所有工具调用历史（如果有实现）
console.log('查看聊天记录中的工具调用')
```

---

## 🧪 测试用例

### 测试 1：lsp_hover（查看类型）

**你说**：
```
User 接口是什么？
```

**应该看到**：
- ✅ 聊天界面显示 `🔧 使用工具：lsp_hover`
- ✅ 控制台显示 `[ToolExecutor] 执行工具: lsp_hover`
- ✅ AI 返回 User 接口的完整定义

---

### 测试 2：lsp_diagnostics（检查错误）

**你说**：
```
这个文件有什么错误吗？
```

**应该看到**：
- ✅ 聊天界面显示 `🔧 使用工具：lsp_diagnostics`
- ✅ 控制台显示 `[LspDiagnosticsService] 获取诊断: test.ts`
- ✅ AI 返回类型错误：`Type 'string' is not assignable to type 'number'`

**控制台日志示例**：
```console
[ToolExecutor] 执行工具: lsp_diagnostics
[ToolExecutor] 参数: {path: "test.ts"}
[LspDiagnosticsService] 获取诊断: test.ts
[LspDiagnosticsService] 找到 1 个错误, 0 个警告
```

---

### 测试 3：lsp_definition（查找定义）

**你说**：
```
addUser 方法在哪定义的？
```

**应该看到**：
- ✅ 聊天界面显示 `🔧 使用工具：lsp_definition`
- ✅ 控制台显示 `[LspDefinitionService] 获取定义: test.ts:10:5`
- ✅ AI 返回定义位置和代码

---

### 测试 4：lsp_references（查找引用）

**你说**：
```
User 接口在哪些地方被使用？
```

**应该看到**：
- ✅ 聊天界面显示 `🔧 使用工具：lsp_references`
- ✅ 控制台显示 `[LspReferencesService] 获取引用: test.ts:2:11`
- ✅ AI 返回所有使用 User 的位置

**控制台日志示例**：
```console
[ToolExecutor] 执行工具: lsp_references
[LspReferencesService] 获取引用: test.ts:2:11, 符号="User", 共 4 个
```

---

### 测试 5：自动诊断注入

**步骤**：
1. 保存 `test.ts` 文件（Cmd+S / Ctrl+S）
2. 等待 1 秒
3. 查看控制台

**应该看到**：
```console
[FileWatcher] 检测到文件保存: test.ts
[FileWatcher] 调度诊断检查: test.ts (300ms后)
[FileWatcher] 触发文件保存事件: test.ts
[AutoDiagnosticInjector] 处理文件保存: test.ts
[AutoDiagnosticInjector] 获取诊断: test.ts
[LspDiagnosticsService] 获取诊断: test.ts
[AutoDiagnosticInjector] 诊断就绪: {
    filePath: "test.ts",
    summary: "1 个错误",
    count: 1,
    hasCriticalErrors: true
}
[Maxian] 诊断信息已就绪，将在下次AI调用时自动注入
```

4. 然后发送任意消息给 AI：
```
帮我看看代码
```

**AI 应该主动提到错误**：
```
我注意到代码中有一个错误：

第 23 行：errorVar 变量
🔴 错误：Type 'string' is not assignable to type 'number'

[修复建议...]
```

---

## 🎯 验证 LSP 工具已被调用的标志

### ✅ 在聊天界面

1. **工具调用卡片**：每次 AI 使用工具时，会显示工具卡片
   ```
   🔧 使用工具：lsp_hover
   📍 位置：test.ts:2:11
   ```

2. **工具结果**：显示工具返回的结果（可展开/折叠）

3. **AI 引用结果**：AI 的回复会基于工具返回的信息

### ✅ 在控制台

搜索关键词：
- `[LspHoverService]` - hover 相关日志
- `[LspDiagnosticsService]` - diagnostics 相关日志
- `[LspDefinitionService]` - definition 相关日志
- `[LspReferencesService]` - references 相关日志
- `[LspTypeDefinitionService]` - type definition 相关日志
- `[ToolExecutor] 执行工具:` - 所有工具调用
- `[AutoDiagnosticInjector]` - 自动诊断注入日志

### ✅ AI 的回复内容

如果 AI 提供了以下信息，说明使用了 LSP：

- **类型信息**："User 接口包含 id, name, email 属性"
- **错误详情**："第 X 行有类型错误：..."
- **定义位置**："定义在 test.ts 第 10 行"
- **引用列表**："共有 4 处引用：..."

---

## 🐛 如果看不到工具调用

### 检查清单：

1. **文件是否打开？**
   - LSP 工具需要文件在编辑器中打开
   - 确保文件有内容

2. **TypeScript 服务器是否运行？**
   - 查看右下角状态栏
   - 应该显示 "TypeScript" 和版本号
   - 如果没有，重启：Cmd+Shift+P → "TypeScript: Restart TS Server"

3. **查看控制台错误**
   - 如果有红色错误，说明 LSP 服务有问题

4. **测试表达是否明确？**
   - ❌ "告诉我这个" → 太模糊
   - ✅ "User 接口是什么？" → 明确

5. **手动测试 LSP 工具**
   ```
   请使用 lsp_hover 查看 test.ts 第 2 行第 11 列的类型
   ```
   如果手动调用也不行，说明 LSP 服务本身有问题

---

## 📊 示例对话

### 完整对话示例

```
你：User 接口是什么？

[聊天界面显示]
🔧 使用工具：read_file
📄 test.ts

🔧 使用工具：lsp_hover
📍 test.ts:2:11
📊 返回：interface User { id: number; name: string; email: string; }

AI：User 是一个接口，定义了用户的基本信息，包含三个属性：
- id: number - 用户ID
- name: string - 用户名
- email: string - 邮箱地址

---

你：这个文件有什么错误吗？

[聊天界面显示]
🔧 使用工具：lsp_diagnostics
📄 test.ts
📊 返回：1 个错误

AI：检测到 1 个错误：

第 23 行：errorVar 变量
🔴 Type 'string' is not assignable to type 'number'

问题：尝试将字符串 "hello" 赋值给 number 类型的变量

修复建议：
1. 将 errorVar 的类型改为 string
2. 或者将 "hello" 改为数字

---

你：User 在哪些地方被用到？

[聊天界面显示]
🔧 使用工具：lsp_references
📍 test.ts:2:11
📊 返回：4 处引用

AI：User 接口共有 4 处引用：

1. 第 2 行：接口定义
2. 第 8 行：users: User[] 数组类型
3. 第 10 行：addUser 参数类型
4. 第 14 行：getUser 返回类型

所有引用都在 test.ts 文件内。
```

---

## 🎉 测试成功的标志

✅ 聊天界面显示工具调用卡片
✅ 控制台有对应的日志
✅ AI 的回复包含具体的类型/错误信息
✅ 自动诊断注入后，AI 主动提到错误
✅ 无需说"使用 lsp_xxx"，AI 自动理解意图

---

## 💡 提示

1. **多看控制台**：最详细的调试信息都在控制台
2. **测试表达要清晰**：明确说出你想知道什么
3. **耐心等待**：LSP 服务器首次分析可能需要几秒
4. **保存文件**：确保文件已保存，LSP 才能正确分析

**祝测试顺利！** 🚀
