---
name: Redis Integration
slug: redis-integration
description: Spring Boot集成Redis，涵盖缓存、Session、分布式锁、消息队列等场景
version: 1.0.0
category: development
author: System
tags: [redis, spring-boot, cache, distributed-lock, session]
estimatedTokens: 1800
---

# Redis Integration Guide

Spring Boot集成Redis最佳实践。

## 配置

**依赖**：
```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>

<!-- 使用Lettuce（推荐） -->
<dependency>
    <groupId>io.lettuce</groupId>
    <artifactId>lettuce-core</artifactId>
</dependency>

<!-- 或使用Jedis -->
<dependency>
    <groupId>redis.clients</groupId>
    <artifactId>jedis</artifactId>
</dependency>

<!-- 对象序列化（可选） -->
<dependency>
    <groupId>com.fasterxml.jackson.core</groupId>
    <artifactId>jackson-databind</artifactId>
</dependency>
```

**配置文件**：
```yaml
spring:
  redis:
    host: localhost
    port: 6379
    password: ${REDIS_PASSWORD:}
    database: 0
    timeout: 3000ms

    # Lettuce连接池配置
    lettuce:
      pool:
        max-active: 8
        max-idle: 8
        min-idle: 0
        max-wait: -1ms

    # Jedis连接池配置
    jedis:
      pool:
        max-active: 8
        max-idle: 8
        min-idle: 0
        max-wait: -1ms

  # 缓存配置
  cache:
    type: redis
    redis:
      time-to-live: 600000  # 10分钟
      cache-null-values: true
```

## Redis配置类

**基础配置**：
```java
@Configuration
@EnableCaching
public class RedisConfig {

    @Bean
    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory factory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(factory);

        // String序列化
        StringRedisSerializer stringSerializer = new StringRedisSerializer();

        // JSON序列化
        Jackson2JsonRedisSerializer<Object> jsonSerializer = new Jackson2JsonRedisSerializer<>(Object.class);
        ObjectMapper om = new ObjectMapper();
        om.setVisibility(PropertyAccessor.ALL, JsonAutoDetect.Visibility.ANY);
        om.activateDefaultTyping(LaissezFaireSubTypeValidator.instance, ObjectMapper.DefaultTyping.NON_FINAL);
        jsonSerializer.setObjectMapper(om);

        // key采用String序列化
        template.setKeySerializer(stringSerializer);
        template.setHashKeySerializer(stringSerializer);

        // value采用JSON序列化
        template.setValueSerializer(jsonSerializer);
        template.setHashValueSerializer(jsonSerializer);

        template.afterPropertiesSet();
        return template;
    }

    @Bean
    public CacheManager cacheManager(RedisConnectionFactory factory) {
        RedisCacheConfiguration config = RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(10))
            .serializeKeysWith(RedisSerializationContext.SerializationPair.fromSerializer(new StringRedisSerializer()))
            .serializeValuesWith(RedisSerializationContext.SerializationPair.fromSerializer(new GenericJackson2JsonRedisSerializer()))
            .disableCachingNullValues();

        return RedisCacheManager.builder(factory)
            .cacheDefaults(config)
            .build();
    }
}
```

## 基本操作

### 1. String类型

```java
@Service
@RequiredArgsConstructor
public class RedisService {
    private final RedisTemplate<String, Object> redisTemplate;
    private final StringRedisTemplate stringRedisTemplate;

    // 设置值
    public void set(String key, Object value) {
        redisTemplate.opsForValue().set(key, value);
    }

    // 设置值（带过期时间）
    public void set(String key, Object value, long timeout, TimeUnit unit) {
        redisTemplate.opsForValue().set(key, value, timeout, unit);
    }

    // 获取值
    public Object get(String key) {
        return redisTemplate.opsForValue().get(key);
    }

    // 删除
    public Boolean delete(String key) {
        return redisTemplate.delete(key);
    }

    // 批量删除
    public Long delete(Collection<String> keys) {
        return redisTemplate.delete(keys);
    }

    // 设置过期时间
    public Boolean expire(String key, long timeout, TimeUnit unit) {
        return redisTemplate.expire(key, timeout, unit);
    }

    // 获取过期时间
    public Long getExpire(String key) {
        return redisTemplate.getExpire(key);
    }

    // 判断是否存在
    public Boolean hasKey(String key) {
        return redisTemplate.hasKey(key);
    }

    // 自增
    public Long increment(String key, long delta) {
        return redisTemplate.opsForValue().increment(key, delta);
    }

    // 自减
    public Long decrement(String key, long delta) {
        return redisTemplate.opsForValue().decrement(key, delta);
    }
}
```

### 2. Hash类型

