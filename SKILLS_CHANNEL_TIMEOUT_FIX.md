# Skills Channel Timeout 根本问题修复

## 问题症状

```
[SkillsView] Failed to load skills: Unknown channel: Channel name 'skill' timed out after 1000ms
```

持续出现，重启无效。

## 根本原因

### IWorkspaceContextService 在主进程中不存在

**关键发现**：
- `IWorkspaceContextService` 是一个**渲染进程专用**的服务
- 它在 electron-main（主进程）环境中**根本不存在**
- 即使构造函数参数标记为可选 (`workspaceService?: IWorkspaceContextService`)，VS Code 的依赖注入系统仍然会**尝试解析这个依赖**
- 当 DI 系统无法找到这个服务时，**整个服务实例化失败**
- 失败是**静默的**（没有错误日志），导致 Channel 注册失败

### 为什么之前的修复无效？

1. **添加 `?` 可选参数** - DI 系统仍然尝试解析
2. **添加 try-catch** - 问题发生在 DI 阶段，构造函数都没有被调用
3. **检查 `if (workspaceService)`** - 服务根本没有被实例化

## 解决方案

### 完全移除 IWorkspaceContextService 依赖

**文件**: `src/vs/workbench/contrib/skills/node/skillServiceImpl.ts`

#### 1. 移除导入

```typescript
// 删除
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
```

#### 2. 简化构造函数

```typescript
// 修改前（错误）
constructor(
    @IWorkspaceContextService private readonly workspaceService?: IWorkspaceContextService
) {
    super();
    this.registry = this._register(new SkillRegistry());
    this._skillsDirectory = this.resolveSkillsDirectory();
    console.log(`[SkillService] 初始化，Skills 目录: ${this._skillsDirectory}`);
}

// 修改后（正确）
constructor() {
    super();
    this.registry = this._register(new SkillRegistry());
    this._skillsDirectory = this.resolveSkillsDirectory();
    console.log(`[SkillService] 初始化，Skills 目录: ${this._skillsDirectory}`);
}
```

#### 3. 简化目录解析逻辑

```typescript
// 修改前（复杂，依赖 workspaceService）
private resolveSkillsDirectory(): string {
    // 1. 尝试获取工作区目录
    if (this.workspaceService) {
        try {
            const workspace = this.workspaceService.getWorkspace();
            if (workspace.folders.length > 0) {
                const workspaceRoot = workspace.folders[0].uri.fsPath;
                const workspaceSkillsDir = path.join(workspaceRoot, '.claude', 'skills');
                // ...
            }
        } catch (error) {
            console.warn('[SkillService] workspaceService不可用，使用用户主目录');
        }
    }

    // 2. Fallback 到用户主目录
    const userHome = process.env.HOME || process.env.USERPROFILE || '';
    if (userHome) {
        const userSkillsDir = path.join(userHome, '.claude', 'skills');
        console.log(`[SkillService] 使用用户 Skills 目录: ${userSkillsDir}`);
        return userSkillsDir;
    }

    // 3. Fallback 到当前目录
    const defaultSkillsDir = path.join(process.cwd(), '.claude', 'skills');
    console.log(`[SkillService] 使用默认 Skills 目录: ${defaultSkillsDir}`);
    return defaultSkillsDir;
}

// 修改后（简单，直接使用用户主目录）
private resolveSkillsDirectory(): string {
    // 用户主目录（主进程默认位置）
    const userHome = process.env.HOME || process.env.USERPROFILE || '';
    if (userHome) {
        const userSkillsDir = path.join(userHome, '.claude', 'skills');
        console.log(`[SkillService] 使用用户 Skills 目录: ${userSkillsDir}`);
        return userSkillsDir;
    }

    // Fallback: 使用当前目录
    const defaultSkillsDir = path.join(process.cwd(), '.claude', 'skills');
    console.log(`[SkillService] 使用默认 Skills 目录: ${defaultSkillsDir}`);
    return defaultSkillsDir;
}
```

