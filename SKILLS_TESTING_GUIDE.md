# Skills 系统测试指南

## 测试前准备

### 1. 确认编译成功
```bash
cd /Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/tianhe-zhikai-ide
npm run compile
```

### 2. 确认Skills文件存在
```bash
# 检查Skills目录
ls -la ~/.claude/skills/

# 应该看到10个Skill目录：
# code-review/
# git-workflow/
# debugging/
# testing/
# refactoring/
# security/
# performance/
# documentation/
# architecture/
# api-design/
```

### 3. 启动IDE
```bash
npm run watch  # 开发模式
# 或
./scripts/code.sh  # 如果有启动脚本
```

## 测试场景

### 场景1: Skills服务初始化测试

**目标**: 验证SkillService正确初始化并扫描Skills

**步骤**:
1. 打开浏览器开发者工具 (F12)
2. 切换到Console标签
3. 查看启动日志，应该看到:
   ```
   [SkillService] Initializing...
   [SkillScanner] Scanning directory: /Users/xxx/.claude/skills
   [SkillService] Successfully loaded 10 skills
   ```

**预期结果**:
- ✅ 无错误日志
- ✅ 成功加载10个Skills
- ✅ 每个Skill的metadata正确解析

**失败排查**:
- 检查Skills目录路径是否正确
- 检查SKILL.md文件格式是否正确
- 查看详细错误日志

---

### 场景2: Skills UI视图测试

**目标**: 验证Skills管理界面正常显示

**步骤**:
1. 点击右侧边栏的"码弦 Agent"图标（机器人图标）
2. 在视图容器中找到"Skills"选项卡
3. 点击"Skills"选项卡

**预期结果**:
```
┌─────────────────────────────────────────┐
│  Skills Management                      │
│  Manage your AI assistant's...          │
├─────────────────────────────────────────┤
│  [Search skills...]  [All Categories ▼]│
├─────────────────────────────────────────┤
│  📝 Code Review      [Official]         │
│  代码审查最佳实践和检查清单             │
│  📁 Code Quality  💬 1500 tokens        │
│  ...                                    │
└─────────────────────────────────────────┘
```

- ✅ 显示10个Skill卡片
- ✅ 每个卡片显示图标、名称、描述
- ✅ Official标记显示正确
- ✅ Token估算显示正确

**失败排查**:
- 检查视图是否注册成功
- 检查Console是否有渲染错误
- 验证ISkillService注入是否成功

---

### 场景3: 搜索和过滤测试

**目标**: 验证搜索和分类过滤功能

**步骤**:

**测试3.1: 搜索功能**
1. 在搜索框输入 "code"
2. 观察结果

**预期结果**:
- ✅ 显示 "Code Review" Skill
- ✅ 其他Skills被过滤掉
- ✅ 搜索是实时的（无延迟）

**测试3.2: 分类过滤**
1. 点击分类下拉框
2. 选择 "Security"
3. 观察结果

**预期结果**:
- ✅ 只显示 "Security" Skill
- ✅ 其他分类的Skills被隐藏

**测试3.3: 组合搜索**
1. 选择分类 "All Categories"
2. 搜索框输入 "test"
3. 观察结果

**预期结果**:
- ✅ 显示 "Testing" Skill
- ✅ 搜索和过滤同时生效

---

### 场景4: Skill详情查看测试

**目标**: 验证Skill详情面板正常工作

**步骤**:
1. 在Skills列表中找到 "Code Review" Skill
2. 点击 "View Details" 按钮

**预期结果**:
```
┌─────────────────────────────────────────┐
│  📝  Code Review                        │
│  ✓ Official  Code Quality  v1.0.0      │
│  代码审查最佳实践和检查清单             │
├─────────────────────────────────────────┤
│  AUTHOR: Official                       │
│  TOKENS: 1500                           │
│  CREATED: Jan 27, 2026                  │
├─────────────────────────────────────────┤
│  # Code Review Skill                    │
│  (完整的Markdown渲染内容)               │
├─────────────────────────────────────────┤
│  [Edit Skill]  [Copy Content]  [Close] │
└─────────────────────────────────────────┘
```

- ✅ 详情面板正确打开
- ✅ Metadata显示正确
- ✅ Markdown内容正确渲染
- ✅ 代码块有语法高亮
- ✅ 操作按钮可用

**测试操作**:
- 点击 "Copy Content" → 验证内容已复制到剪贴板
- 点击 "Close" → 验证面板关闭

---

### 场景5: skill工具调用测试

**目标**: 验证AI可以通过skill工具加载Skills