```java
@Service
@RequiredArgsConstructor
public class RedisHashService {
    private final RedisTemplate<String, Object> redisTemplate;

    // 设置Hash字段
    public void hSet(String key, String hashKey, Object value) {
        redisTemplate.opsForHash().put(key, hashKey, value);
    }

    // 批量设置
    public void hSetAll(String key, Map<String, Object> map) {
        redisTemplate.opsForHash().putAll(key, map);
    }

    // 获取Hash字段
    public Object hGet(String key, String hashKey) {
        return redisTemplate.opsForHash().get(key, hashKey);
    }

    // 获取所有字段
    public Map<Object, Object> hGetAll(String key) {
        return redisTemplate.opsForHash().entries(key);
    }

    // 删除Hash字段
    public Long hDelete(String key, Object... hashKeys) {
        return redisTemplate.opsForHash().delete(key, hashKeys);
    }

    // 判断字段是否存在
    public Boolean hHasKey(String key, String hashKey) {
        return redisTemplate.opsForHash().hasKey(key, hashKey);
    }

    // Hash字段自增
    public Long hIncrement(String key, String hashKey, long delta) {
        return redisTemplate.opsForHash().increment(key, hashKey, delta);
    }
}
```

### 3. List类型

```java
@Service
@RequiredArgsConstructor
public class RedisListService {
    private final RedisTemplate<String, Object> redisTemplate;

    // 左侧推入
    public Long lPush(String key, Object value) {
        return redisTemplate.opsForList().leftPush(key, value);
    }

    // 批量左侧推入
    public Long lPushAll(String key, Object... values) {
        return redisTemplate.opsForList().leftPushAll(key, values);
    }

    // 右侧推入
    public Long rPush(String key, Object value) {
        return redisTemplate.opsForList().rightPush(key, value);
    }

    // 左侧弹出
    public Object lPop(String key) {
        return redisTemplate.opsForList().leftPop(key);
    }

    // 右侧弹出
    public Object rPop(String key) {
        return redisTemplate.opsForList().rightPop(key);
    }

    // 获取范围内的元素
    public List<Object> lRange(String key, long start, long end) {
        return redisTemplate.opsForList().range(key, start, end);
    }

    // 获取列表长度
    public Long lSize(String key) {
        return redisTemplate.opsForList().size(key);
    }

    // 根据索引获取元素
    public Object lIndex(String key, long index) {
        return redisTemplate.opsForList().index(key, index);
    }
}
```

### 4. Set类型

```java
@Service
@RequiredArgsConstructor
public class RedisSetService {
    private final RedisTemplate<String, Object> redisTemplate;

    // 添加元素
    public Long sAdd(String key, Object... values) {
        return redisTemplate.opsForSet().add(key, values);
    }

    // 移除元素
    public Long sRemove(String key, Object... values) {
        return redisTemplate.opsForSet().remove(key, values);
    }

    // 判断是否是成员
    public Boolean sIsMember(String key, Object value) {
        return redisTemplate.opsForSet().isMember(key, value);
    }

    // 获取所有成员
    public Set<Object> sMembers(String key) {
        return redisTemplate.opsForSet().members(key);
    }

    // 获取集合大小
    public Long sSize(String key) {
        return redisTemplate.opsForSet().size(key);
    }

    // 随机获取一个成员
    public Object sRandomMember(String key) {
        return redisTemplate.opsForSet().randomMember(key);
    }
}
```

### 5. ZSet类型

```java
@Service
@RequiredArgsConstructor
public class RedisZSetService {
    private final RedisTemplate<String, Object> redisTemplate;

    // 添加元素
    public Boolean zAdd(String key, Object value, double score) {
        return redisTemplate.opsForZSet().add(key, value, score);
    }

    // 移除元素
    public Long zRemove(String key, Object... values) {
        return redisTemplate.opsForZSet().remove(key, values);
    }

    // 增加分数
    public Double zIncrementScore(String key, Object value, double delta) {
        return redisTemplate.opsForZSet().incrementScore(key, value, delta);
    }

    // 获取排名（从小到大）
    public Long zRank(String key, Object value) {
        return redisTemplate.opsForZSet().rank(key, value);
    }

    // 获取范围内的元素（从小到大）
    public Set<Object> zRange(String key, long start, long end) {
        return redisTemplate.opsForZSet().range(key, start, end);
    }

    // 根据分数范围获取元素
    public Set<Object> zRangeByScore(String key, double min, double max) {
        return redisTemplate.opsForZSet().rangeByScore(key, min, max);
    }

    // 获取集合大小
    public Long zSize(String key) {
        return redisTemplate.opsForZSet().size(key);
    }
}
```

## 缓存注解

```java
@Service
@RequiredArgsConstructor
@CacheConfig(cacheNames = "users")
public class UserService {
    private final UserRepository userRepository;

    // 缓存结果
    @Cacheable(key = "#id")
    public User getUserById(Long id) {
        return userRepository.findById(id).orElse(null);
    }

    // 多个条件
    @Cacheable(key = "#username + ':' + #email")
    public User findByUsernameAndEmail(String username, String email) {
        return userRepository.findByUsernameAndEmail(username, email);
    }

    // 条件缓存
    @Cacheable(key = "#id", condition = "#id > 0", unless = "#result == null")
    public User getUser(Long id) {
        return userRepository.findById(id).orElse(null);
    }

    // 更新缓存
    @CachePut(key = "#user.id")
    public User updateUser(User user) {
        return userRepository.save(user);
    }

    // 清除缓存
    @CacheEvict(key = "#id")
    public void deleteUser(Long id) {
        userRepository.deleteById(id);
    }

    // 清除所有缓存
    @CacheEvict(allEntries = true)
    public void deleteAllUsers() {
        userRepository.deleteAll();
    }

    // 组合多个缓存操作
    @Caching(
        evict = {
            @CacheEvict(key = "#id"),
            @CacheEvict(cacheNames = "userList", allEntries = true)
        }
    )
    public void delete(Long id) {
        userRepository.deleteById(id);
    }
}
```

