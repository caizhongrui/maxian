---
name: Spring Boot Development
slug: spring-boot
description: Spring Boot微服务开发最佳实践，涵盖依赖注入、配置管理、REST API、数据访问等核心功能
version: 1.0.0
category: development
author: System
tags: [spring-boot, microservices, rest-api, dependency-injection]
estimatedTokens: 1500
---

# Spring Boot Development Guide

Spring Boot微服务开发最佳实践指南。

## 核心概念

### 1. 依赖注入 (DI)

**使用构造器注入（推荐）**：
```java
@Service
public class UserService {
    private final UserRepository userRepository;
    private final EmailService emailService;

    // ✅ 构造器注入 - 不可变、易测试
    public UserService(UserRepository userRepository,
                      EmailService emailService) {
        this.userRepository = userRepository;
        this.emailService = emailService;
    }
}
```

**避免字段注入**：
```java
// ❌ 字段注入 - 难以测试、隐藏依赖
@Service
public class UserService {
    @Autowired
    private UserRepository userRepository;

    @Autowired
    private EmailService emailService;
}
```

**使用@RequiredArgsConstructor（Lombok）**：
```java
@Service
@RequiredArgsConstructor
public class UserService {
    private final UserRepository userRepository;
    private final EmailService emailService;
    // Lombok自动生成构造器
}
```

### 2. Controller层设计

**RESTful API最佳实践**：
```java
@RestController
@RequestMapping("/api/v1/users")
@RequiredArgsConstructor
public class UserController {
    private final UserService userService;

    // ✅ 使用合适的HTTP方法和状态码
    @GetMapping
    public ResponseEntity<List<User>> getAllUsers() {
        return ResponseEntity.ok(userService.findAll());
    }

    @GetMapping("/{id}")
    public ResponseEntity<User> getUserById(@PathVariable Long id) {
        return userService.findById(id)
            .map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<User> createUser(@Valid @RequestBody UserRequest request) {
        User created = userService.create(request);
        URI location = ServletUriComponentsBuilder
            .fromCurrentRequest()
            .path("/{id}")
            .buildAndExpand(created.getId())
            .toUri();
        return ResponseEntity.created(location).body(created);
    }

    @PutMapping("/{id}")
    public ResponseEntity<User> updateUser(
            @PathVariable Long id,
            @Valid @RequestBody UserRequest request) {
        return ResponseEntity.ok(userService.update(id, request));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteUser(@PathVariable Long id) {
        userService.delete(id);
    }
}
```

**请求验证**：
```java
public class UserRequest {
    @NotBlank(message = "用户名不能为空")
    @Size(min = 3, max = 20, message = "用户名长度必须在3-20之间")
    private String username;

    @NotBlank(message = "邮箱不能为空")
    @Email(message = "邮箱格式不正确")
    private String email;

    @NotNull(message = "年龄不能为空")
    @Min(value = 18, message = "年龄必须大于18")
    private Integer age;
}
```

### 3. Service层设计

**事务管理**：
```java
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true) // 默认只读
public class UserService {
    private final UserRepository userRepository;

    // ✅ 写操作使用@Transactional
    @Transactional
    public User create(UserRequest request) {
        User user = new User();
        user.setUsername(request.getUsername());
        user.setEmail(request.getEmail());
        return userRepository.save(user);
    }

    // 只读操作使用类级别的readOnly=true
    public Optional<User> findById(Long id) {
        return userRepository.findById(id);
    }

    // ✅ 批量操作在一个事务中
    @Transactional
    public void batchUpdate(List<User> users) {
        userRepository.saveAll(users);
    }
}
```

**业务异常处理**：
```java
// 自定义业务异常
public class UserNotFoundException extends RuntimeException {
    public UserNotFoundException(Long id) {
        super("用户不存在: " + id);
    }
}

// Service中抛出业务异常
@Transactional
public User update(Long id, UserRequest request) {
    User user = userRepository.findById(id)
        .orElseThrow(() -> new UserNotFoundException(id));

    user.setUsername(request.getUsername());
    return userRepository.save(user);
}
```

