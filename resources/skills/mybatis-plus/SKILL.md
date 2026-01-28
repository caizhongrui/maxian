---
name: MyBatis Plus
slug: mybatis-plus
description: MyBatis-Plus增强框架，提供CRUD、分页、条件构造器等强大功能
version: 1.0.0
category: development
author: System
tags: [mybatis-plus, orm, database, crud]
estimatedTokens: 1800
---

# MyBatis-Plus Guide

MyBatis-Plus增强框架最佳实践。

## 核心概念

### 1. 基础配置

**依赖配置**：
```xml
<dependency>
    <groupId>com.baomidou</groupId>
    <artifactId>mybatis-plus-boot-starter</artifactId>
    <version>3.5.5</version>
</dependency>
```

**配置文件**：
```yaml
mybatis-plus:
  configuration:
    map-underscore-to-camel-case: true  # 下划线转驼峰
    log-impl: org.apache.ibatis.logging.stdout.StdOutImpl  # SQL日志
  global-config:
    db-config:
      id-type: auto  # 主键策略
      logic-delete-field: deleted  # 逻辑删除字段
      logic-delete-value: 1  # 删除值
      logic-not-delete-value: 0  # 未删除值
  mapper-locations: classpath*:mapper/**/*.xml
```

### 2. 实体类

**基础实体**：
```java
@Data
@TableName("sys_user")
public class User {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("username")
    private String username;

    private String email;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updateTime;

    @TableLogic
    private Integer deleted;

    // 非数据库字段
    @TableField(exist = false)
    private String tempField;
}
```

**自动填充**：
```java
@Component
public class MyMetaObjectHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        this.strictInsertFill(metaObject, "createTime", LocalDateTime.class, LocalDateTime.now());
        this.strictInsertFill(metaObject, "updateTime", LocalDateTime.class, LocalDateTime.now());
    }

    @Override
    public void updateFill(MetaObject metaObject) {
        this.strictUpdateFill(metaObject, "updateTime", LocalDateTime.class, LocalDateTime.now());
    }
}
```

### 3. Mapper接口

**基础Mapper**：
```java
@Mapper
public interface UserMapper extends BaseMapper<User> {
    // BaseMapper提供了基础的CRUD方法
    // 自定义方法写在这里

    @Select("SELECT * FROM sys_user WHERE age > #{age}")
    List<User> selectByAge(@Param("age") Integer age);
}
```

### 4. Service层

**IService接口**：
```java
public interface IUserService extends IService<User> {
    // 自定义业务方法
    boolean registerUser(RegisterDTO dto);
}
```

**ServiceImpl实现**：
```java
@Service
@RequiredArgsConstructor
public class UserServiceImpl extends ServiceImpl<UserMapper, User> implements IUserService {

    @Override
    public boolean registerUser(RegisterDTO dto) {
        User user = new User();
        user.setUsername(dto.getUsername());
        user.setEmail(dto.getEmail());
        return this.save(user);
    }

    // IService提供的常用方法：
    // save() - 插入
    // saveBatch() - 批量插入
    // saveOrUpdate() - 存在则更新，不存在则插入
    // removeById() - 根据ID删除
    // updateById() - 根据ID更新
    // getById() - 根据ID查询
    // list() - 查询所有
    // page() - 分页查询
}
```

### 5. 条件构造器

**QueryWrapper**：
```java
@Service
@RequiredArgsConstructor
public class UserService {
    private final UserMapper userMapper;

    public List<User> queryUsers(UserQuery query) {
        QueryWrapper<User> wrapper = new QueryWrapper<>();

        // 等于
        wrapper.eq(StringUtils.isNotBlank(query.getUsername()), "username", query.getUsername());

        // 模糊查询
        wrapper.like(StringUtils.isNotBlank(query.getEmail()), "email", query.getEmail());

        // 大于等于
        wrapper.ge(query.getMinAge() != null, "age", query.getMinAge());

        // 小于等于
        wrapper.le(query.getMaxAge() != null, "age", query.getMaxAge());

        // IN查询
        wrapper.in(CollectionUtils.isNotEmpty(query.getIds()), "id", query.getIds());

        // 排序
        wrapper.orderByDesc("create_time");

        return userMapper.selectList(wrapper);
    }
}
```

