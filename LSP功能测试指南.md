# LSP 功能测试指南

## 📋 测试前准备

### 1. 启动开发环境

```bash
cd /Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/tianhe-zhikai-ide
yarn watch  # 如果还没运行的话
```

### 2. 启动调试实例

在 VS Code 中按 `F5` 或选择 "Run > Start Debugging"，会打开一个新的 VS Code 窗口（Extension Development Host）。

### 3. 打开测试项目

在新窗口中，打开一个包含 TypeScript/JavaScript 代码的项目。

---

## 🧪 测试 LSP 工具（手动调用）

### 测试环境：创建测试文件

在测试项目中创建一个测试文件 `test-lsp.ts`：

```typescript
// test-lsp.ts
interface User {
    name: string;
    age: number;
    email: string;
}

class UserService {
    private users: User[] = [];

    addUser(user: User): void {
        this.users.push(user);
    }

    getUser(name: string): User | undefined {
        return this.users.find(u => u.name === name);
    }

    // 故意制造一个错误
    brokenFunction() {
        const x: number = "hello";  // 类型错误
        return undefined;
    }
}

const service = new UserService();
const user: User = {
    name: "Alice",
    age: 25,
    email: "alice@example.com"
};
service.addUser(user);
```

### 1. 测试 lsp_diagnostics（诊断）

打开码弦聊天面板，输入：

```
请使用 lsp_diagnostics 检查 test-lsp.ts 文件的错误
```

**预期结果：**
- AI 会调用 `lsp_diagnostics` 工具
- 返回结果应该包含 `brokenFunction` 中的类型错误
- 错误信息：`Type 'string' is not assignable to type 'number'`

### 2. 测试 lsp_hover（悬停信息）

```
使用 lsp_hover 查看 test-lsp.ts 第 3 行第 15 列（User 接口）的类型信息
```

**预期结果：**
- 返回 `User` 接口的完整定义
- 显示接口的所有属性和类型

### 3. 测试 lsp_definition（跳转到定义）

```
使用 lsp_definition 查找 test-lsp.ts 第 28 行第 13 列（service.addUser 中的 addUser）的定义位置
```

**预期结果：**
- 返回 `addUser` 方法的定义位置
- 应该指向第 9 行的 `addUser` 方法定义

### 4. 测试 lsp_references（查找引用）

```
使用 lsp_references 查找 test-lsp.ts 中 User 接口的所有引用位置
```

**参数示例：**
- path: `test-lsp.ts`
- line: 2 (User 接口定义的行)
- column: 11

**预期结果：**
- 返回所有使用 `User` 类型的位置
- 应该包含：
  - 第 2 行：接口定义
  - 第 7 行：`users: User[]`
  - 第 9 行：`addUser(user: User)`
  - 第 13 行：`getUser(name: string): User`
  - 第 23 行：`const user: User`

### 5. 测试 lsp_type_definition（跳转到类型定义）

```
使用 lsp_type_definition 查找 test-lsp.ts 第 23 行 user 变量的类型定义
```

**预期结果：**
- 返回 `User` 接口的定义位置（第 2 行）
- 这与 `lsp_definition` 不同：
  - `lsp_definition(user)` → 跳到变量声明（第 23 行）
  - `lsp_type_definition(user)` → 跳到类型定义（第 2 行的 User 接口）

---

## 🚀 测试自动诊断注入

### 测试步骤：

#### 1. 创建有错误的文件

创建或修改 `test-auto-diagnostic.ts`：

```typescript
function calculate(a: number, b: number): number {
    const result: number = "wrong type";  // 错误
    return result;
}

const x: string = 123;  // 错误
```

#### 2. 保存文件

按 `Cmd+S` (Mac) 或 `Ctrl+S` (Windows/Linux) 保存文件。

#### 3. 观察控制台输出

打开 "帮助 > 切换开发人员工具"，查看控制台，应该看到：

