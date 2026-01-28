# LSP 自然语言测试指南

> **重要**：开发人员不需要说"使用 lsp_xxx"，AI 会自动识别意图并选择合适的工具。

---

## 🎯 测试目标

验证 AI 能够理解**自然语言表达**，自动选择正确的 LSP 工具。

---

## 📋 测试准备

### 创建测试文件 `example.ts`

```typescript
// example.ts
interface User {
    id: number;
    name: string;
    email: string;
    age?: number;
}

class UserService {
    private users: User[] = [];

    addUser(user: User): void {
        this.users.push(user);
    }

    findUser(id: number): User | undefined {
        return this.users.find(u => u.id === id);
    }

    deleteUser(id: number): boolean {
        const index = this.users.findIndex(u => u.id === id);
        if (index !== -1) {
            this.users.splice(index, 1);
            return true;
        }
        return false;
    }

    // 故意制造错误
    brokenMethod() {
        const x: number = "hello";  // 类型错误
        return x;
    }
}

const service = new UserService();
const user: User = {
    id: 1,
    name: "Alice",
    email: "alice@example.com"
};
```

---

## ✅ 测试用例 1: lsp_hover（查看类型）

### 用户自然表达（无需说"使用lsp_hover"）：

```
❌ 错误示例："使用 lsp_hover 查看 User 的类型"
✅ 正确示例：

1. "User 接口是什么？"
2. "这个 user 变量是什么类型？"
3. "addUser 方法的参数是什么？"
4. "findUser 返回什么类型？"
5. "告诉我第 41 行 user 的类型信息"
```

### 预期 AI 行为：

1. 自动使用 `read_file` 找到符号位置
2. 自动使用 `lsp_hover` 获取类型信息
3. 返回清晰的类型说明

**测试示例**：
```
你：User 接口是什么？

AI 应该：
1. 使用 read_file("example.ts") 找到 User 接口（第 2 行）
2. 使用 lsp_hover(path="example.ts", line=2, column=11)
3. 回复："User 是一个接口，定义了以下属性：
   - id: number
   - name: string
   - email: string
   - age?: number (可选)"
```

---

## ✅ 测试用例 2: lsp_diagnostics（检查错误）

### 用户自然表达：

```
✅ 正确示例：

1. "这个文件有什么错误吗？"
2. "检查 example.ts 有没有问题"
3. "为什么代码报错了？"
4. "brokenMethod 有什么问题？"
5. "代码能通过编译吗？"
```

### 预期 AI 行为：

1. 自动使用 `lsp_diagnostics(path="example.ts")`
2. 识别类型错误
3. 提供修复建议

**测试示例**：
```
你：这个文件有什么错误吗？

AI 应该：
1. 使用 lsp_diagnostics(path="example.ts")
2. 发现第 31 行的类型错误
3. 回复："检测到 1 个错误：

   第 31 行：brokenMethod 方法中
   错误：Type 'string' is not assignable to type 'number'

   问题：尝试将字符串 "hello" 赋值给 number 类型的变量 x

   修复建议：
   - 将 x 的类型改为 string
   - 或者将 "hello" 改为数字"
```

---

## ✅ 测试用例 3: lsp_definition（查找定义）

### 用户自然表达：

```
✅ 正确示例：

1. "addUser 方法在哪定义的？"
2. "User 接口是在哪里声明的？"
3. "跳转到 UserService 的定义"
4. "findUser 是在哪实现的？"
5. "查看第 41 行 user 变量的定义位置"
```

### 预期 AI 行为：

1. 使用 `read_file` 找到符号
2. 使用 `lsp_definition` 获取定义位置
3. 使用 `read_file` 查看定义的代码

**测试示例**：
```
你：addUser 方法在哪定义的？

AI 应该：
1. 使用 read_file 找到 addUser 的使用位置
2. 使用 lsp_definition 获取定义位置
3. 回复："addUser 方法定义在 example.ts 第 11 行：

   ```typescript
   addUser(user: User): void {
       this.users.push(user);
   }
   ```"
```

---

## ✅ 测试用例 4: lsp_references（查找引用）

### 用户自然表达：

```
✅ 正确示例：

1. "User 接口在哪些地方被使用？"
2. "addUser 方法被调用了几次？"
3. "这个 findUser 函数在哪里被用到？"
4. "我能删除 deleteUser 吗？"（隐含：检查是否被使用）
5. "重命名 UserService 会影响哪些文件？"
```

### 预期 AI 行为：

1. 使用 `lsp_references` 查找所有引用
2. 统计引用次数和位置
3. 评估删除/重命名的影响

**测试示例**：
```
你：User 接口在哪些地方被使用？

AI 应该：
1. 使用 lsp_references(path="example.ts", line=2, column=11)
2. 回复："User 接口共有 5 处引用：

   1. 第 2 行：接口定义
   2. 第 9 行：users: User[] 数组类型
   3. 第 11 行：addUser 参数类型
   4. 第 15 行：findUser 返回类型
   5. 第 40 行：user 变量类型

   影响范围：仅在 example.ts 文件内"
```

