---
name: Refactoring
slug: refactoring
description: 代码重构模式和最佳实践
category: code-quality
estimatedTokens: 1000
version: 1.0.0
author: Official
tags: [refactoring, clean-code, design-patterns]
official: true
createdAt: 2026-01-27
updatedAt: 2026-01-27
---

# Refactoring Skill

## 何时重构

### 重构时机

✅ **应该重构**:
- 添加新功能前
- 修复 bug 后
- 代码审查时发现问题
- 发现重复代码时
- 性能分析后

❌ **不应该重构**:
- 项目截止日期前
- 没有测试覆盖时
- 需求不明确时

## 常见代码异味

### 1. 重复代码

```typescript
// ❌ 重复代码
function calculatePriceForUser(user) {
  const basePrice = 100;
  const discount = user.isPremium ? 0.2 : 0;
  return basePrice * (1 - discount);
}

function calculatePriceForOrder(order) {
  const basePrice = order.total;
  const discount = order.user.isPremium ? 0.2 : 0;
  return basePrice * (1 - discount);
}

// ✅ 提取公共逻辑
function applyDiscount(basePrice, user) {
  const discount = user.isPremium ? 0.2 : 0;
  return basePrice * (1 - discount);
}
```

### 2. 过长函数

```typescript
// ❌ 过长函数（50+ 行）
function processOrder(order) {
  // 验证订单...10 行
  // 计算价格...15 行
  // 处理支付...20 行
  // 发送邮件...10 行
}

// ✅ 拆分为小函数
function processOrder(order) {
  validateOrder(order);
  const price = calculatePrice(order);
  processPayment(order, price);
  sendConfirmationEmail(order);
}
```

### 3. 过大类

```typescript
// ❌ 上帝类（职责过多）
class UserManager {
  createUser() {}
  deleteUser() {}
  sendEmail() {}
  processPayment() {}
  generateReport() {}
  // 20+ methods...
}

// ✅ 单一职责
class UserService {
  createUser() {}
  deleteUser() {}
}

class EmailService {
  send() {}
}

class PaymentService {
  process() {}
}
```

### 4. 过长参数列表

```typescript
// ❌ 参数过多
function createUser(
  name, email, age, address, city,
  country, phone, gender, occupation
) {}

// ✅ 使用对象参数
interface UserData {
  name: string;
  email: string;
  profile: {
    age: number;
    gender: string;
    occupation: string;
  };
  address: {
    street: string;
    city: string;
    country: string;
  };
  phone: string;
}

function createUser(userData: UserData) {}
```

### 5. 特性依恋

```typescript
// ❌ 方法过度使用其他类的数据
class Order {
  getTotal() {
    return this.items
      .map(item => item.product.price * item.quantity)
      .reduce((sum, price) => sum + price, 0);
  }
}

// ✅ 让数据和行为在一起
class OrderItem {
  getSubtotal() {
    return this.product.price * this.quantity;
  }
}

class Order {
  getTotal() {
    return this.items
      .map(item => item.getSubtotal())
      .reduce((sum, price) => sum + price, 0);
  }
}
```

## 重构技巧

### 提取方法

```typescript
// Before
function printOwing(invoice) {
  let outstanding = 0;

  console.log("***********************");
  console.log("**** Customer Owes ****");
  console.log("***********************");

  for (const order of invoice.orders) {
    outstanding += order.amount;
  }

  console.log(`name: ${invoice.customer}`);
  console.log(`amount: ${outstanding}`);
}

// After
function printOwing(invoice) {
  printBanner();
  const outstanding = calculateOutstanding(invoice);
  printDetails(invoice, outstanding);
}

function printBanner() {
  console.log("***********************");
  console.log("**** Customer Owes ****");
  console.log("***********************");
}

function calculateOutstanding(invoice) {
  return invoice.orders.reduce((sum, order) => sum + order.amount, 0);
}

function printDetails(invoice, outstanding) {
  console.log(`name: ${invoice.customer}`);
  console.log(`amount: ${outstanding}`);
}
```

### 引入解释性变量

```typescript
// ❌ 难以理解的条件
if ((platform.toUpperCase().indexOf("MAC") > -1) &&
    (browser.toUpperCase().indexOf("IE") > -1) &&
    wasInitialized() && resize > 0) {
  // ...
}

// ✅ 使用解释性变量
const isMacOs = platform.toUpperCase().indexOf("MAC") > -1;
const isIE = browser.toUpperCase().indexOf("IE") > -1;
const wasResized = resize > 0;

if (isMacOs && isIE && wasInitialized() && wasResized) {
  // ...
}
```

### 以多态取代条件表达式

```typescript
// ❌ 使用条件判断
class Bird {
  getSpeed() {
    switch (this.type) {
      case 'european':
        return this.getBaseSpeed();
      case 'african':
        return this.getBaseSpeed() - this.numberOfCoconuts * 0.5;
      case 'norwegian':
        return (this.isNailed) ? 0 : this.getBaseSpeed() * this.voltage;
    }
  }
}

// ✅ 使用多态
class Bird {
  getSpeed() {
    return this.getBaseSpeed();
  }
}

class EuropeanBird extends Bird {}

class AfricanBird extends Bird {
  getSpeed() {
    return this.getBaseSpeed() - this.numberOfCoconuts * 0.5;
  }
}

class NorwegianBird extends Bird {
  getSpeed() {
    return (this.isNailed) ? 0 : this.getBaseSpeed() * this.voltage;
  }
}
```

### 封装条件

```typescript
// ❌ 复杂条件
if (date.before(SUMMER_START) || date.after(SUMMER_END)) {
  charge = quantity * winterRate + winterServiceCharge;
} else {
  charge = quantity * summerRate;
}

// ✅ 封装为方法
if (notSummer(date)) {
  charge = winterCharge(quantity);
} else {
  charge = summerCharge(quantity);
}

function notSummer(date) {
  return date.before(SUMMER_START) || date.after(SUMMER_END);
}
```

## 重构流程

1. **运行测试** - 确保有测试覆盖
2. **小步前进** - 每次只改一小块
3. **频繁提交** - 每个小改动都提交
4. **运行测试** - 每次修改后运行测试
5. **重复** - 持续改进

## 安全重构检查清单

- [ ] 所有测试都通过了吗？
- [ ] 代码行为没有改变吗？
- [ ] 代码更易读了吗？
- [ ] 性能没有明显下降吗？
- [ ] 没有引入新的 bug 吗？

## 参考资料

- [Refactoring by Martin Fowler](https://refactoring.com/)
- [Clean Code by Robert C. Martin](https://www.oreilly.com/library/view/clean-code/9780136083238/)