### 4. 全局异常处理

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleUserNotFound(UserNotFoundException ex) {
        ErrorResponse error = new ErrorResponse(
            HttpStatus.NOT_FOUND.value(),
            ex.getMessage(),
            LocalDateTime.now()
        );
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(
            MethodArgumentNotValidException ex) {
        Map<String, String> errors = new HashMap<>();
        ex.getBindingResult().getFieldErrors().forEach(error ->
            errors.put(error.getField(), error.getDefaultMessage())
        );

        ErrorResponse error = new ErrorResponse(
            HttpStatus.BAD_REQUEST.value(),
            "验证失败",
            LocalDateTime.now(),
            errors
        );
        return ResponseEntity.badRequest().body(error);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleGeneral(Exception ex) {
        ErrorResponse error = new ErrorResponse(
            HttpStatus.INTERNAL_SERVER_ERROR.value(),
            "服务器内部错误",
            LocalDateTime.now()
        );
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error);
    }
}
```

### 5. 配置管理

**application.yml结构**：
```yaml
spring:
  application:
    name: user-service

  datasource:
    url: jdbc:mysql://localhost:3306/mydb
    username: ${DB_USERNAME:root}
    password: ${DB_PASSWORD:password}
    driver-class-name: com.mysql.cj.jdbc.Driver

  jpa:
    hibernate:
      ddl-auto: validate  # 生产环境使用validate
    show-sql: false
    properties:
      hibernate:
        format_sql: true
        default_batch_fetch_size: 10

  redis:
    host: ${REDIS_HOST:localhost}
    port: ${REDIS_PORT:6379}

server:
  port: 8080

logging:
  level:
    root: INFO
    com.yourpackage: DEBUG
```

**使用@ConfigurationProperties**：
```java
@Component
@ConfigurationProperties(prefix = "app")
@Validated
@Data
public class AppProperties {
    @NotBlank
    private String name;

    @Min(1)
    @Max(100)
    private int maxUploadSize;

    private Security security = new Security();

    @Data
    public static class Security {
        private String jwtSecret;
        private long jwtExpiration;
    }
}

// 使用
@Service
@RequiredArgsConstructor
public class SomeService {
    private final AppProperties appProperties;

    public void doSomething() {
        String secret = appProperties.getSecurity().getJwtSecret();
    }
}
```

### 6. Repository层

**使用Spring Data JPA**：
```java
@Repository
public interface UserRepository extends JpaRepository<User, Long> {

    // ✅ 使用方法名查询
    Optional<User> findByUsername(String username);

    List<User> findByAgeGreaterThan(Integer age);

    boolean existsByEmail(String email);

    // ✅ 使用@Query进行复杂查询
    @Query("SELECT u FROM User u WHERE u.email = :email AND u.active = true")
    Optional<User> findActiveUserByEmail(@Param("email") String email);

    // ✅ 原生SQL查询
    @Query(value = "SELECT * FROM users WHERE created_at > :date",
           nativeQuery = true)
    List<User> findUsersCreatedAfter(@Param("date") LocalDateTime date);

    // ✅ 分页查询
    Page<User> findByActive(boolean active, Pageable pageable);
}
```

**自定义Repository实现**：
```java
public interface CustomUserRepository {
    List<User> searchUsers(UserSearchCriteria criteria);
}

@Repository
public class CustomUserRepositoryImpl implements CustomUserRepository {
    @PersistenceContext
    private EntityManager entityManager;

    @Override
    public List<User> searchUsers(UserSearchCriteria criteria) {
        CriteriaBuilder cb = entityManager.getCriteriaBuilder();
        CriteriaQuery<User> query = cb.createQuery(User.class);
        Root<User> root = query.from(User.class);

        // 动态构建查询条件
        List<Predicate> predicates = new ArrayList<>();

        if (criteria.getUsername() != null) {
            predicates.add(cb.like(root.get("username"), "%" + criteria.getUsername() + "%"));
        }

        if (criteria.getMinAge() != null) {
            predicates.add(cb.greaterThanOrEqualTo(root.get("age"), criteria.getMinAge()));
        }

        query.where(predicates.toArray(new Predicate[0]));

        return entityManager.createQuery(query).getResultList();
    }
}
```

### 7. 缓存策略

```java
@Service
@RequiredArgsConstructor
public class UserService {
    private final UserRepository userRepository;

