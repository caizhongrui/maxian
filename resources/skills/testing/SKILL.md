---
name: Testing
slug: testing
description: 测试策略、TDD 和测试最佳实践
category: testing
estimatedTokens: 900
version: 1.0.0
author: Official
tags: [testing, tdd, unit-test, integration-test]
official: true
createdAt: 2026-01-27
updatedAt: 2026-01-27
---

# Testing Skill

## 概述

全面的测试策略和 TDD 最佳实践。

## 测试金字塔

```
        /\
       /  \  E2E Tests (10%)
      /────\
     /      \  Integration Tests (20%)
    /────────\
   /          \  Unit Tests (70%)
  /────────────\
```

### 测试类型

| 类型 | 范围 | 速度 | 成本 | 覆盖率目标 |
|------|------|------|------|-----------|
| 单元测试 | 单个函数/类 | 快 | 低 | >80% |
| 集成测试 | 模块间交互 | 中 | 中 | >60% |
| E2E 测试 | 完整流程 | 慢 | 高 | 关键路径 |

## TDD 流程（红-绿-重构）

### 步骤 1: 红 - 写失败的测试

```typescript
// ❌ 测试会失败（因为功能还没实现）
describe('Calculator', () => {
  test('should add two numbers', () => {
    const calculator = new Calculator();
    expect(calculator.add(2, 3)).toBe(5);
  });
});
```

### 步骤 2: 绿 - 实现最简单的代码

```typescript
class Calculator {
  add(a: number, b: number): number {
    return a + b; // 最简单的实现
  }
}
```

### 步骤 3: 重构 - 优化代码

```typescript
class Calculator {
  add(...numbers: number[]): number {
    return numbers.reduce((sum, n) => sum + n, 0);
  }
}
```

## 单元测试最佳实践

### AAA 模式（Arrange-Act-Assert）

```typescript
test('should calculate total price with discount', () => {
  // Arrange - 准备
  const cart = new ShoppingCart();
  cart.addItem({ price: 100, quantity: 2 });
  const discount = 0.1;

  // Act - 执行
  const total = cart.calculateTotal(discount);

  // Assert - 断言
  expect(total).toBe(180); // 200 * 0.9 = 180
});
```

### 测试命名

```typescript
// ✅ 好的命名（描述行为）
test('should throw error when dividing by zero')
test('should return empty array when no items match filter')
test('should send welcome email after user registration')

// ❌ 不好的命名
test('test1')
test('divide')
test('email')
```

### 边界条件

```typescript
describe('validateAge', () => {
  test('should accept age 18', () => {
    expect(validateAge(18)).toBe(true);
  });

  test('should reject age 17', () => {
    expect(validateAge(17)).toBe(false);
  });

  test('should reject negative age', () => {
    expect(validateAge(-1)).toBe(false);
  });

  test('should reject age over 120', () => {
    expect(validateAge(150)).toBe(false);
  });

  test('should handle null', () => {
    expect(() => validateAge(null)).toThrow();
  });
});
```

### Mock 和 Stub

```typescript
// Mock 外部依赖
test('should fetch user data', async () => {
  const mockApiClient = {
    get: jest.fn().mockResolvedValue({ id: 1, name: 'Alice' })
  };

  const userService = new UserService(mockApiClient);
  const user = await userService.getUser(1);

  expect(user.name).toBe('Alice');
  expect(mockApiClient.get).toHaveBeenCalledWith('/users/1');
});
```

## 集成测试

### 测试多个模块的交互

```typescript
describe('User Registration Flow', () => {
  let db: TestDatabase;
  let emailService: EmailService;
  let userService: UserService;

  beforeEach(async () => {
    db = await createTestDatabase();
    emailService = new EmailService();
    userService = new UserService(db, emailService);
  });

  afterEach(async () => {
    await db.cleanup();
  });

  test('should register user and send welcome email', async () => {
    const userData = {
      email: 'test@example.com',
      password: 'password123'
    };

    const user = await userService.register(userData);

    // 验证用户已保存到数据库
    const savedUser = await db.users.findById(user.id);
    expect(savedUser.email).toBe(userData.email);

    // 验证欢迎邮件已发送
    expect(emailService.sentEmails).toHaveLength(1);
    expect(emailService.sentEmails[0].to).toBe(userData.email);
  });
});
```