```
[FileWatcher] 检测到文件保存: test-auto-diagnostic.ts
[FileWatcher] 调度诊断检查: test-auto-diagnostic.ts (300ms后)
[FileWatcher] 触发文件保存事件: test-auto-diagnostic.ts
[AutoDiagnosticInjector] 处理文件保存: test-auto-diagnostic.ts
[AutoDiagnosticInjector] 获取诊断: test-auto-diagnostic.ts
[LspDiagnosticsService] 获取诊断: test-auto-diagnostic.ts
[AutoDiagnosticInjector] 诊断就绪: { filePath: ..., summary: "2 个错误", count: 2, hasCriticalErrors: true }
[Maxian] 诊断信息已就绪，将在下次AI调用时自动注入
```

#### 4. 触发 AI 调用

在码弦聊天面板输入任意消息，例如：

```
请总结一下当前的代码问题
```

#### 5. 验证注入

在控制台查看 System Prompt，应该包含诊断信息：

```
## 当前代码诊断信息

检测到 2 个错误和 0 个警告：

### test-auto-diagnostic.ts
路径: /path/to/test-auto-diagnostic.ts

🔴 **错误** - 第 2:24 行
  消息: Type 'string' is not assignable to type 'number'
  来源: TypeScript
  代码: 2322

🔴 **错误** - 第 6:7 行
  消息: Type 'number' is not assignable to type 'string'
  来源: TypeScript
  代码: 2322

---

**建议**: 请在回复中考虑并修复上述诊断问题。优先修复错误（🔴），然后处理警告（🟡）。
```

#### 6. 验证 AI 响应

AI 应该能够：
- 识别到代码中的错误
- 提供修复建议
- 可能主动提出修复代码

---

## 🔧 测试配置和控制

### 在浏览器控制台中测试

打开开发者工具控制台，执行以下命令：

#### 1. 检查诊断注入器状态

```javascript
// 获取 maxianService 实例（需要先触发一次码弦功能）
// 然后在控制台执行：
workbench.contrib.maxian.getDiagnosticsStats()
```

**预期输出：**
```javascript
{
    enabled: true,
    cacheSize: 1,  // 缓存的文件数量
    hasPendingDiagnostics: true  // 是否有待注入的诊断
}
```

#### 2. 手动触发诊断获取

```javascript
workbench.contrib.maxian.manualFetchDiagnostics('/path/to/test-auto-diagnostic.ts')
```

#### 3. 禁用自动诊断注入

```javascript
workbench.contrib.maxian.disableAutoDiagnostics()
```

#### 4. 启用自动诊断注入

```javascript
workbench.contrib.maxian.enableAutoDiagnostics()
```

#### 5. 清除当前诊断

```javascript
workbench.contrib.maxian.clearCurrentDiagnostics()
```

---

## 📊 测试用例矩阵

### LSP Diagnostics 测试用例

| 测试场景 | 文件内容 | 预期结果 |
|---------|---------|---------|
| TypeScript 类型错误 | `const x: number = "string"` | 返回 TS2322 错误 |
| 未定义变量 | `console.log(undefinedVar)` | 返回 TS2304 错误 |
| 缺少参数 | `function f(a: number) {}; f()` | 返回参数错误 |
| ESLint 警告 | `var x = 1;` | 返回 no-var 警告 |
| 无错误文件 | 正确的 TypeScript 代码 | 返回空数组 |

### LSP Hover 测试用例

| 测试场景 | 位置 | 预期结果 |
|---------|------|---------|
| 函数定义 | 函数名上 | 返回函数签名 |
| 变量定义 | 变量名上 | 返回变量类型 |
| 接口定义 | 接口名上 | 返回接口完整定义 |
| 导入模块 | import 语句 | 返回模块信息 |

### LSP Definition 测试用例

| 测试场景 | 位置 | 预期结果 |
|---------|------|---------|
| 函数调用 | 函数名上 | 跳转到函数定义 |
| 变量引用 | 变量使用处 | 跳转到变量声明 |
| 类型引用 | 类型使用处 | 跳转到类型定义 |
| 跨文件引用 | 导入的符号 | 跳转到源文件 |

### LSP References 测试用例

