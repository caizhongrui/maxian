# 如何测试 Skills 系统

## 1. 重新加载 IDE 窗口

修改已经编译完成，现在需要重新加载IDE来应用更改：

**方法A：使用命令面板**
1. 按 `Cmd+Shift+P` (Mac) 或 `Ctrl+Shift+P` (Windows/Linux)
2. 输入 "Reload Window"
3. 选择 "Developer: Reload Window"

**方法B：停止并重新启动**
```bash
# 停止当前IDE
pkill -f "Electron"

# 重新启动
./scripts/code.sh
```

## 2. 测试 Skills UI

### 2.1 打开 Skills 视图

1. 在IDE右侧点击 **"码弦 Agent"** 图标
2. 点击 **"Skills"** 标签
3. 应该看到 10 个 Skills 卡片

### 2.2 测试 View Details 按钮

1. 点击任意 Skill 卡片的 **"View Details"** 按钮
2. **预期结果**：
   - 右侧出现详情面板
   - 显示Skill的完整信息：
     - 名称和图标
     - 版本、分类、作者
     - 完整的Markdown内容（渲染后）
     - Tags
     - 预估Token数

3. 详情面板应该显示：
   ```
   ┌─────────────────┬──────────────────────┐
   │                 │  📚 Code Review      │
   │  Skills 列表    │  v1.0.0              │
   │  (10个卡片)     │  ─────────────────   │
   │                 │  Description...      │
   │  🔍 搜索框      │  Metadata...         │
   │  📂 分类过滤    │  Content...          │
   │                 │  (Markdown渲染)      │
   └─────────────────┴──────────────────────┘
   ```

### 2.3 测试 Edit 按钮

1. 点击任意 Skill 卡片的 **"Edit"** 按钮
2. **预期结果**：
   - 在IDE编辑器中打开对应的 `skill.md` 文件
   - 文件路径：`~/.claude/skills/<skill-slug>/skill.md`
   - 可以直接编辑Skill内容
   - 保存后，Skills系统会自动监听变化并重新加载

### 2.4 测试搜索功能

1. 在搜索框中输入关键词（如 "code"）
2. **预期结果**：Skills列表实时过滤，只显示匹配的Skills

### 2.5 测试分类过滤

1. 在分类下拉框中选择一个分类（如 "Code Quality"）
2. **预期结果**：只显示该分类的Skills

## 3. 测试 skill 工具（AI 对话中使用）

### 3.1 基本使用

在码弦 Agent 对话框中输入：

```
使用 code-review skill 来审查这段代码：

function add(a, b) {
    return a + b
}
```

**预期结果**：
1. Console中显示：`[SkillTool] Loading skill: code-review`
2. Console中显示：`[SkillTool] Skill loaded successfully, content length: ~1500`
3. AI加载 code-review Skill 的内容（~1500 tokens）
4. 根据Skill的指导原则进行代码审查
5. 提供专业的审查意见

**重要提示**：
- 如果看不到 `[SkillTool]` 日志，说明skill工具没有被AI调用
- 检查系统提示词中是否包含Skills目录（应该显示10个可用Skills）
- 确认已经重新加载IDE窗口（Developer: Reload Window）

### 3.2 技能列表

可用的Skills（可以在对话中提及）：

| Skill | 用途 | 示例 |
|-------|------|------|
| `code-review` | 代码审查 | "用 code-review skill 审查这段代码" |
| `debugging` | 调试指导 | "用 debugging skill 帮我定位这个bug" |
| `testing` | 测试策略 | "用 testing skill 写测试用例" |
| `refactoring` | 重构建议 | "用 refactoring skill 重构这个函数" |
| `security` | 安全审查 | "用 security skill 检查安全问题" |
| `performance` | 性能优化 | "用 performance skill 优化性能" |
| `documentation` | 文档编写 | "用 documentation skill 写文档" |
| `architecture` | 架构设计 | "用 architecture skill 设计系统" |
| `api-design` | API设计 | "用 api-design skill 设计API" |
| `git-workflow` | Git工作流 | "用 git-workflow skill 管理分支" |