**LambdaQueryWrapper（类型安全）**：
```java
public List<User> queryUsersLambda(UserQuery query) {
    LambdaQueryWrapper<User> wrapper = new LambdaQueryWrapper<>();

    wrapper.eq(StringUtils.isNotBlank(query.getUsername()), User::getUsername, query.getUsername())
           .like(StringUtils.isNotBlank(query.getEmail()), User::getEmail, query.getEmail())
           .ge(query.getMinAge() != null, User::getAge, query.getMinAge())
           .le(query.getMaxAge() != null, User::getAge, query.getMaxAge())
           .in(CollectionUtils.isNotEmpty(query.getIds()), User::getId, query.getIds())
           .orderByDesc(User::getCreateTime);

    return userMapper.selectList(wrapper);
}
```

**UpdateWrapper**：
```java
public boolean updateUserStatus(Long userId, Integer status) {
    UpdateWrapper<User> wrapper = new UpdateWrapper<>();
    wrapper.eq("id", userId)
           .set("status", status)
           .set("update_time", LocalDateTime.now());

    return userMapper.update(null, wrapper) > 0;
}

// Lambda版本
public boolean updateUserStatusLambda(Long userId, Integer status) {
    LambdaUpdateWrapper<User> wrapper = new LambdaUpdateWrapper<>();
    wrapper.eq(User::getId, userId)
           .set(User::getStatus, status)
           .set(User::getUpdateTime, LocalDateTime.now());

    return userMapper.update(null, wrapper) > 0;
}
```

### 6. 分页查询

**分页插件配置**：
```java
@Configuration
public class MybatisPlusConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();

        // 分页插件
        PaginationInnerInterceptor paginationInterceptor = new PaginationInnerInterceptor(DbType.MYSQL);
        paginationInterceptor.setMaxLimit(500L);  // 最大单页限制
        paginationInterceptor.setOverflow(false);  // 溢出总页数后是否进行处理
        interceptor.addInnerInterceptor(paginationInterceptor);

        // 乐观锁插件
        interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());

        return interceptor;
    }
}
```

**分页查询使用**：
```java
@Service
@RequiredArgsConstructor
public class UserService {
    private final UserMapper userMapper;

    public IPage<User> pageUsers(UserPageQuery query) {
        Page<User> page = new Page<>(query.getPageNum(), query.getPageSize());

        LambdaQueryWrapper<User> wrapper = new LambdaQueryWrapper<>();
        wrapper.like(StringUtils.isNotBlank(query.getKeyword()), User::getUsername, query.getKeyword())
               .orderByDesc(User::getCreateTime);

        return userMapper.selectPage(page, wrapper);
    }
}
```

### 7. 批量操作

**批量插入**：
```java
@Service
@RequiredArgsConstructor
public class UserService extends ServiceImpl<UserMapper, User> {

    // 使用IService的saveBatch方法
    public boolean batchInsert(List<User> users) {
        return this.saveBatch(users, 1000);  // 每批1000条
    }

    // 自定义批量插入
    @Transactional
    public boolean customBatchInsert(List<User> users) {
        int batchSize = 1000;
        for (int i = 0; i < users.size(); i += batchSize) {
            int end = Math.min(i + batchSize, users.size());
            List<User> batch = users.subList(i, end);
            this.saveBatch(batch);
        }
        return true;
    }
}
```

### 8. 多表关联

