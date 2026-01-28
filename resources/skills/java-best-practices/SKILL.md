---
name: Java Best Practices
slug: java-best-practices
description: Java代码规范和最佳实践指南，涵盖命名、异常处理、集合使用、并发编程等核心领域
version: 1.0.0
category: development
author: System
tags: [java, best-practices, code-quality, clean-code]
estimatedTokens: 1200
---

# Java Best Practices

Java开发最佳实践和代码规范指南。

## 核心原则

### 1. 命名规范
- **类名**: 使用大驼峰（PascalCase）
  ```java
  // ✅ 好的命名
  public class UserService {}
  public class OrderRepository {}

  // ❌ 避免
  public class userservice {}
  public class order_repo {}
  ```

- **方法名**: 使用小驼峰（camelCase），动词开头
  ```java
  // ✅ 好的命名
  public void calculateTotal() {}
  public User findUserById(Long id) {}
  public boolean isActive() {}

  // ❌ 避免
  public void Total() {}
  public User user(Long id) {}
  ```

- **常量**: 全大写，下划线分隔
  ```java
  // ✅ 好的命名
  public static final int MAX_RETRY_COUNT = 3;
  public static final String DEFAULT_ENCODING = "UTF-8";
  ```

- **变量**: 有意义的名称，避免单字母（除循环）
  ```java
  // ✅ 好的命名
  List<User> activeUsers = ...;
  int totalAmount = ...;

  // ❌ 避免
  List<User> list = ...;
  int t = ...;
  ```

### 2. 异常处理

**永远不要捕获后忽略**：
```java
// ❌ 绝对禁止
try {
    riskyOperation();
} catch (Exception e) {
    // 什么都不做
}

// ✅ 至少记录日志
try {
    riskyOperation();
} catch (Exception e) {
    log.error("操作失败", e);
    throw new BusinessException("业务操作失败", e);
}
```

**使用特定异常**：
```java
// ❌ 避免捕获所有异常
try {
    ...
} catch (Exception e) {
    ...
}

// ✅ 捕获特定异常
try {
    ...
} catch (IOException e) {
    ...
} catch (SQLException e) {
    ...
}
```

**自定义业务异常**：
```java
// ✅ 创建业务异常
public class UserNotFoundException extends RuntimeException {
    public UserNotFoundException(Long userId) {
        super("用户不存在: " + userId);
    }
}
```

### 3. 资源管理

**使用 try-with-resources**：
```java
// ✅ 自动关闭资源
try (BufferedReader reader = new BufferedReader(new FileReader("file.txt"))) {
    return reader.readLine();
}

// ❌ 手动关闭（容易忘记）
BufferedReader reader = null;
try {
    reader = new BufferedReader(new FileReader("file.txt"));
    return reader.readLine();
} finally {
    if (reader != null) {
        reader.close();
    }
}
```

### 4. 集合使用

**使用接口类型声明**：
```java
// ✅ 使用接口
List<String> names = new ArrayList<>();
Map<String, Integer> scores = new HashMap<>();

// ❌ 使用实现类
ArrayList<String> names = new ArrayList<>();
HashMap<String, Integer> scores = new HashMap<>();
```

**避免空指针 - 返回空集合**：
```java
// ✅ 返回空集合
public List<User> getUsers() {
    if (noUsers) {
        return Collections.emptyList();
    }
    return users;
}

// ❌ 返回null
public List<User> getUsers() {
    if (noUsers) {
        return null; // 调用者需要null检查
    }
    return users;
}
```

**使用Stream API简化集合操作**：
```java
// ✅ 使用Stream
List<String> activeUserNames = users.stream()
    .filter(User::isActive)
    .map(User::getName)
    .collect(Collectors.toList());

// ❌ 传统循环（对于简单操作）
List<String> activeUserNames = new ArrayList<>();
for (User user : users) {
    if (user.isActive()) {
        activeUserNames.add(user.getName());
    }
}
```

### 5. 字符串处理

**使用StringBuilder进行拼接**：
```java
// ✅ 循环中使用StringBuilder
StringBuilder sb = new StringBuilder();
for (String item : items) {
    sb.append(item).append(", ");
}

// ❌ 循环中使用+拼接
String result = "";
for (String item : items) {
    result += item + ", "; // 每次创建新String对象
}
```

**使用String.format或printf**：
```java
// ✅ 使用格式化
String message = String.format("用户 %s 的余额为 %.2f", username, balance);

// ❌ 手动拼接
String message = "用户 " + username + " 的余额为 " + balance;
```

### 6. 空值处理

