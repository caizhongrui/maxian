# Skills System 快速测试指南

## 修复已完成

✅ 已修复 `path` 模块加载错误
✅ 已采用正确的IPC架构
✅ 编译成功，0个错误

## 快速验证步骤

### 1. 启动IDE

```bash
npm run watch
# 或者
./scripts/code.sh
```

### 2. 检查Console日志

打开浏览器开发者工具（F12），应该看到：

```
[SkillService] 初始化，Skills 目录: /Users/xxx/.claude/skills
[SkillService] 开始初始化...
[SkillService] 扫描完成，成功注册 10 个 Skill
```

**如果看到错误**:
- ❌ "Failed to resolve module specifier 'path'" → IPC架构未生效，检查electron-sandbox/skills.contribution.ts
- ❌ "Skills目录不存在" → 运行 `bash test-skills.sh` 确认Skills文件

### 3. 验证UI显示

1. 点击右侧边栏的 **"码弦 Agent"** 图标（机器人图标）
2. 应该看到两个选项卡：
   - **MaXian** - AI对话界面
   - **Skills** - Skills管理界面 ⬅️ **重点检查这个**

### 4. 测试Skills功能

点击 **Skills** 选项卡后，应该看到：

```
┌─────────────────────────────────────────┐
│  Skills Management                      │
│  [Search skills...]  [All Categories ▼]│
├─────────────────────────────────────────┤
│  📝 Code Review      [Official]         │
│  代码审查最佳实践和检查清单             │
│  📁 Code Quality  💬 1500 tokens        │
│  [View Details]                         │
├─────────────────────────────────────────┤
│  🔧 Git Workflow    [Official]          │
│  ...                                    │
└─────────────────────────────────────────┘
```

**测试清单**:
- [ ] 显示10个官方Skills
- [ ] 每个Skill显示图标、名称、描述
- [ ] 搜索框输入"code"，过滤结果正确
- [ ] 分类下拉框选择"Security"，显示Security Skill
- [ ] 点击"View Details"，详情面板正常显示

### 5. 完整测试（可选）

如果需要更详细的测试，参考：
- [SKILLS_TESTING_GUIDE.md](./SKILLS_TESTING_GUIDE.md) - 12个完整测试场景
- [test-skills.sh](./test-skills.sh) - 自动化测试脚本

## 常见问题

### Q1: Skills选项卡不显示

**检查**:
```bash
# 1. 确认编译成功
npm run compile

# 2. 检查是否导入了contribution
grep "skills/browser/skills.contribution" src/vs/workbench/workbench.common.main.ts
# 应该看到: import './contrib/skills/browser/skills.contribution.js';

grep "skills/electron-sandbox/skills.contribution" src/vs/workbench/workbench.desktop.main.ts
# 应该看到: import './contrib/skills/electron-sandbox/skills.contribution.js';
```

### Q2: 仍然看到 "path" 模块错误

**检查**:
```bash
# electron-sandbox contribution 应该使用 registerMainProcessRemoteService
cat src/vs/workbench/contrib/skills/electron-sandbox/skills.contribution.ts

# 应该看到:
# registerMainProcessRemoteService(ISkillService, 'skill');
# 而不是:
# registerSingleton(ISkillService, SkillServiceImpl, ...)
```

### Q3: Skills数量不对

**检查**:
```bash
# 运行测试脚本
bash test-skills.sh

# 应该看到 "找到 10/10 个Skills"
```

## 成功标志

所有测试通过后，你应该：
- ✅ 无 "Failed to resolve module specifier" 错误
- ✅ Console显示 "成功注册 10 个 Skill"
- ✅ Skills选项卡正常显示
- ✅ 可以浏览、搜索、查看Skills详情
- ✅ Skills UI响应流畅，无卡顿

## 下一步

修复验证成功后，可以：
1. 测试skill工具集成（在AI对话中使用Skills）
2. 完成Task #15: Sprint 1集成测试和文档
3. 开始使用Skills系统优化AI性能

## 帮助

如果遇到问题：
1. 查看完整错误日志（Console + Terminal）
2. 参考 [SKILLS_IPC_FIX.md](./SKILLS_IPC_FIX.md) 了解修复细节
3. 运行 `bash test-skills.sh` 进行诊断
