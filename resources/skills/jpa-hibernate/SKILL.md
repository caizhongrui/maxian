---
name: JPA & Hibernate
slug: jpa-hibernate
description: JPA和Hibernate数据访问最佳实践，涵盖实体映射、关系处理、查询优化、性能调优
version: 1.0.0
category: database
author: System
tags: [jpa, hibernate, database, orm, persistence]
estimatedTokens: 1300
---

# JPA & Hibernate Best Practices

JPA和Hibernate数据访问层最佳实践指南。

## 实体映射

### 1. 基本实体定义

```java
@Entity
@Table(name = "users")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "username", nullable = false, unique = true, length = 50)
    private String username;

    @Column(name = "email", nullable = false, unique = true)
    private String email;

    @Column(name = "age")
    private Integer age;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
```

### 2. 主键策略

```java
// ✅ 推荐：数据库自增
@Id
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;

// ✅ UUID（分布式系统）
@Id
@GeneratedValue(generator = "UUID")
@GenericGenerator(name = "UUID", strategy = "org.hibernate.id.UUIDGenerator")
@Column(updatable = false, nullable = false)
private UUID id;

// ✅ 序列（PostgreSQL等）
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "user_seq")
@SequenceGenerator(name = "user_seq", sequenceName = "user_sequence", allocationSize = 1)
private Long id;

// ❌ 避免：AUTO（行为不明确）
@GeneratedValue(strategy = GenerationType.AUTO)
private Long id;
```

### 3. 一对多关系

```java
// 父实体（One端）
@Entity
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // ✅ 使用mappedBy，不维护外键
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Post> posts = new ArrayList<>();

    // ✅ 提供辅助方法维护双向关系
    public void addPost(Post post) {
        posts.add(post);
        post.setUser(this);
    }

    public void removePost(Post post) {
        posts.remove(post);
        post.setUser(null);
    }
}

// 子实体（Many端）
@Entity
public class Post {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String title;

    // ✅ Many端维护外键
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;
}
```

### 4. 多对多关系

```java
// ✅ 使用关联实体（推荐）
@Entity
public class Student {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToMany(mappedBy = "student")
    private Set<StudentCourse> studentCourses = new HashSet<>();
}

@Entity
public class Course {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToMany(mappedBy = "course")
    private Set<StudentCourse> studentCourses = new HashSet<>();
}

@Entity
@Table(name = "student_course")
public class StudentCourse {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "student_id")
    private Student student;

    @ManyToOne
    @JoinColumn(name = "course_id")
    private Course course;

    @Column(name = "enrolled_date")
    private LocalDate enrolledDate;

    private Integer grade;
}

// ❌ 避免：简单@ManyToMany（无法添加额外属性）
@ManyToMany
@JoinTable(
    name = "student_course",
    joinColumns = @JoinColumn(name = "student_id"),
    inverseJoinColumns = @JoinColumn(name = "course_id")
)
private Set<Course> courses;
```

## 查询优化

### 1. N+1问题解决

```java
// ❌ N+1问题
List<User> users = userRepository.findAll(); // 1次查询
for (User user : users) {
    user.getPosts().size(); // 每个用户1次查询 = N次
}

// ✅ 使用JOIN FETCH
@Query("SELECT u FROM User u LEFT JOIN FETCH u.posts WHERE u.id = :id")
Optional<User> findByIdWithPosts(@Param("id") Long id);

// ✅ 使用@EntityGraph
@EntityGraph(attributePaths = {"posts"})
List<User> findAll();

// ✅ 使用批量加载
@Entity
public class User {
    @OneToMany(mappedBy = "user")
    @BatchSize(size = 10) // 批量加载，减少查询次数
    private List<Post> posts;
}
```

### 2. 分页查询

```java
@Repository
public interface UserRepository extends JpaRepository<User, Long> {
    // ✅ 使用Pageable
    Page<User> findByActive(boolean active, Pageable pageable);

    // ✅ 只需要列表不需要总数时使用Slice
    Slice<User> findByAgeGreaterThan(Integer age, Pageable pageable);
}

// 使用
Pageable pageable = PageRequest.of(0, 20, Sort.by("createdAt").descending());
Page<User> users = userRepository.findByActive(true, pageable);
```

### 3. 投影查询

```java
// ✅ 接口投影（只查询需要的字段）
public interface UserSummary {
    Long getId();
    String getUsername();
    String getEmail();
}

@Repository
public interface UserRepository extends JpaRepository<User, Long> {
    List<UserSummary> findAllBy();

    @Query("SELECT u.id as id, u.username as username, u.email as email FROM User u")
    List<UserSummary> findAllSummaries();
}

// ✅ DTO投影
public class UserDTO {
    private Long id;
    private String username;

    public UserDTO(Long id, String username) {
        this.id = id;
        this.username = username;
    }
}

@Query("SELECT new com.example.UserDTO(u.id, u.username) FROM User u")
List<UserDTO> findAllDTOs();
```

### 4. 动态查询