### 3.3 验证 Skill 加载

在浏览器开发者工具(F12) Console中查看：

```
[SkillTool] Loading skill: code-review
[SkillTool] Skill loaded successfully, content length: 1500
```

## 4. 验证功能正常的检查清单

- [ ] ✅ IDE启动无错误
- [ ] ✅ Skills选项卡显示
- [ ] ✅ 显示10个Skills卡片
- [ ] ✅ 搜索功能工作正常
- [ ] ✅ 分类过滤工作正常
- [ ] ✅ **View Details 按钮点击后显示详情面板**
- [ ] ✅ **详情面板显示完整内容**
- [ ] ✅ **Edit 按钮点击后打开编辑器**
- [ ] ✅ **编辑器打开正确的 skill.md 文件**
- [ ] ✅ AI对话中可以使用Skills
- [ ] ✅ Skills内容正确加载到AI上下文

## 5. 常见问题排查

### 问题1：View Details 没有反应

**可能原因**：
- 代码没有重新编译
- IDE窗口没有重新加载

**解决方法**：
1. 确认已运行 `npm run compile` 且无错误
2. 重新加载IDE窗口（Developer: Reload Window）
3. 查看浏览器Console是否有JavaScript错误

### 问题2：Edit按钮没有反应

**可能原因**：
- 文件路径不正确
- Skills目录不存在

**解决方法**：
1. 查看Console中的错误信息
2. 确认 `~/.claude/skills/<skill-slug>/skill.md` 文件存在
3. 检查文件权限

### 问题3：详情面板显示空白

**可能原因**：
- SkillDetailsPanel初始化失败
- Markdown渲染问题

**解决方法**：
1. 检查Console错误
2. 确认Skill内容格式正确（YAML frontmatter + Markdown）
3. 重新加载窗口

## 6. 调试技巧

### 6.1 查看Skills加载日志

**主进程日志** (Output面板 → "Log (Main)"):
```
[SkillService] 初始化，Skills 目录: /Users/xxx/.claude/skills
[SkillService] 扫描完成，成功注册 10 个 Skill
```

**渲染进程日志** (浏览器F12 Console):
```
[SkillsView] Loading skills...
[SkillsView] Loaded 10 skills
[SkillsView] View skill details: code-review
```

### 6.2 测试Skill文件格式

```bash
# 验证Skill文件格式
cat ~/.claude/skills/code-review/skill.md

# 应该看到：
# ---
# name: Code Review
# description: Professional code review guidelines
# category: code-quality
# ...
# ---
#
# # Code Review Best Practices
# ...
```

### 6.3 手动测试Skill加载

在浏览器Console中测试：

```javascript
// 获取SkillService
const skillService = /* ... */;

// 测试加载
skillService.get('code-review').then(skill => {
  console.log('Skill:', skill);
});
```

## 7. 性能验证

### 7.1 Token节省测试

不使用Skill（传统方式）：
```
System Prompt: ~9800 tokens
```

使用Skill（按需加载）：
```
System Prompt (无Skill): ~200 tokens
Skill content (按需加载): ~1500 tokens (code-review)
─────────────────────────────────────
总计: ~1700 tokens
节省: ~8100 tokens (82%)
```

### 7.2 加载性能

- Skills扫描时间: < 100ms
- 单个Skill加载: < 50ms
- UI渲染: < 300ms

## 8. 下一步

完成测试后：

1. ✅ 验证所有功能正常
2. ✅ 完成 Task #15: Sprint 1集成测试和文档
3. ✅ 创建用户手册
4. ✅ 准备发布 1.0 版本

---

**测试完成标准**：
- 所有检查清单项目通过
- 无Console错误
- UI响应流畅
- Skills内容正确加载
