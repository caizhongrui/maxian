# 智开 IDE - 登录功能测试说明

## 🚀 启动测试

### 1. 启动 IDE
```bash
cd /Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/tianhe-zhikai-ide
./scripts/code.sh
```

### 2. 预期行为

#### 首次启动（未配置 API）
1. IDE 启动
2. 控制台显示：`[Auth] API URL not configured`
3. 右下角显示通知：`后端 API 地址未配置，请在设置中配置 zhikai.auth.apiUrl`
4. **不会阻止使用 IDE**

#### 配置 API 后启动
1. IDE 启动
2. 尝试自动登录（检查存储的 Token）
3. **如果没有存储的 Token 或 Token 无效**：
   - 弹出登录输入框（VS Code Quick Input）
   - 提示：`请输入用户名`

## 📝 测试步骤

### 步骤 1：配置后端 API 地址

打开设置（`Cmd+,` 或 `Ctrl+,`），搜索 `zhikai.auth`，配置：

```json
{
  "zhikai.auth.apiUrl": "https://your-backend-api.com",
  "zhikai.auth.required": true
}
```

或者编辑 `~/.config/Code - OSS/User/settings.json`（macOS）：

```json
{
  "zhikai.auth.apiUrl": "http://localhost:3000",
  "zhikai.auth.required": true,
  "zhikai.auth.loginEndpoint": "/api/auth/login",
  "zhikai.auth.timeout": 30000
}
```

### 步骤 2：重启 IDE

```bash
# 关闭 IDE，然后重新启动
./scripts/code.sh
```

### 步骤 3：登录流程测试

#### 3.1 输入用户名
- 应该看到输入框：`请输入用户名`
- 输入用户名，按 `Enter`

#### 3.2 输入密码
- 应该看到输入框：`请输入密码`
- 输入密码（隐藏显示），按 `Enter`

#### 3.3 选择是否记住
- 应该看到选择框：`是否记住登录状态？`
- 选择 `记住我` 或 `仅本次登录`

#### 3.4 登录结果
- **成功**：
  - 控制台显示：`[Login Dialog] Login successful`
  - 右下角显示：`欢迎回来，{用户名}！`
  - IDE 正常使用

- **失败**：
  - 显示错误：`登录失败: {错误消息}`
  - 提供选项：`重试` 或 `退出 IDE`

### 步骤 4：测试自动登录

如果选择了"记住我"：

1. 关闭 IDE
2. 重新启动 `./scripts/code.sh`
3. **预期**：自动登录成功，不再显示登录框
4. 控制台显示：`[Auth] Auto-login successful`

## 🔍 调试

### 查看控制台日志

打开开发者工具：
- `Help > Toggle Developer Tools`
- 切换到 `Console` 标签

查找以下日志：
```
[Auth] Authentication module loaded
[Auth] Authentication not required, skipping  // 如果 required=false
[Auth] API URL not configured               // 如果未配置 API
[Auth] Attempting auto-login                 // 尝试自动登录
[Auth] Auto-login successful                 // 自动登录成功
[Auth] Auto-login failed, showing login dialog  // 需要手动登录
[Login Dialog] Login successful              // 登录成功
[Auth Service] Login attempt for user: xxx   // 登录尝试
```

### 检查存储

打开开发者工具 → Application → Storage → Local Storage：
- 查找 `zhikai.auth.credentials` 键
- 如果选择了"记住我"，应该能看到存储的数据

### 测试 Token 刷新

1. 等待 Token 过期（根据后端配置的 `expiresIn`）
2. IDE 应该自动调用刷新接口
3. 控制台显示：`[Auth Service] Refreshing token`

## 🧪 后端 API 模拟

如果还没有后端，可以使用 Node.js 快速创建一个测试服务器：

```javascript
// test-auth-server.js
const express = require('express');
const app = express();
app.use(express.json());

// 登录接口
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  // 简单验证（测试用）
  if (username === 'admin' && password === 'admin123') {
    res.json({
      accessToken: 'test_access_token_' + Date.now(),
      refreshToken: 'test_refresh_token_' + Date.now(),
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: {
        id: '1',
        username: 'admin',
        displayName: '管理员',
        email: 'admin@example.com'
      }
    });
  } else {
    res.status(401).json({ error: '用户名或密码错误' });
  }
});

// 刷新 Token
app.post('/api/auth/refresh', (req, res) => {
  res.json({
    accessToken: 'refreshed_token_' + Date.now(),
    tokenType: 'Bearer',
    expiresIn: 3600,
    user: {
      id: '1',
      username: 'admin',
      displayName: '管理员'
    }
  });
});

// 验证 Token（获取用户信息）
app.get('/api/auth/user', (req, res) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    res.json({
      id: '1',
      username: 'admin',
      displayName: '管理员',
      email: 'admin@example.com'
    });
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// 登出
app.post('/api/auth/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

app.listen(3000, () => {
  console.log('测试认证服务器运行在 http://localhost:3000');
  console.log('测试账号: admin / admin123');
});
```

启动测试服务器：
```bash
node test-auth-server.js
```

然后在 IDE 设置中配置：
```json
{
  "zhikai.auth.apiUrl": "http://localhost:3000"
}
```

## ✅ 测试清单

- [ ] IDE 启动时显示登录框
- [ ] 可以输入用户名
- [ ] 可以输入密码（隐藏显示）
- [ ] 可以选择"记住我"
- [ ] 登录成功后显示欢迎消息
- [ ] 登录失败显示错误并可重试
- [ ] 选择"退出 IDE"可关闭窗口
- [ ] 选择"记住我"后，下次启动自动登录
- [ ] Token 过期后自动刷新
- [ ] 未配置 API 时显示提示

## 🐛 常见问题

### 1. 登录框没有出现
- 检查 `zhikai.auth.required` 是否为 `true`
- 检查 `zhikai.auth.apiUrl` 是否已配置
- 查看开发者控制台是否有错误日志

### 2. 登录失败
- 检查后端 API 是否正常运行
- 检查 API 地址是否正确（包括协议 http/https）
- 检查 CORS 设置（如果是跨域请求）
- 查看控制台网络请求详情

### 3. 无法自动登录
- 检查浏览器存储是否被清除
- 检查 Token 是否已过期
- 查看控制台刷新 Token 的日志

### 4. 编译错误
- 确保所有文件都已创建
- 确保导入语句在 `workbench.common.main.ts` 中
- 运行 `npm run compile` 查看详细错误

## 📊 配置项完整列表

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `zhikai.auth.apiUrl` | string | "" | 后端 API 地址 |
| `zhikai.auth.loginEndpoint` | string | "/api/auth/login" | 登录接口路径 |
| `zhikai.auth.refreshEndpoint` | string | "/api/auth/refresh" | 刷新 Token 路径 |
| `zhikai.auth.logoutEndpoint` | string | "/api/auth/logout" | 登出接口路径 |
| `zhikai.auth.userInfoEndpoint` | string | "/api/auth/user" | 用户信息路径 |
| `zhikai.auth.timeout` | number | 30000 | 请求超时（毫秒） |
| `zhikai.auth.required` | boolean | true | 是否强制登录 |

## 🎯 下一步

测试通过后，可以考虑：
1. 添加登出按钮到菜单
2. 在状态栏显示当前用户
3. 添加用户头像
4. 实现离线模式
5. 添加多账号切换