**使用Optional避免null**：
```java
// ✅ 使用Optional
public Optional<User> findUserById(Long id) {
    return Optional.ofNullable(userRepository.findById(id));
}

// 调用方
userService.findUserById(id)
    .ifPresent(user -> {
        // 处理用户
    });
```

**使用Objects工具类**：
```java
// ✅ 使用Objects
Objects.requireNonNull(user, "用户不能为空");
boolean equals = Objects.equals(a, b); // 安全比较
```

### 7. 并发编程

**优先使用java.util.concurrent**：
```java
// ✅ 使用线程池
ExecutorService executor = Executors.newFixedThreadPool(10);
executor.submit(() -> {
    // 任务
});

// ❌ 直接创建Thread
new Thread(() -> {
    // 任务
}).start();
```

**使用线程安全集合**：
```java
// ✅ 线程安全
Map<String, Integer> map = new ConcurrentHashMap<>();
List<String> list = new CopyOnWriteArrayList<>();

// ❌ 非线程安全
Map<String, Integer> map = new HashMap<>(); // 多线程使用会出问题
```

### 8. 方法设计

**单一职责**：
```java
// ✅ 职责单一
public User saveUser(User user) {
    return userRepository.save(user);
}

public void sendWelcomeEmail(User user) {
    emailService.send(user.getEmail(), "欢迎");
}

// ❌ 职责混杂
public User saveUserAndSendEmail(User user) {
    User saved = userRepository.save(user);
    emailService.send(user.getEmail(), "欢迎");
    return saved;
}
```

**参数数量限制**：
```java
// ✅ 使用对象封装多个参数
public void createOrder(OrderRequest request) {
    // request包含所有参数
}

// ❌ 参数过多
public void createOrder(Long userId, String productId,
                       int quantity, String address,
                       String phone, String coupon) {
    // 太多参数
}
```

### 9. 日志记录

**使用SLF4J + Logback**：
```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class UserService {
    private static final Logger log = LoggerFactory.getLogger(UserService.class);

    public void processUser(User user) {
        log.info("开始处理用户: {}", user.getId());
        try {
            // 处理逻辑
            log.debug("用户处理详情: {}", user);
        } catch (Exception e) {
            log.error("用户处理失败: {}", user.getId(), e);
        }
    }
}
```

**日志级别使用**：
- ERROR: 错误和异常
- WARN: 警告信息
- INFO: 关键业务流程
- DEBUG: 详细调试信息
- TRACE: 最详细的追踪

### 10. 代码可读性

**使用有意义的注释**：
```java
// ✅ 解释为什么这样做
// 使用缓存避免频繁查询数据库，缓存时间5分钟
@Cacheable(value = "users", key = "#id")
public User getUserById(Long id) {
    return userRepository.findById(id);
}

// ❌ 无意义注释
// 获取用户
public User getUser(Long id) { ... }
```

**提取常量和方法**：
```java
// ✅ 提取魔法数字
private static final int MAX_LOGIN_ATTEMPTS = 3;
private static final long SESSION_TIMEOUT_MINUTES = 30;

if (attempts > MAX_LOGIN_ATTEMPTS) {
    lockAccount();
}

// ❌ 魔法数字
if (attempts > 3) {
    lockAccount();
}
```

## 检查清单

审查Java代码时，检查以下方面：

- [ ] 命名是否符合规范（类、方法、变量、常量）
- [ ] 是否正确处理异常（不忽略、使用特定异常）
- [ ] 资源是否正确关闭（使用try-with-resources）
- [ ] 集合声明是否使用接口类型
- [ ] 是否避免返回null（返回空集合或Optional）
- [ ] 字符串拼接是否使用StringBuilder
- [ ] 是否使用了线程安全的类（多线程环境）
- [ ] 方法是否职责单一
- [ ] 参数数量是否合理（不超过4个）
- [ ] 是否有适当的日志记录
- [ ] 代码是否易读（有意义的注释、提取常量）

## 常见问题

**Q: 什么时候使用checked exception？**
A: 尽量使用RuntimeException。Checked exception会污染方法签名，只在调用者必须处理的情况下使用。

**Q: == 和 equals 的区别？**
A: `==` 比较引用，`equals()` 比较内容。字符串和对象比较总是用 `equals()`。

**Q: 什么时候用ArrayList vs LinkedList？**
A: 大部分情况用ArrayList。只在频繁插入/删除中间元素时考虑LinkedList。

## 推荐工具

- **CheckStyle**: 代码规范检查
- **PMD**: 代码质量分析
- **SpotBugs**: Bug检测
- **SonarQube**: 代码质量平台

遵循这些最佳实践，可以编写出高质量、易维护的Java代码。