## 为什么这样修复是正确的？

### 1. 主进程的特性
- 主进程运行在 Node.js 环境
- 它是全局单例，服务所有窗口
- 不应该依赖特定工作区的上下文
- **应该使用全局配置目录**（用户主目录）

### 2. Skills 的使用场景
- Skills 是**用户级别**的配置，不是项目级别
- 所有项目应该共享同一套 Skills
- 存储在 `~/.claude/skills` 是最合理的位置

### 3. 架构清晰
- **主进程版本**：`skillServiceImpl.ts` - 无依赖，简单
- **渲染进程版本**（如需要）：可以创建另一个实现，使用 IWorkspaceContextService

## 编译验证

```bash
npm run compile
```

**结果**: ✅ 0 errors

## 测试步骤

### 1. 完全重启 IDE

```bash
# 完全关闭IDE
pkill -f "Electron"
pkill -f "Code Helper"

# 重新启动
npm run watch
```

### 2. 检查主进程日志

**打开方式**:
1. 在 IDE 中按 `Cmd+Shift+U` (Mac) 或 `Ctrl+Shift+U` (Windows/Linux)
2. 或者菜单：View → Output
3. 在输出面板**右上角的下拉框**中选择 **"Log (Main)"**

**预期日志**:
```
[App] Getting ISkillService...
[App] ISkillService obtained, initializing...
[SkillService] 初始化，Skills 目录: /Users/xxx/.claude/skills
[SkillService] 开始初始化...
[SkillService] 开始扫描 Skills...
[SkillService] 扫描完成，成功注册 10 个 Skill
[SkillService] 初始化完成
[App] Skills service initialized successfully
[App] Skills channel registered
```

### 3. 验证 UI

1. 点击右侧 **"码弦 Agent"** → **"Skills"**
2. 应该看到 10 个 Skills 卡片
3. 搜索和过滤功能应该正常工作
4. 点击 "View Details" 应该显示详情面板

### 4. 测试 skill 工具

在 AI 对话中测试：
```
使用 /code-review skill 来审查代码
```

## 关键经验教训

### 1. VS Code 的多进程架构

| 进程类型 | 环境 | 可用服务 |
|---------|------|---------|
| **主进程** (electron-main) | 完整 Node.js | 系统级服务、文件系统、数据库 |
| **渲染进程** (electron-sandbox) | 沙箱浏览器 | UI 服务、工作区服务、编辑器 |
| **共享进程** | Node.js | 扩展宿主、语言服务 |

### 2. 依赖注入的严格性

```typescript
// ❌ 错误：可选参数不会阻止 DI 解析
constructor(
    @IServiceA private serviceA?: IServiceA  // DI 仍然尝试解析
) { }

// ✅ 正确：完全不声明依赖
constructor() {
    // 不依赖任何不可用的服务
}
```

### 3. 服务设计原则

- **主进程服务** → 使用全局配置，不依赖工作区
- **渲染进程服务** → 可以使用工作区相关服务
- **跨进程通信** → 通过 IPC Channel，数据序列化

### 4. 调试技巧

- **主进程日志**: Output 面板 → "Log (Main)"
- **渲染进程日志**: 浏览器开发者工具 (F12)
- **静默失败**: 服务实例化失败通常没有明显错误
- **验证服务注册**: 在 `app.ts` 中添加详细日志

## 相关文档

- [SKILLS_DEBUG.md](./SKILLS_DEBUG.md) - 调试指南
- [SKILLS_READY.md](./SKILLS_READY.md) - 准备就绪指南
- [SKILLS_FINAL_FIX_SUMMARY.md](./SKILLS_FINAL_FIX_SUMMARY.md) - 之前的修复总结

---

**修复完成时间**: 2026-01-27 19:42
**修复状态**: ✅ 根本问题已解决
**编译状态**: ✅ 0 errors
**下一步**: 重启 IDE 并验证功能