## E2E 测试

### Playwright/Cypress 示例

```typescript
test('user can complete checkout flow', async ({ page }) => {
  // 1. 访问首页
  await page.goto('https://example.com');

  // 2. 添加商品到购物车
  await page.click('[data-testid="add-to-cart"]');

  // 3. 进入购物车
  await page.click('[data-testid="cart-icon"]');
  await expect(page.locator('.cart-item')).toHaveCount(1);

  // 4. 结账
  await page.click('[data-testid="checkout-button"]');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="cardNumber"]', '4242424242424242');
  await page.click('[data-testid="pay-button"]');

  // 5. 验证成功
  await expect(page.locator('.success-message')).toBeVisible();
});
```

## 测试覆盖率

### 目标

- **语句覆盖率**: >80%
- **分支覆盖率**: >75%
- **函数覆盖率**: >90%
- **行覆盖率**: >80%

### 查看覆盖率

```bash
# Jest
npm test -- --coverage

# 生成 HTML 报告
npm test -- --coverage --coverageReporters=html
open coverage/index.html
```

### 覆盖率陷阱

```typescript
// ❌ 100% 覆盖率，但没测试任何行为
test('should create user', () => {
  const user = new User('Alice');
  // 没有断言！
});

// ✅ 正确的测试
test('should create user with name', () => {
  const user = new User('Alice');
  expect(user.name).toBe('Alice');
  expect(user.id).toBeDefined();
});
```

## 测试反模式

### 1. 测试实现细节

```typescript
// ❌ 测试私有方法
test('should call _internalHelper', () => {
  const service = new Service();
  const spy = jest.spyOn(service, '_internalHelper' as any);
  service.publicMethod();
  expect(spy).toHaveBeenCalled();
});

// ✅ 测试公共行为
test('should process data correctly', () => {
  const service = new Service();
  const result = service.publicMethod(input);
  expect(result).toBe(expectedOutput);
});
```

### 2. 脆弱的测试

```typescript
// ❌ 依赖 CSS 选择器
await page.click('.btn.btn-primary.checkout-button');

// ✅ 使用稳定的测试 ID
await page.click('[data-testid="checkout-button"]');
```

### 3. 测试之间的依赖

```typescript
// ❌ 测试 2 依赖测试 1
test('test 1: create user', () => {
  globalUser = createUser();
});

test('test 2: update user', () => {
  updateUser(globalUser); // 依赖 test 1
});

// ✅ 独立的测试
test('should update user', () => {
  const user = createUser(); // 自己准备数据
  updateUser(user);
  expect(user.updated).toBe(true);
});
```

## 测试工具推荐

### JavaScript/TypeScript
- **Jest** - 单元/集成测试
- **Vitest** - 快速的 Vite 测试框架
- **Playwright** - E2E 测试
- **Cypress** - E2E 测试
- **Testing Library** - 组件测试

### 其他语言
- **Python**: pytest, unittest
- **Java**: JUnit, TestNG
- **Go**: testing package, testify

## 测试驱动开发流程

1. **需求分析** (5分钟)
   - 明确功能要求
   - 确定输入/输出

2. **写测试** (10分钟)
   - 写失败的测试
   - 覆盖正常和异常情况

3. **实现功能** (20分钟)
   - 写最简代码通过测试
   - 不要过度设计

4. **重构** (10分钟)
   - 优化代码
   - 确保测试仍然通过

5. **重复** (循环)
   - 逐步完善功能

## 参考资料

- [Jest Documentation](https://jestjs.io/)
- [Testing Library](https://testing-library.com/)
- [Playwright](https://playwright.dev/)
