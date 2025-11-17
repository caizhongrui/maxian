# 天和 AI 助手

> 天和·智开 IDE 的内置 AI 助手扩展

## 功能特性

- ✅ **多模型支持**: 千问 Qwen、Claude、GPT、Gemini
- ✅ **千问优先**: 前期开发使用千问模型 (成本低、中文好、代码强)
- ✅ **Agent 工具系统**: 25+ 工具 (文件操作、代码编辑、命令执行等)
- ✅ **多 Agent 模式**: Architect、Coder、Debugger
- ✅ **浏览器自动化**: 支持网页抓取和交互
- ✅ **代码索引**: 语义搜索和智能补全

## 开发状态

**当前进度**: Week 1 - 基础框架搭建

- [x] 创建扩展目录结构
- [x] 配置 package.json
- [x] 配置为内置扩展
- [x] 配置 TypeScript 编译环境
- [x] 配置 ESBuild 构建
- [x] 创建扩展入口文件
- [x] 安装依赖并编译成功
- [ ] 集成 WebView
- [ ] 实现 AI 对话功能
- [ ] 实现工具系统

## 构建和运行

### 安装依赖

```bash
npm install
```

### 编译扩展

```bash
npm run compile
```

### 开发模式 (监听文件变化)

```bash
npm run watch
```

### 在 IDE 中测试

```bash
cd ../../  # 回到 IDE 根目录
./scripts/code.sh
```

## 配置

扩展配置位于 VS Code 设置中:

```json
{
  // 千问配置 (推荐)
  "tianhe-ai.qwen.apiKey": "sk-xxx",
  "tianhe-ai.qwen.model": "qwen-coder-plus",

  // 其他模型配置
  "tianhe-ai.claude.apiKey": "sk-xxx",
  "tianhe-ai.openai.apiKey": "sk-xxx",
  "tianhe-ai.gemini.apiKey": "xxx",

  // 默认模型
  "tianhe-ai.defaultModel": "qwen"
}
```

## 使用方法

### 打开 AI 对话

- 快捷键: `Cmd+Alt+A` (macOS) / `Ctrl+Alt+A` (Windows/Linux)
- 或点击左侧活动栏的 AI 图标

### 新建任务

- 快捷键: `Cmd+Alt+N` (macOS) / `Ctrl+Alt+N` (Windows/Linux)

## 技术栈

- **语言**: TypeScript
- **框架**: VS Code Extension API
- **UI**: React + Vite (WebView)
- **AI SDK**: OpenAI SDK (支持千问兼容接口)
- **构建**: ESBuild

## 许可证

MIT License

Copyright (c) 2025 天和·智开团队

---

**版本**: 1.0.0
**更新日期**: 2025-11-12
