---
name: API Design
slug: api-design
description: RESTful API 设计规范和最佳实践
category: api
estimatedTokens: 800
version: 1.0.0
author: Official
tags: [api, rest, graphql, api-design]
official: true
createdAt: 2026-01-27
updatedAt: 2026-01-27
---

# API Design Skill

## 概述

RESTful API 设计规范、GraphQL 模式和 API 最佳实践。

## RESTful API 设计

### 资源命名

```
✅ 好的命名:
GET    /users              # 获取用户列表
GET    /users/123          # 获取特定用户
POST   /users              # 创建用户
PUT    /users/123          # 更新用户
PATCH  /users/123          # 部分更新用户
DELETE /users/123          # 删除用户

GET    /users/123/posts    # 获取用户的文章
POST   /users/123/posts    # 为用户创建文章

❌ 不好的命名:
GET    /getUsers           # 动词在 URL 中
POST   /user/create        # 不必要的动词
GET    /users/123/delete   # DELETE 用 GET
```

### 命名规范

- **使用复数名词** - `/users` 而不是 `/user`
- **小写字母** - `/user-posts` 而不是 `/UserPosts`
- **连字符** - `/user-posts` 而不是 `/user_posts`
- **避免动词** - 用 HTTP 方法表达动作
- **层级关系** - `/users/123/posts/456`

### HTTP 方法

| 方法 | 用途 | 幂等性 | 安全性 |
|------|------|--------|--------|
| GET | 获取资源 | ✅ | ✅ |
| POST | 创建资源 | ❌ | ❌ |
| PUT | 完整更新 | ✅ | ❌ |
| PATCH | 部分更新 | ❌ | ❌ |
| DELETE | 删除资源 | ✅ | ❌ |

### 状态码

**成功响应 (2xx)**
```
200 OK              - 请求成功
201 Created         - 资源创建成功
204 No Content      - 成功,无返回内容（如 DELETE）
```

**客户端错误 (4xx)**
```
400 Bad Request     - 请求参数错误
401 Unauthorized    - 未认证
403 Forbidden       - 无权限
404 Not Found       - 资源不存在
409 Conflict        - 资源冲突（如重复创建）
422 Unprocessable   - 验证失败
429 Too Many Requests - 速率限制
```

**服务器错误 (5xx)**
```
500 Internal Server Error - 服务器错误
502 Bad Gateway          - 网关错误
503 Service Unavailable  - 服务不可用
```

### 请求/响应格式

**创建用户**

```http
POST /api/users
Content-Type: application/json

{
  "name": "Alice",
  "email": "alice@example.com"
}
```

**响应**

```http
HTTP/1.1 201 Created
Content-Type: application/json
Location: /api/users/123

{
  "id": 123,
  "name": "Alice",
  "email": "alice@example.com",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

### 错误处理

```typescript
// ✅ 统一错误格式
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "email",
        "message": "Email is required"
      },
      {
        "field": "password",
        "message": "Password must be at least 8 characters"
      }
    ]
  }
}

// 实现
class ApiError {
  constructor(
    public statusCode: number,
    public code: string,
    public message: string,
    public details?: any[]
  ) {}

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details })
      }
    };
  }
}

app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json(err.toJSON());
  }
  // 未预期的错误
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred'
    }
  });
});
```

### 分页

```typescript
// ✅ 基于游标的分页（推荐）
GET /api/users?cursor=eyJpZCI6MTIzfQ&limit=20

{
  "data": [...],
  "pagination": {
    "nextCursor": "eyJpZCI6MTQzfQ",
    "hasMore": true
  }
}

// ✅ 基于页码的分页
GET /api/users?page=2&limit=20

{
  "data": [...],
  "pagination": {
    "page": 2,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

### 过滤和排序

```
GET /api/users?status=active&role=admin&sort=-createdAt,name
                     ↑          ↑          ↑
                  过滤字段   过滤字段   排序（- 表示降序）
```

```typescript
// 实现
interface QueryParams {
  status?: string;
  role?: string;
  sort?: string;
  page?: number;
  limit?: number;
}

function buildQuery(params: QueryParams) {
  const query: any = {};

  // 过滤
  if (params.status) query.status = params.status;
  if (params.role) query.role = params.role;

  // 排序
  const sort: any = {};
  if (params.sort) {
    params.sort.split(',').forEach(field => {
      if (field.startsWith('-')) {
        sort[field.substring(1)] = -1; // 降序
      } else {
        sort[field] = 1; // 升序
      }
    });
  }

  return { query, sort };
}
```

### 版本控制

```
✅ URL 版本:
GET /api/v1/users
GET /api/v2/users

✅ Header 版本:
GET /api/users
Accept: application/vnd.myapi.v1+json

✅ 查询参数版本:
GET /api/users?version=1
```

### 速率限制

```http
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1640995200

{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later."
  }
}
```

```typescript
// 实现（使用 Redis）
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';

const limiter = rateLimit({
  store: new RedisStore({ client: redisClient }),
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100, // 限制 100 次请求
  standardHeaders: true, // 返回 RateLimit-* headers
  legacyHeaders: false
});

app.use('/api/', limiter);
```

### 认证和授权

```http
# JWT Bearer Token
GET /api/users/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# API Key
GET /api/users
X-API-Key: your-api-key-here
```

```typescript
// JWT 中间件
function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'No token provided' }
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      error: { code: 'INVALID_TOKEN', message: 'Invalid token' }
    });
  }
}

// 权限检查
function authorize(...roles: string[]) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
      });
    }
    next();
  };
}

// 使用
app.get('/api/admin/users', authenticate, authorize('admin'), handler);
```

## GraphQL API

### Schema 定义

```graphql
type User {
  id: ID!
  name: String!
  email: String!
  posts: [Post!]!
}

type Post {
  id: ID!
  title: String!
  content: String!
  author: User!
}

type Query {
  user(id: ID!): User
  users(limit: Int, offset: Int): [User!]!
}

type Mutation {
  createUser(name: String!, email: String!): User!
  updateUser(id: ID!, name: String, email: String): User!
  deleteUser(id: ID!): Boolean!
}
```

### 查询示例

```graphql
# 获取用户及其文章
query {
  user(id: "123") {
    id
    name
    posts {
      id
      title
    }
  }
}

# 创建用户
mutation {
  createUser(name: "Alice", email: "alice@example.com") {
    id
    name
    email
  }
}
```

## API 文档

### OpenAPI/Swagger

```yaml
openapi: 3.0.0
info:
  title: User API
  version: 1.0.0

paths:
  /users:
    get:
      summary: 获取用户列表
      parameters:
        - name: page
          in: query
          schema:
            type: integer
      responses:
        '200':
          description: 成功
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/User'

components:
  schemas:
    User:
      type: object
      properties:
        id:
          type: integer
        name:
          type: string
        email:
          type: string
```

## API 最佳实践

- [ ] **使用 HTTPS** - 加密传输
- [ ] **版本控制** - 支持向后兼容
- [ ] **统一错误格式** - 便于客户端处理
- [ ] **速率限制** - 防止滥用
- [ ] **认证授权** - JWT、OAuth 2.0
- [ ] **分页** - 大数据集必须分页
- [ ] **缓存** - 使用 ETag、Cache-Control
- [ ] **压缩** - Gzip、Brotli
- [ ] **CORS** - 正确配置跨域
- [ ] **文档** - OpenAPI/Swagger
- [ ] **监控** - 日志、指标、追踪

## 参考资料

- [REST API Tutorial](https://restfulapi.net/)
- [GraphQL Documentation](https://graphql.org/)
- [OpenAPI Specification](https://swagger.io/specification/)
