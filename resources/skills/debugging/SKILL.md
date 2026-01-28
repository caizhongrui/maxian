---
name: Debugging
slug: debugging
description: 系统化调试方法和问题定位技巧
category: debugging
estimatedTokens: 800
version: 1.0.0
author: Official
tags: [debugging, troubleshooting, problem-solving]
official: true
createdAt: 2026-01-27
updatedAt: 2026-01-27
---

# Debugging Skill

## 概述

系统化的调试方法，快速定位和解决问题。

## 调试流程

### 阶段 1: 重现问题（5分钟）

**目标**: 确保问题可以稳定重现

- [ ] 记录详细的重现步骤
- [ ] 确认环境信息（操作系统、版本、配置）
- [ ] 尝试多次重现，确认稳定性
- [ ] 记录错误消息和堆栈跟踪

**问题清单**:
- 什么时候发生？
- 在什么环境下发生？
- 能否稳定重现？
- 错误消息是什么？

### 阶段 2: 隔离问题（10-15分钟）

**目标**: 缩小问题范围

#### 二分法排查

```typescript
// 添加日志定位问题区域
console.log('checkpoint 1'); // ✅ 执行到这里
doSomething();
console.log('checkpoint 2'); // ❌ 没有执行到这里
// 问题在 doSomething() 中
```

#### 注释法

```typescript
// 逐步注释代码，找出问题行
function problematicFunction() {
  const a = getData();
  // const b = processData(a); // 注释这行
  // return transformData(b);  // 注释这行
  return a; // 临时返回，测试前面的步骤
}
```

#### 最小复现案例

创建最简单的能重现问题的代码：

```typescript
// 原始代码（复杂）
function complexFunction(data) {
  // 100 lines...
}

// 最小复现（简化）
function minimal() {
  const data = { id: 1 }; // 硬编码测试数据
  return problematicOperation(data); // 只保留问题部分
}
```

### 阶段 3: 分析根因（10-20分钟）

#### 常见问题类型

**1. 空指针/未定义**

```typescript
// 问题
const value = user.profile.name; // user.profile 可能是 null

// 检查
console.log('user:', user);
console.log('user.profile:', user?.profile);

// 修复
const value = user?.profile?.name ?? 'Unknown';
```

**2. 异步问题**

```typescript
// 问题
let data;
fetchData().then(result => data = result);
console.log(data); // undefined（还没返回）

// 修复
const data = await fetchData();
console.log(data); // 正确
```

**3. 类型错误**

```typescript
// 问题
const sum = "5" + 3; // "53" (字符串拼接)

// 检查
console.log(typeof a, typeof b);

// 修复
const sum = Number("5") + 3; // 8
```

**4. 作用域问题**

```typescript
// 问题
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100); // 都输出 3
}

// 修复
for (let i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 100); // 输出 0, 1, 2
}
```

**5. 副作用/状态污染**

```typescript
// 问题
function processArray(arr) {
  arr.push(newItem); // 修改了原数组！
  return arr;
}

// 修复
function processArray(arr) {
  return [...arr, newItem]; // 返回新数组
}
```

### 阶段 4: 验证修复（5-10分钟）

- [ ] 修复后能否正常工作？
- [ ] 原有测试是否通过？
- [ ] 是否引入新问题？
- [ ] 边界情况是否考虑？

## 调试工具

### Console 调试

```typescript
// 基础输出
console.log('value:', value);

// 对象输出
console.log('user:', JSON.stringify(user, null, 2));

// 表格输出
console.table([{ name: 'Alice', age: 25 }, { name: 'Bob', age: 30 }]);

// 分组
console.group('User Info');
console.log('name:', user.name);
console.log('age:', user.age);
console.groupEnd();

// 计时
console.time('operation');
doExpensiveOperation();
console.timeEnd('operation'); // operation: 123.45ms

// 堆栈跟踪
console.trace('Execution path');
```

### 断点调试

```typescript
// Chrome DevTools 断点
debugger; // 代码会在这里暂停

// 条件断点
if (user.id === 123) {
  debugger; // 只在特定条件下暂停
}
```

### 断言

```typescript
function divide(a, b) {
  console.assert(b !== 0, 'Divisor cannot be zero');
  return a / b;
}
```

## 常见陷阱

### 1. 浮点数精度

```typescript
console.log(0.1 + 0.2); // 0.30000000000000004 ❌
console.log((0.1 + 0.2).toFixed(2)); // "0.30" ✅
```

### 2. 引用 vs 值

```typescript
const a = [1, 2, 3];
const b = a; // 引用
b.push(4);
console.log(a); // [1, 2, 3, 4] ❌ a 也变了

const c = [...a]; // 复制
c.push(5);
console.log(a); // [1, 2, 3, 4] ✅ a 不变
```

### 3. 闭包陷阱

```typescript
// 问题
const functions = [];
for (var i = 0; i < 3; i++) {
  functions.push(() => console.log(i));
}
functions[0](); // 3 ❌

// 修复
for (let i = 0; i < 3; i++) {
  functions.push(() => console.log(i));
}
functions[0](); // 0 ✅
```

## 调试思维

1. **假设验证** - 提出假设 → 设计实验 → 验证结果
2. **排除法** - 逐步排除不可能的原因
3. **对比法** - 对比正常和异常情况的差异
4. **回退法** - 回到上一个正常版本，逐步前进
5. **橡皮鸭调试** - 向别人（或橡皮鸭）解释问题

## 预防措施

- **添加类型检查** - TypeScript
- **单元测试** - 覆盖边界情况
- **输入验证** - 不信任外部输入
- **错误处理** - try-catch + 有意义的错误消息
- **日志记录** - 关键路径记录日志

## 参考资料

- [Chrome DevTools](https://developer.chrome.com/docs/devtools/)
- [Debugging JavaScript](https://javascript.info/debugging-chrome)