**步骤**:
1. 打开MaXian对话视图
2. 在输入框输入测试消息（模拟触发skill工具）
3. 打开浏览器Console
4. 手动测试skill工具（通过Console）:

```javascript
// 在Console中执行
const skillService = /* 获取ISkillService实例 */;
const skill = skillService.get('code-review');
console.log('Skill loaded:', skill);
```

**预期结果**:
- ✅ skill工具能正确调用
- ✅ 返回完整的Skill内容
- ✅ 格式正确（Markdown）

**测试skill工具响应格式**:
```markdown
# Skill Activated: Code Review

**Category**: code-quality
**Version**: 1.0.0
**Estimated Tokens**: 1500

---

(Skill完整内容)

---

*Skill loaded successfully. Follow the instructions above.*
```

---

### 场景6: System Prompt Skills目录测试

**目标**: 验证Skills目录正确注入到System Prompt

**步骤**:
1. 创建一个新的对话
2. 在Console中检查System Prompt内容:

```javascript
// 查看System Prompt（需要从maxianService获取）
// 应该包含Skills目录
```

**预期结果**:

System Prompt应包含以下内容:
```markdown
====

AVAILABLE SKILLS (按需加载的专业知识)

当你需要特定领域的详细指导时，使用 <skill><skill_name>name</skill_name></skill> 工具加载：

📝 code-review - 代码审查最佳实践和检查清单 (~1500 tokens)
🔧 git-workflow - Git安全操作和工作流程规范 (~600 tokens)
🐛 debugging - 系统化调试方法和问题定位技巧 (~800 tokens)
...

使用方式：
1. 判断当前任务是否需要特定领域的详细指导
2. 使用skill工具加载对应的Skill
3. 按照加载的Skill中的指导完成任务

Token优化：
- System Prompt仅包含此简短目录 (<200 tokens)
- 完整Skill内容通过tool按需加载
- 平均节省45% tokens
```

- ✅ Skills目录完整
- ✅ 10个Skills都列出
- ✅ Token估算正确
- ✅ 使用说明清晰

---

### 场景7: 使用统计测试

**目标**: 验证Skill使用统计功能

**步骤**:
1. 在Console中调用skill工具加载一个Skill
2. 在Skills UI中查看该Skill
3. 验证使用次数更新

**手动测试代码**:
```javascript
// 在Console中执行
import { getSkillUsageStats } from './skillTool';

// 加载一个Skill
// ... (模拟调用)

// 查看统计
const stats = getSkillUsageStats();
console.log('Usage stats:', stats);
```

**预期结果**:
- ✅ 使用次数正确递增
- ✅ 最后激活时间更新
- ✅ 总token消耗累计正确

---

### 场景8: 文件监控测试

**目标**: 验证Skills文件修改后自动重新加载

**步骤**:
1. 打开 `~/.claude/skills/code-review/SKILL.md`
2. 修改description字段
3. 保存文件
4. 返回IDE，刷新Skills视图

**预期结果**:
- ✅ Skills自动重新加载
- ✅ UI显示更新后的描述
- ✅ Console显示重新加载日志

**日志示例**:
```
[SkillScanner] File changed: /Users/xxx/.claude/skills/code-review/SKILL.md
[SkillService] Rescanning skills...
[SkillService] Successfully loaded 10 skills
```

---

### 场景9: 错误处理测试

**目标**: 验证各种错误情况的处理

**测试9.1: 无效的Skill文件**
1. 创建一个格式错误的SKILL.md
2. 观察错误处理

**预期结果**:
- ✅ 显示友好的错误消息
- ✅ 不会导致整个系统崩溃
- ✅ 其他Skills正常加载

**测试9.2: Skills目录不存在**
1. 临时重命名 `~/.claude/skills` 目录
2. 重启IDE
3. 观察行为

**预期结果**:
- ✅ 显示空Skills列表
- ✅ 提示用户创建Skills目录
- ✅ 无崩溃错误

**测试9.3: Skill不存在**
1. 在Console中调用不存在的Skill:
```javascript
// skill({ skill_name: 'non-existent-skill' })
```

**预期结果**:
```
Error: Skill not found: "non-existent-skill"

💡 Available Skills:
  - code-review - 代码审查最佳实践和检查清单
  - git-workflow - Git工作流程和分支管理策略
  ...
```

---

## 性能测试

### 测试10: Skills加载性能

**目标**: 验证Skills加载速度

**步骤**:
1. 在Console中测量加载时间:

```javascript
console.time('Skills Load');
// 触发Skills加载
console.timeEnd('Skills Load');
```

**预期结果**:
- ✅ 初始加载 < 100ms（10个Skills）
- ✅ 重新扫描 < 50ms
- ✅ 单个Skill查询 < 1ms

