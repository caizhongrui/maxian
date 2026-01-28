---
name: Security
slug: security
description: 安全编码规范和常见漏洞防护
category: security
estimatedTokens: 1200
version: 1.0.0
author: Official
tags: [security, owasp, vulnerabilities, encryption]
official: true
createdAt: 2026-01-27
updatedAt: 2026-01-27
---

# Security Skill

## OWASP Top 10 防护

### 1. 注入攻击

#### SQL 注入

```typescript
// ❌ 危险 - SQL 注入
const query = `SELECT * FROM users WHERE id = ${userId}`;

// ✅ 安全 - 参数化查询
const query = 'SELECT * FROM users WHERE id = ?';
db.query(query, [userId]);

// ✅ 使用 ORM
const user = await User.findById(userId);
```

#### NoSQL 注入

```typescript
// ❌ 危险
db.collection('users').find({ username: req.body.username });

// ✅ 安全 - 验证输入类型
if (typeof req.body.username !== 'string') {
  throw new Error('Invalid username');
}
db.collection('users').find({ username: req.body.username });
```

#### 命令注入

```typescript
// ❌ 危险
exec(`git log ${userInput}`);

// ✅ 安全 - 使用库而不是 shell 命令
const simpleGit = require('simple-git');
await simpleGit().log();
```

### 2. 认证和授权

#### 密码存储

```typescript
// ❌ 危险 - 明文存储
user.password = password;

// ❌ 危险 - 弱哈希
user.password = md5(password);

// ✅ 安全 - 使用 bcrypt
import bcrypt from 'bcrypt';
const saltRounds = 10;
user.passwordHash = await bcrypt.hash(password, saltRounds);

// 验证密码
const isValid = await bcrypt.compare(password, user.passwordHash);
```

#### JWT 令牌

```typescript
// ✅ 生成 JWT
import jwt from 'jsonwebtoken';

const token = jwt.sign(
  { userId: user.id, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

// ✅ 验证 JWT
try {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  req.user = decoded;
} catch (error) {
  throw new UnauthorizedError('Invalid token');
}
```

#### 会话管理

```typescript
// ✅ 安全的会话配置
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,        // 只在 HTTPS 上发送
    httpOnly: true,      // 防止 XSS 窃取
    sameSite: 'strict',  // 防止 CSRF
    maxAge: 3600000      // 1 小时
  }
}));
```

### 3. 跨站脚本（XSS）

#### 输出转义

```typescript
// ❌ 危险 - 直接插入 HTML
div.innerHTML = userInput;

// ✅ 安全 - 转义 HTML
function escapeHTML(str) {
  return str.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

div.textContent = userInput; // 或
div.innerHTML = escapeHTML(userInput);
```

#### 内容安全策略（CSP）

```typescript
// ✅ 设置 CSP 头
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
  );
  next();
});
```

### 4. 跨站请求伪造（CSRF）

```typescript
// ✅ 使用 CSRF 令牌
import csrf from 'csurf';

app.use(csrf({ cookie: true }));

app.get('/form', (req, res) => {
  res.render('form', { csrfToken: req.csrfToken() });
});

// HTML 表单
// <input type="hidden" name="_csrf" value="{{csrfToken}}">
```

### 5. 敏感数据泄露

#### 环境变量

```typescript
// ❌ 危险 - 硬编码
const apiKey = "sk-1234567890abcdef";
const dbPassword = "admin123";

// ✅ 安全 - 使用环境变量
const apiKey = process.env.API_KEY;
const dbPassword = process.env.DB_PASSWORD;

// .env 文件（不要提交到 Git）
// API_KEY=sk-xxxxx
// DB_PASSWORD=xxxxx

// .gitignore
// .env
// .env.local
```

#### 数据加密

```typescript
// ✅ 加密敏感数据
import crypto from 'crypto';

function encrypt(text, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text, key) {
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

### 6. 文件上传安全

```typescript
// ✅ 安全的文件上传
import multer from 'multer';
import path from 'path';

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    // 生成随机文件名
    const uniqueName = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, uniqueName + ext);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    // 只允许图片
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});
```

### 7. 不安全的反序列化

```typescript
// ❌ 危险
const data = eval(userInput);

// ✅ 安全
try {
  const data = JSON.parse(userInput);
  // 验证数据结构
  if (!isValidDataStructure(data)) {
    throw new Error('Invalid data');
  }
} catch (error) {
  // 处理错误
}
```

### 8. API 安全

#### 速率限制

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100, // 限制 100 次请求
  message: 'Too many requests'
});

app.use('/api/', limiter);
```

#### 输入验证

```typescript
import { body, validationResult } from 'express-validator';

app.post('/user',
  body('email').isEmail().normalizeEmail(),
  body('age').isInt({ min: 18, max: 120 }),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    // 处理请求
  }
);
```

## 安全检查清单

### 代码审查

- [ ] 无硬编码的密钥、密码
- [ ] 所有输入都经过验证
- [ ] 所有输出都经过转义
- [ ] 使用参数化查询
- [ ] 密码使用强哈希（bcrypt）
- [ ] 敏感操作有权限检查
- [ ] 文件上传有类型和大小限制
- [ ] API 有速率限制
- [ ] HTTPS 启用
- [ ] 安全头部已配置

### 安全头部

```typescript
// ✅ 使用 helmet 中间件
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

## 工具推荐

- **Snyk** - 依赖漏洞扫描
- **npm audit** - npm 包安全检查
- **OWASP ZAP** - Web 应用安全扫描
- **SonarQube** - 代码安全分析
- **ESLint Security Plugin** - 静态代码安全检查

## 参考资料

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
