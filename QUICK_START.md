# 🚀 天和·智开 IDE 快速启动指南

## ✅ 扩展市场已集成！

恭喜！你的IDE现在已经集成了扩展市场功能。

---

## 🎯 立即体验

### 1️⃣ 重新编译（必需）

```bash
cd /Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/tianhe-zhikai-ide

# 清理旧构建
npm run clean

# 重新编译
npm run compile

# 等待编译完成...
```

### 2️⃣ 启动IDE

```bash
# 启动IDE
./scripts/code.sh .
```

### 3️⃣ 打开扩展视图

**快捷键**：`Cmd+Shift+X` (Mac) 或 `Ctrl+Shift+X` (Windows/Linux)

你现在应该能看到：
- ✅ 🔍 市场扩展
- ✅ 💡 推荐扩展
- ✅ ⭐ 流行扩展
- ✅ 📥 已安装扩展

### 4️⃣ 测试安装扩展

**搜索并安装一个扩展**：
1. 在搜索框输入：`Material Icon Theme`
2. 点击第一个结果
3. 点击「安装」按钮
4. 等待安装完成

---

## 🎨 核心功能概览

### AI功能

| 功能 | 快捷键 | 说明 |
|------|--------|------|
| **AI聊天** | 右侧边栏 | 智能对话助手 |
| **AI补全** | 自动触发 | 类似Copilot的代码补全 |
| **生成测试** | `Alt+T` | 为方法生成单元测试 |
| **代码注释** | `Alt+D` | 生成代码文档 |
| **代码优化** | 右键菜单 | AI优化代码 |

### 扩展市场（新）

| 功能 | 快捷键 | 说明 |
|------|--------|------|
| **打开扩展** | `Cmd+Shift+X` | 浏览和安装扩展 |
| **搜索扩展** | 输入关键词 | 搜索Open VSX Registry |
| **安装扩展** | 点击安装 | 一键安装扩展 |
| **管理扩展** | 右键菜单 | 启用/禁用/卸载 |

### 测试功能

| 功能 | 位置 | 说明 |
|------|------|------|
| **自动生成测试** | 右键菜单 | 为文件/目录批量生成测试 |
| **运行测试** | 测试视图 | 运行单元测试 |
| **测试覆盖率** | 测试视图 | 查看代码覆盖率 |

---

## 📦 推荐安装的扩展

### 基础工具

```
Material Icon Theme         # 文件图标
One Dark Pro               # 暗色主题
GitLens                    # Git增强
```

### 编程语言

```
Python                     # Python支持
Java Extension Pack        # Java开发套件
ESLint                     # JavaScript检查
Prettier                   # 代码格式化
```

### 开发工具

```
REST Client               # API测试
Docker                    # 容器管理
Remote SSH                # 远程开发
```

---

## 🔍 验证配置

### 检查扩展市场是否正常

1. **打开开发者工具**
   ```
   Help → Toggle Developer Tools → Console
   ```

2. **查找日志**
   搜索：`ExtensionGalleryService`
   
   **应该看到**：
   ```
   [ExtensionGalleryService] Gallery service initialized: https://open-vsx.org/vscode/gallery
   ```

3. **测试搜索**
   - 在扩展视图搜索：`python`
   - 应该能看到搜索结果

---

## 🛠️ 故障排查

### 问题：扩展视图仍然只显示「已安装」

**解决**：
```bash
# 1. 完全清理
npm run clean

# 2. 重新编译
npm run compile

# 3. 杀掉所有进程
pkill -9 -f "tianhe-zhikai"
pkill -9 -f "Code - OSS"

# 4. 重新启动
./scripts/code.sh .
```

### 问题：无法连接到扩展市场

**检查**：
1. 网络连接是否正常
2. 访问 https://open-vsx.org/ 确认服务可用
3. 查看Console是否有错误日志

---

## 📚 详细文档

| 文档 | 内容 |
|------|------|
| `EXTENSIONS_MARKETPLACE_GUIDE.md` | 扩展市场完整指南 |
| `TEST_GENERATION_GUIDE.md` | AI测试生成指南 |
| `INLINE_COMPLETION_GUIDE.md` | 内联代码补全指南 |
| `AI_COMPLETION_DEBUG_GUIDE.md` | AI补全调试指南 |

---

## 🎉 享受你的IDE！

你现在拥有：
- ✅ AI智能助手
- ✅ 完整的扩展市场
- ✅ 自动化测试生成
- ✅ 代码补全和优化

**开始探索吧！** 🚀