---

## ✅ 测试用例 5: lsp_type_definition（查找类型定义）

### 用户自然表达：

```
✅ 正确示例：

1. "user 变量的类型定义是什么？"
2. "第 40 行 user 的类型 User 接口长什么样？"
3. "查看 User 接口的完整定义"
4. "users 数组的元素类型是什么？"
```

### 预期 AI 行为：

1. 使用 `lsp_type_definition` 查找类型定义位置
2. 使用 `read_file` 查看类型的完整定义

**测试示例**：
```
你：user 变量的类型定义是什么？

AI 应该：
1. 使用 lsp_type_definition(path="example.ts", line=40, column=7)
2. 找到 User 接口定义位置
3. 使用 read_file 查看定义
4. 回复："user 变量的类型是 User 接口，定义如下：

   ```typescript
   interface User {
       id: number;
       name: string;
       email: string;
       age?: number;
   }
   ```"
```

---

## ✅ 测试用例 6: 自动诊断注入

### 用户操作：

1. 保存 `example.ts` 文件（Cmd+S / Ctrl+S）
2. 等待 500ms
3. 发送任意消息给 AI

### 用户自然表达：

```
✅ 正确示例：

1. "帮我看看代码"
2. "有什么问题吗？"
3. "继续工作"
4. 任意消息
```

### 预期 AI 行为：

AI 应该**主动提到**检测到的错误，无需用户明确要求：

```
你：帮我看看代码

AI 应该回复类似：
"我注意到代码中有一个错误：

📍 第 31 行：brokenMethod 方法
🔴 错误：Type 'string' is not assignable to type 'number'

问题分析：
变量 x 被声明为 number 类型，但尝试赋值字符串 "hello"。

建议修复：
[提供修复方案...]

除此之外，代码结构看起来很清晰，UserService 类实现了基本的 CRUD 操作..."
```

---

## 🎯 综合测试场景

### 场景 1：理解未知代码

```
你：这个文件是做什么的？

AI 应该：
1. 使用 read_file 读取文件
2. 自动使用 lsp_diagnostics 检查错误
3. 分析代码结构
4. 主动提到发现的类型错误
```

### 场景 2：修改前的影响分析

```
你：我想删除 deleteUser 方法，安全吗？

AI 应该：
1. 使用 lsp_references 查找所有引用
2. 分析影响范围
3. 给出建议
```

### 场景 3：类型驱动开发

```
你：我要添加一个 updateUser 方法

AI 应该：
1. 使用 lsp_type_definition 查看 User 类型
2. 使用 lsp_hover 了解现有方法的签名
3. 建议方法签名和实现
```

---

## ❌ 反模式（AI 不应该要求）

**错误示例 - AI 不应该这样回复**：

```
❌ "请使用 lsp_hover 工具查看类型"
❌ "你可以用 lsp_definition 查找定义"
❌ "要不要我调用 lsp_references？"
```

**正确行为 - AI 应该直接使用工具**：

```
✅ AI 直接使用工具，然后回复结果
✅ "根据类型信息，User 接口包含..."
✅ "我检查了所有引用，共有 5 处..."
```

---

## 📊 成功标准

### 对于每个测试用例：

✅ AI 能理解自然语言意图
✅ AI 自动选择正确的 LSP 工具
✅ AI 无需用户说"使用 lsp_xxx"
✅ AI 提供清晰、有用的回复
✅ 诊断错误自动注入到 System Prompt

### 失败信号：

❌ AI 要求用户"使用 lsp_xxx"
❌ AI 无法理解自然表达
❌ AI 选择了错误的工具
❌ AI 忽略了自动注入的诊断信息

---

## 🔧 调试技巧

如果 AI 没有自动使用 LSP 工具：

1. **检查工具描述**：确保 `toolDescriptions.ts` 包含自然语言触发场景
2. **查看 System Prompt**：确认 LSP 使用指南已注入
3. **测试更明确的表达**：
   - ❌ "告诉我这个" → 太模糊
   - ✅ "这个变量是什么类型？" → 明确
4. **检查文件是否打开**：LSP 需要文件在编辑器中打开
5. **查看控制台日志**：检查工具是否被调用

---

## 🎓 教育 AI 的最佳实践

### 在对话开始时：

```
你：我有一个 TypeScript 文件，想了解它的结构

AI 应该：
1. 自动使用 read_file
2. 自动使用 lsp_diagnostics 检查错误
3. 主动分析类型和结构
```

### 持续反馈：

如果 AI 没有自动使用工具，可以引导：

```
你：我问"这是什么类型"的时候，你应该自动查看类型信息，不需要我说"使用 lsp_hover"
```

---

**测试愉快！** 🚀

记住：**优秀的 AI 助手应该理解开发人员的意图，而不是要求开发人员学习工具名称。**
