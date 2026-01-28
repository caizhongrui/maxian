---
name: Architecture
slug: architecture
description: 软件架构模式和系统设计原则
category: architecture
estimatedTokens: 1300
version: 1.0.0
author: Official
tags: [architecture, design-patterns, solid, clean-architecture]
official: true
createdAt: 2026-01-27
updatedAt: 2026-01-27
---

# Architecture Skill

## 概述

软件架构模式、设计原则和系统设计最佳实践。

## SOLID 原则

### 1. 单一职责原则（Single Responsibility）

一个类应该只有一个引起它变化的原因。

```typescript
// ❌ 违反 SRP - 职责过多
class User {
  name: string;
  email: string;

  save() {
    // 数据库操作
  }

  sendEmail() {
    // 邮件发送
  }

  generateReport() {
    // 报告生成
  }
}

// ✅ 遵循 SRP - 职责分离
class User {
  name: string;
  email: string;
}

class UserRepository {
  save(user: User) {
    // 数据库操作
  }
}

class EmailService {
  send(user: User, message: string) {
    // 邮件发送
  }
}

class ReportGenerator {
  generate(user: User) {
    // 报告生成
  }
}
```

### 2. 开放封闭原则（Open/Closed）

对扩展开放,对修改封闭。

```typescript
// ❌ 违反 OCP - 添加新类型需要修改现有代码
class PaymentProcessor {
  process(type: string, amount: number) {
    if (type === 'credit-card') {
      // 信用卡支付
    } else if (type === 'paypal') {
      // PayPal 支付
    }
    // 添加新支付方式需要修改这里
  }
}

// ✅ 遵循 OCP - 通过继承扩展
interface PaymentMethod {
  process(amount: number): void;
}

class CreditCardPayment implements PaymentMethod {
  process(amount: number) {
    // 信用卡支付
  }
}

class PayPalPayment implements PaymentMethod {
  process(amount: number) {
    // PayPal 支付
  }
}

class PaymentProcessor {
  process(method: PaymentMethod, amount: number) {
    method.process(amount); // 添加新支付方式无需修改
  }
}
```

### 3. 里氏替换原则（Liskov Substitution）

子类应该能够替换父类。

```typescript
// ❌ 违反 LSP
class Bird {
  fly() {
    // 飞行
  }
}

class Penguin extends Bird {
  fly() {
    throw new Error('企鹅不会飞'); // 破坏了父类契约
  }
}

// ✅ 遵循 LSP
interface Animal {
  move(): void;
}

class FlyingBird implements Animal {
  move() {
    this.fly();
  }
  fly() {
    // 飞行
  }
}

class Penguin implements Animal {
  move() {
    this.swim();
  }
  swim() {
    // 游泳
  }
}
```

### 4. 接口隔离原则（Interface Segregation）

客户端不应该依赖它不需要的接口。

```typescript
// ❌ 违反 ISP - 接口过大
interface Worker {
  work(): void;
  eat(): void;
  sleep(): void;
}

class Robot implements Worker {
  work() { /* ... */ }
  eat() { throw new Error('机器人不吃饭'); }
  sleep() { throw new Error('机器人不睡觉'); }
}

// ✅ 遵循 ISP - 接口分离
interface Workable {
  work(): void;
}

interface Eatable {
  eat(): void;
}

interface Sleepable {
  sleep(): void;
}

class Human implements Workable, Eatable, Sleepable {
  work() { /* ... */ }
  eat() { /* ... */ }
  sleep() { /* ... */ }
}

class Robot implements Workable {
  work() { /* ... */ }
}
```

### 5. 依赖倒置原则（Dependency Inversion）

依赖抽象而不是具体实现。

```typescript
// ❌ 违反 DIP - 依赖具体类
class MySQLDatabase {
  query(sql: string) { /* ... */ }
}

class UserService {
  private db = new MySQLDatabase(); // 紧耦合

  getUser(id: number) {
    return this.db.query(`SELECT * FROM users WHERE id = ${id}`);
  }
}

// ✅ 遵循 DIP - 依赖抽象
interface Database {
  query(sql: string): any;
}

class MySQLDatabase implements Database {
  query(sql: string) { /* ... */ }
}

class PostgreSQLDatabase implements Database {
  query(sql: string) { /* ... */ }
}

class UserService {
  constructor(private db: Database) {} // 依赖注入

  getUser(id: number) {
    return this.db.query(`SELECT * FROM users WHERE id = ${id}`);
  }
}
```

## 架构模式

### 1. 分层架构（Layered Architecture）

```
┌─────────────────────────┐
│   Presentation Layer    │ ← UI、Controllers
├─────────────────────────┤
│    Business Layer       │ ← 业务逻辑、Services
├─────────────────────────┤
│   Persistence Layer     │ ← 数据访问、Repositories
├─────────────────────────┤
│     Database Layer      │ ← 数据库
└─────────────────────────┘
```

```typescript
// Presentation Layer
class UserController {
  constructor(private userService: UserService) {}

  async createUser(req, res) {
    const user = await this.userService.create(req.body);
    res.json(user);
  }
}

// Business Layer
class UserService {
  constructor(private userRepository: UserRepository) {}

  async create(data: CreateUserDto) {
    this.validateUserData(data);
    return this.userRepository.save(data);
  }
}

// Persistence Layer
class UserRepository {
  async save(data: any) {
    return db.users.create(data);
  }
}
```

### 2. Clean Architecture（整洁架构）