### 测试11: UI渲染性能

**目标**: 验证UI流畅性

**步骤**:
1. 快速滚动Skills列表
2. 快速切换搜索关键词
3. 快速切换分类过滤

**预期结果**:
- ✅ 无卡顿
- ✅ 搜索响应 < 100ms
- ✅ 过滤响应即时

---

## 集成测试

### 测试12: 端到端完整流程

**目标**: 验证完整的Skills使用流程

**步骤**:
1. **启动IDE** → 验证Skills服务初始化
2. **打开Skills视图** → 验证UI正常显示
3. **搜索Skill** → 验证搜索功能
4. **查看详情** → 验证详情面板
5. **创建对话** → 验证System Prompt包含Skills目录
6. **AI调用skill工具** → 验证工具正常工作
7. **查看使用统计** → 验证统计更新
8. **修改Skill文件** → 验证自动重新加载

**预期结果**:
- ✅ 整个流程顺畅无阻
- ✅ 各个组件协同工作
- ✅ 无任何错误

---

## 自动化测试脚本

### 创建测试脚本

```typescript
// test/skills.test.ts

import { ISkillService } from '../src/vs/workbench/contrib/skills/common/skillService';
import { SkillCategory } from '../src/vs/workbench/contrib/skills/common/skillTypes';

describe('Skills System Tests', () => {
  let skillService: ISkillService;

  beforeEach(() => {
    // 初始化skillService
  });

  test('应该加载所有10个官方Skills', () => {
    const skills = skillService.search({});
    expect(skills).toHaveLength(10);
  });

  test('应该正确解析Skill metadata', () => {
    const skill = skillService.get('code-review');
    expect(skill).toBeDefined();
    expect(skill?.name).toBe('Code Review');
    expect(skill?.category).toBe(SkillCategory.CodeQuality);
    expect(skill?.official).toBe(true);
  });

  test('应该支持按分类搜索', () => {
    const skills = skillService.search({ category: SkillCategory.Security });
    expect(skills).toHaveLength(1);
    expect(skills[0].slug).toBe('security');
  });

  test('应该支持按标签搜索', () => {
    const skills = skillService.search({ tags: ['testing'] });
    expect(skills.length).toBeGreaterThan(0);
  });

  test('skill工具应该返回正确格式', async () => {
    const result = await skillTool(
      {} as any,
      { skill_name: 'code-review' },
      skillService
    );

    expect(result).toContain('# Skill Activated: Code Review');
    expect(result).toContain('**Category**: code-quality');
    expect(result).toContain('**Version**: 1.0.0');
  });
});
```

---

## 检查清单

### 基础功能
- [ ] Skills服务正确初始化
- [ ] 10个官方Skills全部加载
- [ ] Skills UI视图正常显示
- [ ] 搜索功能正常工作
- [ ] 分类过滤正常工作
- [ ] Skill详情面板正常显示
- [ ] Markdown内容正确渲染

### skill工具
- [ ] skill工具可以正确调用
- [ ] 返回格式正确
- [ ] 错误处理友好
- [ ] 使用统计正确更新

### System Prompt
- [ ] Skills目录正确注入
- [ ] 10个Skills全部列出
- [ ] Token估算准确
- [ ] 使用说明清晰

### 性能
- [ ] 加载速度 < 100ms
- [ ] UI响应流畅
- [ ] 无内存泄漏
- [ ] 文件监控工作正常

### 错误处理
- [ ] 无效Skill文件不会崩溃
- [ ] 不存在的Skill有友好提示
- [ ] Skills目录不存在有提示

---

## 常见问题排查

### 问题1: Skills不显示

**可能原因**:
- Skills目录路径错误
- SKILL.md格式错误
- 服务未初始化

**解决方法**:
1. 检查 `~/.claude/skills/` 目录是否存在
2. 检查SKILL.md文件格式
3. 查看Console错误日志
4. 重启IDE

### 问题2: skill工具调用失败

**可能原因**:
- ISkillService未正确注入
- Skill名称错误
- 服务未初始化

**解决方法**:
1. 验证依赖注入配置
2. 检查Skill slug拼写
3. 查看详细错误日志

### 问题3: UI不更新

**可能原因**:
- 事件监听器未注册
- 未调用重新渲染
- React状态未更新

**解决方法**:
1. 检查onDidChange事件监听
2. 确认调用了loadSkills()
3. 清空缓存重试

---

## 总结

完成以上所有测试后，Skills系统应该：
- ✅ 稳定可靠
- ✅ 性能优秀
- ✅ 用户友好
- ✅ Token高效

如有任何测试失败，请参考上述排查指南进行调试。