## 分布式锁

```java
@Component
@RequiredArgsConstructor
public class RedisLockService {
    private final StringRedisTemplate redisTemplate;

    /**
     * 尝试获取锁
     */
    public boolean tryLock(String key, String value, long timeout, TimeUnit unit) {
        Boolean result = redisTemplate.opsForValue()
            .setIfAbsent(key, value, timeout, unit);
        return Boolean.TRUE.equals(result);
    }

    /**
     * 释放锁（使用Lua脚本保证原子性）
     */
    public boolean releaseLock(String key, String value) {
        String script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

        Long result = redisTemplate.execute(
            new DefaultRedisScript<>(script, Long.class),
            Collections.singletonList(key),
            value
        );

        return Long.valueOf(1).equals(result);
    }

    /**
     * 使用分布式锁执行任务
     */
    public <T> T executeWithLock(String lockKey, long timeout, TimeUnit unit, Supplier<T> task) {
        String lockValue = UUID.randomUUID().toString();

        try {
            // 尝试获取锁
            if (!tryLock(lockKey, lockValue, timeout, unit)) {
                throw new RuntimeException("获取锁失败");
            }

            // 执行任务
            return task.get();
        } finally {
            // 释放锁
            releaseLock(lockKey, lockValue);
        }
    }
}

// 使用示例
@Service
@RequiredArgsConstructor
public class OrderService {
    private final RedisLockService lockService;

    public void createOrder(Long productId) {
        String lockKey = "order:product:" + productId;

        lockService.executeWithLock(lockKey, 10, TimeUnit.SECONDS, () -> {
            // 执行业务逻辑
            System.out.println("创建订单");
            return null;
        });
    }
}
```

## Session共享

```java
@Configuration
@EnableRedisHttpSession(maxInactiveIntervalInSeconds = 1800)
public class SessionConfig {
    // Spring Session会自动配置
}

// 使用Session
@RestController
@RequestMapping("/api")
public class SessionController {

    @GetMapping("/login")
    public String login(HttpSession session) {
        session.setAttribute("user", "john");
        return "登录成功";
    }

    @GetMapping("/user")
    public String getUser(HttpSession session) {
        return (String) session.getAttribute("user");
    }

    @GetMapping("/logout")
    public String logout(HttpSession session) {
        session.invalidate();
        return "已退出";
    }
}
```

## 发布订阅

```java
@Configuration
public class RedisPubSubConfig {

    @Bean
    public RedisMessageListenerContainer container(
            RedisConnectionFactory factory,
            MessageListenerAdapter listenerAdapter) {

        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(factory);
        container.addMessageListener(listenerAdapter, new PatternTopic("order:*"));
        return container;
    }

    @Bean
    public MessageListenerAdapter listenerAdapter(RedisMessageListener listener) {
        return new MessageListenerAdapter(listener, "onMessage");
    }
}

@Component
@Slf4j
public class RedisMessageListener {

    public void onMessage(Message message, byte[] pattern) {
        String channel = new String(message.getChannel());
        String body = new String(message.getBody());
        log.info("收到消息 - 频道: {}, 内容: {}", channel, body);
    }
}

// 发布消息
@Service
@RequiredArgsConstructor
public class MessagePublisher {
    private final RedisTemplate<String, Object> redisTemplate;

    public void publish(String channel, Object message) {
        redisTemplate.convertAndSend(channel, message);
    }
}
```

## 最佳实践

- [ ] 合理设置过期时间，避免内存溢出
- [ ] 使用连接池管理连接
- [ ] 序列化选择JSON而非JDK序列化
- [ ] 分布式锁使用Lua脚本保证原子性
- [ ] 缓存雪崩使用随机过期时间
- [ ] 缓存穿透使用布隆过滤器
- [ ] 缓存击穿使用互斥锁
- [ ] Key命名规范：业务:类型:ID
- [ ] 批量操作使用Pipeline
- [ ] 生产环境禁用KEYS命令

## 常见问题

**Q: Lettuce vs Jedis？**
A: Lettuce是异步、基于Netty，Jedis是同步、阻塞IO。推荐Lettuce。

**Q: 如何避免缓存穿透？**
A: 1) 缓存空值 2) 布隆过滤器 3) 接口限流。

**Q: 分布式锁的问题？**
A: 1) 过期时间设置 2) 续期机制 3) Redisson更完善。

遵循这些实践，高效使用Redis提升系统性能。