| 测试场景 | 位置 | 预期结果 |
|---------|------|---------|
| 函数引用 | 函数定义处 | 返回所有调用位置 |
| 变量引用 | 变量定义处 | 返回所有使用位置 |
| 接口引用 | 接口定义处 | 返回所有实现位置 |
| 跨文件引用 | 导出的符号 | 返回所有导入位置 |

### LSP TypeDefinition 测试用例

| 测试场景 | 位置 | 预期结果 |
|---------|------|---------|
| 变量的类型 | 变量声明 | 跳转到类型定义 |
| 函数返回值 | 函数定义 | 跳转到返回类型定义 |
| 类实例 | 对象创建处 | 跳转到类定义 |

---

## ⚠️ 常见问题排查

### 1. LSP 工具返回空结果

**可能原因：**
- 文件未打开在编辑器中
- LSP 服务器还未初始化完成
- 位置参数不正确（行号、列号）

**解决方法：**
- 确保文件在编辑器中打开
- 等待几秒后重试
- 使用 VS Code 的 "Go to Definition" 验证位置是否正确

### 2. 自动诊断注入不工作

**检查清单：**
1. 控制台是否有 `[FileWatcher]` 日志？
2. 控制台是否有 `[AutoDiagnosticInjector]` 日志？
3. 文件是否在工作区内？
4. LSP 服务器是否正常工作？（VS Code 右下角应该显示 TypeScript 版本）

**调试方法：**
```javascript
// 检查注入器是否已初始化
console.log(workbench.contrib.maxian.autoDiagnosticInjector)

// 检查当前诊断文本
console.log(workbench.contrib.maxian.currentDiagnosticText)
```

### 3. 诊断信息未注入到 System Prompt

**检查步骤：**
1. 确认诊断信息已就绪（控制台有 "诊断信息已就绪" 日志）
2. 确认 `currentDiagnosticText` 不为 null
3. 发送 AI 消息前，查看 System Prompt 生成日志

### 4. LSP 工具返回错误

**检查 LSP 服务是否正常：**
```typescript
// 在 VS Code 中按 Cmd+Shift+P (Mac) 或 Ctrl+Shift+P (Windows/Linux)
// 输入 "TypeScript: Restart TS Server"
// 重启 TypeScript 服务器
```

---

## 🎯 成功标准

### 所有 LSP 工具测试通过的标准：

✅ **lsp_diagnostics** - 能够检测到代码错误并返回详细信息
✅ **lsp_hover** - 能够返回符号的类型信息和文档
✅ **lsp_definition** - 能够找到符号的定义位置
✅ **lsp_references** - 能够找到符号的所有引用
✅ **lsp_type_definition** - 能够找到类型的定义位置
✅ **自动诊断注入** - 保存文件后500ms内诊断信息注入到 System Prompt
✅ **AI 自动修复** - AI 能够识别诊断信息并提供修复建议

---

## 📝 测试报告模板

```markdown
# LSP 功能测试报告

**测试日期：** YYYY-MM-DD
**测试人员：** XXX
**测试环境：** VS Code Extension Development Host

## 测试结果

### 1. lsp_diagnostics
- [ ] 测试通过
- [ ] 测试失败
- 备注：

### 2. lsp_hover
- [ ] 测试通过
- [ ] 测试失败
- 备注：

### 3. lsp_definition
- [ ] 测试通过
- [ ] 测试失败
- 备注：

### 4. lsp_references
- [ ] 测试通过
- [ ] 测试失败
- 备注：

### 5. lsp_type_definition
- [ ] 测试通过
- [ ] 测试失败
- 备注：

### 6. 自动诊断注入
- [ ] 测试通过
- [ ] 测试失败
- 备注：

## 发现的问题

1.
2.
3.

## 改进建议

1.
2.
3.
```

---

## 🚀 下一步

测试完成后，可以：

1. **创建演示视频** - 展示 LSP 功能和自动诊断注入
2. **编写用户文档** - 说明如何使用这些功能
3. **性能测试** - 测试大文件的诊断性能
4. **集成测试** - 测试与其他功能的配合
5. **用户反馈** - 收集实际使用体验

---

**祝测试顺利！** 🎉