**一对一关联**：
```java
@Data
public class User {
    private Long id;
    private String username;

    @TableField(exist = false)
    private UserProfile profile;  // 关联的详情
}

@Mapper
public interface UserMapper extends BaseMapper<User> {

    @Select("SELECT u.*, p.* FROM sys_user u " +
            "LEFT JOIN user_profile p ON u.id = p.user_id " +
            "WHERE u.id = #{id}")
    @Results({
        @Result(property = "id", column = "id"),
        @Result(property = "username", column = "username"),
        @Result(property = "profile.nickname", column = "nickname"),
        @Result(property = "profile.avatar", column = "avatar")
    })
    User selectWithProfile(@Param("id") Long id);
}
```

**一对多关联**：
```java
@Data
public class User {
    private Long id;
    private String username;

    @TableField(exist = false)
    private List<Order> orders;  // 关联的订单列表
}

@Mapper
public interface UserMapper extends BaseMapper<User> {

    @Select("SELECT * FROM sys_user WHERE id = #{id}")
    @Results({
        @Result(property = "id", column = "id"),
        @Result(property = "orders", column = "id",
                many = @Many(select = "com.example.mapper.OrderMapper.selectByUserId"))
    })
    User selectWithOrders(@Param("id") Long id);
}
```

### 9. 乐观锁

**实体类配置**：
```java
@Data
public class Product {
    @TableId
    private Long id;

    private String name;

    private BigDecimal price;

    @Version  // 乐观锁版本号
    private Integer version;
}
```

**使用乐观锁**：
```java
@Service
@RequiredArgsConstructor
public class ProductService {
    private final ProductMapper productMapper;

    public boolean updatePrice(Long id, BigDecimal newPrice) {
        // 先查询获取version
        Product product = productMapper.selectById(id);
        if (product == null) {
            return false;
        }

        // 更新时会自动对比version并+1
        product.setPrice(newPrice);
        int rows = productMapper.updateById(product);

        return rows > 0;  // 如果version不匹配，返回0
    }
}
```

### 10. 代码生成器

```java
public class CodeGenerator {

    public static void main(String[] args) {
        FastAutoGenerator.create("jdbc:mysql://localhost:3306/mydb", "root", "password")
            .globalConfig(builder -> {
                builder.author("YourName")
                       .outputDir(System.getProperty("user.dir") + "/src/main/java")
                       .commentDate("yyyy-MM-dd");
            })
            .packageConfig(builder -> {
                builder.parent("com.example")
                       .entity("entity")
                       .mapper("mapper")
                       .service("service")
                       .serviceImpl("service.impl")
                       .controller("controller");
            })
            .strategyConfig(builder -> {
                builder.addInclude("sys_user", "sys_role")  // 设置需要生成的表名
                       .entityBuilder()
                       .enableLombok()
                       .enableTableFieldAnnotation()
                       .logicDeleteColumnName("deleted")
                       .versionColumnName("version")
                       .addTableFills(
                           new Column("create_time", FieldFill.INSERT),
                           new Column("update_time", FieldFill.INSERT_UPDATE)
                       )
                       .controllerBuilder()
                       .enableRestStyle();
            })
            .execute();
    }
}
```

## 最佳实践

- [ ] 使用LambdaWrapper避免字段名硬编码
- [ ] 合理使用逻辑删除
- [ ] 分页查询设置最大限制
- [ ] 批量操作控制批次大小
- [ ] 使用自动填充处理通用字段
- [ ] 重要更新使用乐观锁
- [ ] 避免全表更新/删除
- [ ] SQL日志仅在开发环境开启
- [ ] 使用代码生成器提高效率

## 常见问题

**Q: MyBatis-Plus vs JPA？**
A: MyBatis-Plus更灵活，适合复杂SQL。JPA更标准化，适合简单CRUD。

**Q: 如何避免N+1查询？**
A: 使用关联查询或批量查询，避免循环调用selectById。

**Q: 逻辑删除的数据如何查询？**
A: 默认自动过滤，需要查询使用@SqlParser(filter = true)。

遵循这些实践，高效使用MyBatis-Plus进行数据访问。