    // ✅ 缓存查询结果
    @Cacheable(value = "users", key = "#id")
    public Optional<User> findById(Long id) {
        return userRepository.findById(id);
    }

    // ✅ 更新时清除缓存
    @CacheEvict(value = "users", key = "#user.id")
    public User update(User user) {
        return userRepository.save(user);
    }

    // ✅ 清除所有缓存
    @CacheEvict(value = "users", allEntries = true)
    public void clearCache() {
        // 缓存已清除
    }

    // ✅ 更新缓存
    @CachePut(value = "users", key = "#result.id")
    public User create(User user) {
        return userRepository.save(user);
    }
}

// 启用缓存
@Configuration
@EnableCaching
public class CacheConfig {
    // 配置缓存管理器
}
```

### 8. 异步处理

```java
@Configuration
@EnableAsync
public class AsyncConfig {
    @Bean(name = "taskExecutor")
    public Executor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(5);
        executor.setMaxPoolSize(10);
        executor.setQueueCapacity(100);
        executor.setThreadNamePrefix("async-");
        executor.initialize();
        return executor;
    }
}

@Service
@RequiredArgsConstructor
public class NotificationService {

    @Async("taskExecutor")
    public CompletableFuture<Void> sendEmailAsync(String to, String content) {
        // 发送邮件
        return CompletableFuture.completedFuture(null);
    }
}
```

### 9. 定时任务

```java
@Configuration
@EnableScheduling
public class SchedulingConfig {}

@Component
@RequiredArgsConstructor
public class ScheduledTasks {
    private final UserService userService;

    // 每天凌晨2点执行
    @Scheduled(cron = "0 0 2 * * ?")
    public void cleanupInactiveUsers() {
        userService.deleteInactiveUsers();
    }

    // 每5分钟执行
    @Scheduled(fixedRate = 300000)
    public void updateCache() {
        userService.refreshCache();
    }

    // 延迟5秒，然后每10秒执行
    @Scheduled(initialDelay = 5000, fixedDelay = 10000)
    public void checkStatus() {
        // 检查状态
    }
}
```

### 10. 测试

**单元测试**：
```java
@ExtendWith(MockitoExtension.class)
class UserServiceTest {
    @Mock
    private UserRepository userRepository;

    @InjectMocks
    private UserService userService;

    @Test
    void shouldCreateUser() {
        // Given
        UserRequest request = new UserRequest("test", "test@example.com");
        User user = new User();
        user.setId(1L);

        when(userRepository.save(any(User.class))).thenReturn(user);

        // When
        User created = userService.create(request);

        // Then
        assertNotNull(created.getId());
        verify(userRepository).save(any(User.class));
    }
}
```

**集成测试**：
```java
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class UserControllerIntegrationTest {
    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Test
    void shouldGetUserById() throws Exception {
        // Given
        User user = new User();
        user.setUsername("test");
        user = userRepository.save(user);

        // When & Then
        mockMvc.perform(get("/api/v1/users/" + user.getId()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.username").value("test"));
    }
}
```

## 最佳实践检查清单

- [ ] 使用构造器注入而非字段注入
- [ ] Controller只负责请求响应，业务逻辑在Service
- [ ] 使用@Valid进行请求验证
- [ ] 正确使用HTTP方法和状态码
- [ ] Service层标注@Transactional
- [ ] 实现全局异常处理
- [ ] 配置使用@ConfigurationProperties
- [ ] Repository使用Spring Data JPA
- [ ] 合理使用缓存
- [ ] 异步任务使用线程池
- [ ] 编写单元测试和集成测试

## 常见问题

**Q: @Autowired vs 构造器注入？**
A: 优先使用构造器注入。不可变、易测试、明确依赖。

**Q: 何时使用@Transactional？**
A: 所有涉及数据库写操作的Service方法。类级别用readOnly=true，写方法单独标注@Transactional。

**Q: JPA懒加载问题？**
A: 使用@EntityGraph或fetch join，或在Service层处理完所有懒加载属性。

遵循这些实践，可以构建高质量的Spring Boot微服务应用。