```
┌─────────────────────────────────────┐
│         Frameworks & Drivers        │ ← UI、DB、External APIs
├─────────────────────────────────────┤
│        Interface Adapters           │ ← Controllers、Presenters
├─────────────────────────────────────┤
│          Use Cases                  │ ← 业务逻辑
├─────────────────────────────────────┤
│          Entities                   │ ← 核心业务实体
└─────────────────────────────────────┘
      依赖方向: 外层 → 内层
```

```typescript
// Entities（核心层）
class User {
  constructor(
    public id: string,
    public name: string,
    public email: string
  ) {}

  isValid(): boolean {
    return this.email.includes('@');
  }
}

// Use Cases（用例层）
class CreateUserUseCase {
  constructor(private userRepository: IUserRepository) {}

  async execute(data: CreateUserDto): Promise<User> {
    const user = new User(generateId(), data.name, data.email);
    if (!user.isValid()) {
      throw new Error('Invalid user');
    }
    return this.userRepository.save(user);
  }
}

// Interface Adapters（适配器层）
class UserController {
  constructor(private createUserUseCase: CreateUserUseCase) {}

  async createUser(req, res) {
    const user = await this.createUserUseCase.execute(req.body);
    res.json({ id: user.id, name: user.name, email: user.email });
  }
}

// Frameworks（框架层）
class MongoUserRepository implements IUserRepository {
  async save(user: User) {
    return db.collection('users').insertOne(user);
  }
}
```

### 3. 微服务架构（Microservices）

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   User       │   │   Order      │   │   Payment    │
│   Service    │   │   Service    │   │   Service    │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       └──────────────────┴──────────────────┘
                         │
                   API Gateway
                         │
                      Client
```

**优点**:
- 独立部署
- 技术栈自由
- 团队自治
- 故障隔离

**缺点**:
- 分布式复杂性
- 数据一致性
- 服务间通信开销
- 运维成本高

### 4. 事件驱动架构（Event-Driven）

```typescript
// Event Bus
class EventBus {
  private handlers = new Map<string, Function[]>();

  subscribe(event: string, handler: Function) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
  }

  publish(event: string, data: any) {
    const handlers = this.handlers.get(event) || [];
    handlers.forEach(handler => handler(data));
  }
}

// Event Handlers
eventBus.subscribe('user.created', (user) => {
  emailService.sendWelcomeEmail(user);
});

eventBus.subscribe('user.created', (user) => {
  analyticsService.track('user_created', user);
});

// Publish Events
class UserService {
  async create(data: CreateUserDto) {
    const user = await this.userRepository.save(data);
    eventBus.publish('user.created', user); // 发布事件
    return user;
  }
}
```

## 设计模式

### 创建型模式

**1. 单例模式（Singleton）**

```typescript
class Database {
  private static instance: Database;

  private constructor() {}

  static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }
}
```

**2. 工厂模式（Factory）**

```typescript
interface Logger {
  log(message: string): void;
}

class FileLogger implements Logger {
  log(message: string) {
    fs.appendFileSync('app.log', message);
  }
}

class ConsoleLogger implements Logger {
  log(message: string) {
    console.log(message);
  }
}

class LoggerFactory {
  static create(type: 'file' | 'console'): Logger {
    if (type === 'file') return new FileLogger();
    if (type === 'console') return new ConsoleLogger();
    throw new Error('Unknown logger type');
  }
}
```

### 结构型模式

**3. 适配器模式（Adapter）**

```typescript
// 旧接口
class OldPaymentAPI {
  makePayment(amount: number) { /* ... */ }
}

// 新接口
interface PaymentService {
  process(amount: number): void;
}

// 适配器
class PaymentAdapter implements PaymentService {
  constructor(private oldAPI: OldPaymentAPI) {}

  process(amount: number) {
    this.oldAPI.makePayment(amount);
  }
}
```

**4. 装饰器模式（Decorator）**

```typescript
interface Coffee {
  cost(): number;
  description(): string;
}

class SimpleCoffee implements Coffee {
  cost() { return 10; }
  description() { return 'Simple coffee'; }
}

class MilkDecorator implements Coffee {
  constructor(private coffee: Coffee) {}

  cost() { return this.coffee.cost() + 2; }
  description() { return this.coffee.description() + ', milk'; }
}

const coffee = new MilkDecorator(new SimpleCoffee());
console.log(coffee.cost()); // 12
```

### 行为型模式

**5. 策略模式（Strategy）**

```typescript
interface SortStrategy {
  sort(data: number[]): number[];
}

class BubbleSort implements SortStrategy {
  sort(data: number[]) { /* ... */ }
}

class QuickSort implements SortStrategy {
  sort(data: number[]) { /* ... */ }
}

class Sorter {
  constructor(private strategy: SortStrategy) {}

  sort(data: number[]) {
    return this.strategy.sort(data);
  }
}
```

## 系统设计考虑

### 可扩展性（Scalability）

- **水平扩展** - 增加服务器数量
- **垂直扩展** - 增加单机性能
- **数据库分片** - Sharding
- **缓存** - Redis、CDN
- **负载均衡** - Nginx、HAProxy

### 可靠性（Reliability）

- **冗余** - 多副本、多可用区
- **故障转移** - Failover
- **健康检查** - Health checks
- **断路器** - Circuit breaker
- **重试机制** - Exponential backoff

### 可维护性（Maintainability）

- **代码质量** - 遵循 SOLID
- **测试覆盖** - 单元、集成、E2E
- **文档** - README、API docs
- **监控** - Logging、Metrics、Tracing
- **CI/CD** - 自动化部署

## 参考资料

- [Clean Architecture by Robert C. Martin](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Design Patterns by Gang of Four](https://refactoring.guru/design-patterns)
- [SOLID Principles](https://en.wikipedia.org/wiki/SOLID)