```java
// ✅ 使用Specification
public class UserSpecifications {
    public static Specification<User> hasUsername(String username) {
        return (root, query, builder) ->
            username == null ? null : builder.equal(root.get("username"), username);
    }

    public static Specification<User> ageGreaterThan(Integer age) {
        return (root, query, builder) ->
            age == null ? null : builder.greaterThan(root.get("age"), age);
    }

    public static Specification<User> isActive() {
        return (root, query, builder) -> builder.isTrue(root.get("active"));
    }
}

// 使用
public interface UserRepository extends JpaSpecificationExecutor<User> {
}

Specification<User> spec = Specification
    .where(UserSpecifications.isActive())
    .and(UserSpecifications.hasUsername("john"))
    .and(UserSpecifications.ageGreaterThan(18));

List<User> users = userRepository.findAll(spec);
```

## 性能优化

### 1. 懒加载与急加载

```java
// ✅ 默认使用懒加载
@ManyToOne(fetch = FetchType.LAZY)  // @ManyToOne默认是EAGER，要改为LAZY
private User user;

@OneToMany(fetch = FetchType.LAZY)  // @OneToMany默认是LAZY
private List<Post> posts;

// ❌ 避免：全部使用急加载
@ManyToOne(fetch = FetchType.EAGER)
private User user;
```

### 2. 二级缓存

```java
// application.yml
spring:
  jpa:
    properties:
      hibernate:
        cache:
          use_second_level_cache: true
          region:
            factory_class: org.hibernate.cache.jcache.JCacheRegionFactory

// 实体配置
@Entity
@Cacheable
@org.hibernate.annotations.Cache(usage = CacheConcurrencyStrategy.READ_WRITE)
public class User {
    // ...
}

// 查询缓存
@Query("SELECT u FROM User u WHERE u.age > :age")
@QueryHints(@QueryHint(name = "org.hibernate.cacheable", value = "true"))
List<User> findByAgeGreaterThan(@Param("age") Integer age);
```

### 3. 批量操作

```java
// ✅ 批量插入
@Transactional
public void batchInsert(List<User> users) {
    for (int i = 0; i < users.size(); i++) {
        entityManager.persist(users.get(i));
        if (i % 50 == 0) { // 每50条flush一次
            entityManager.flush();
            entityManager.clear();
        }
    }
}

// ✅ 批量更新（JPQL）
@Modifying
@Query("UPDATE User u SET u.active = :active WHERE u.lastLoginDate < :date")
int deactivateInactiveUsers(@Param("active") boolean active, @Param("date") LocalDateTime date);
```

### 4. 只读事务

```java
// ✅ 只读查询使用readOnly
@Transactional(readOnly = true)
public List<User> findAllUsers() {
    return userRepository.findAll();
}

// Hibernate配置
spring:
  jpa:
    properties:
      hibernate:
        default_batch_fetch_size: 10  # 批量加载
        jdbc:
          batch_size: 20  # JDBC批处理
        order_inserts: true  # 排序INSERT
        order_updates: true  # 排序UPDATE
```

## 常见陷阱

### 1. 双向关系同步

```java
// ❌ 错误：不同步双向关系
User user = new User();
Post post = new Post();
user.getPosts().add(post);  // 只设置了一端
// post.setUser(user) 没有设置！

// ✅ 正确：使用辅助方法
public class User {
    public void addPost(Post post) {
        posts.add(post);
        post.setUser(this);  // 同步两端
    }
}
```

### 2. equals和hashCode

```java
@Entity
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // ✅ 基于业务键而非ID
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof User)) return false;
        User user = (User) o;
        return Objects.equals(username, user.username);
    }

    @Override
    public int hashCode() {
        return Objects.hash(username);  // 使用不可变的业务键
    }
}
```

### 3. toString陷阱

```java
// ❌ 避免：toString包含关联实体（会触发懒加载）
@Override
public String toString() {
    return "User{" +
        "id=" + id +
        ", posts=" + posts +  // 懒加载触发！
        '}';
}

// ✅ 正确：只包含简单属性
@Override
public String toString() {
    return "User{" +
        "id=" + id +
        ", username='" + username + '\'' +
        '}';
}
```

## 检查清单

审查JPA/Hibernate代码时：

- [ ] 主键策略是否合理（IDENTITY/UUID/SEQUENCE）
- [ ] 关联关系是否正确（@ManyToOne用LAZY）
- [ ] 是否有N+1问题（使用JOIN FETCH或@EntityGraph）
- [ ] 分页查询是否使用Pageable
- [ ] 是否只查询需要的字段（投影）
- [ ] 双向关系是否同步
- [ ] equals和hashCode是否正确实现
- [ ] toString是否会触发懒加载
- [ ] 批量操作是否分批flush
- [ ] 只读查询是否标注readOnly

## 调试技巧

```yaml
# 开发环境：显示SQL
spring:
  jpa:
    show-sql: true
    properties:
      hibernate:
        format_sql: true
        use_sql_comments: true

# 显示SQL参数
logging:
  level:
    org.hibernate.SQL: DEBUG
    org.hibernate.type.descriptor.sql.BasicBinder: TRACE
```

遵循这些最佳实践，可以构建高性能的数据访问层。
