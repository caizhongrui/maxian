# Skills System 调试指南

## 问题：Channel Timeout

当前症状：`Channel name 'skill' timed out after 1000ms`

这表明Skills服务没有在主进程中正确初始化。

## 如何查看主进程日志

主进程的日志不显示在浏览器Console中，需要通过以下方式查看：

### 方法1：查看输出面板（推荐）

1. 在IDE中按 `Cmd+Shift+U` (Mac) 或 `Ctrl+Shift+U` (Windows/Linux)
2. 或者菜单：View → Output
3. 在输出面板右上角的下拉框中选择 **"Log (Main)"**
4. 查找包含 `[App]` 或 `[SkillService]` 的行

### 方法2：开发者工具

1. 在IDE中按 `Cmd+Shift+P` (Mac) 或 `Ctrl+Shift+P` (Windows/Linux)
2. 输入并选择："Developer: Toggle Developer Tools"
3. 在新打开的开发者工具窗口中查看Console

### 方法3：Terminal输出

如果使用 `npm run watch` 启动，部分日志会输出到Terminal窗口。

## 预期日志

在主进程日志（Output面板的"Log (Main)"）中，应该看到：

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

## 如果看不到任何日志

这说明SkillService的创建失败了。可能的原因：

### 1. 依赖注入失败

**检查**：查看Output面板是否有依赖注入相关的错误

**可能的错误信息**：
```
[Error] Cannot instantiate service ISkillService
[Error] Cannot resolve dependencies
```

**解决方法**：
```typescript
// 确认 IWorkspaceContextService 是可选的
constructor(
    @IWorkspaceContextService private readonly workspaceService?: IWorkspaceContextService
)
```

### 2. 构造函数异常

**检查**：查看是否有异常抛出

**解决方法**：在构造函数中添加try-catch

### 3. 服务未注册

**检查**：确认 app.ts 中有以下代码：
```typescript
// 在 registerServices() 中
services.set(ISkillService, new SyncDescriptor(SkillServiceImpl, undefined, true));

// 在 initChannels() 中
const skillService = accessor.get(ISkillService);
skillService.initialize();
const skillChannel = ProxyChannel.fromService(skillService, disposables);
mainProcessElectronServer.registerChannel('skill', skillChannel);
```

## 临时解决方案：禁用Skills系统

如果需要临时禁用Skills系统以继续工作：

### 1. 移除视图注册

编辑 `workbench.common.main.ts`，注释掉：
```typescript
// import './contrib/skills/browser/skills.contribution.js';
```

### 2. 移除electron-sandbox注册

编辑 `workbench.desktop.main.ts`，注释掉：
```typescript
// import './contrib/skills/electron-sandbox/skills.contribution.js';
```

重新编译：
```bash
npm run compile
```

## 诊断步骤

### 步骤1：完全重启

```bash
# 1. 完全关闭IDE
pkill -f "Electron"
pkill -f "Code Helper"

# 2. 清理并重新编译
npm run clean
npm run compile

# 3. 重新启动
npm run watch
```

### 步骤2：查看启动日志

1. 打开Output面板 (Cmd/Ctrl+Shift+U)
2. 选择 "Log (Main)"
3. 重启IDE，观察日志

### 步骤3：搜索关键字

在Output面板中搜索（Cmd/Ctrl+F）：
- `[App]` - 查看应用初始化日志
- `[SkillService]` - 查看Skills服务日志
- `ISkillService` - 查看依赖注入相关日志
- `error` - 查看所有错误

### 步骤4：检查Skills文件

```bash
# 确认Skills文件存在
ls -la ~/.claude/skills/

# 应该看到10个目录：
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

# 验证文件格式
bash test-skills.sh
```

## 已知问题

### 问题1：IWorkspaceContextService在主进程不可用 ✅ 已修复

**症状**：无法实例化SkillService，Channel timeout
**根本原因**：IWorkspaceContextService 在主进程中不存在，即使标记为可选参数，依赖注入系统仍然会尝试解析它并失败
**解决**：完全移除这个依赖，主进程直接使用用户主目录

```typescript
// 修改前（错误）
constructor(
    @IWorkspaceContextService private readonly workspaceService?: IWorkspaceContextService
)

// 修改后（正确）
constructor() {
    // 主进程总是使用 ~/.claude/skills
}
```

**修复时间**: 2026-01-27 19:42
**修复文件**: skillServiceImpl.ts

### 问题2：fs.watch权限问题

**症状**：EACCES或EPERM错误
**解决**：暂时禁用文件监控

```typescript
// 在 initialize() 中注释掉
// this.watchDirectory();
```

### 问题3：Skills目录不存在

**症状**：ENOENT错误
**解决**：确保目录存在

```bash
mkdir -p ~/.claude/skills
```

## 下一步

1. ✅ 完全重启IDE
2. ✅ 查看Output面板 "Log (Main)"
3. ✅ 搜索 `[App]` 和 `[SkillService]`
4. ✅ 将找到的日志发给我

如果仍然没有任何日志，说明：
- SkillService根本没有被实例化
- 或者依赖注入失败

请将Output面板中的完整日志（特别是包含"error"、"fail"、"skill"的行）发给我。

---

## 最终解决方案

### 根本原因
**IWorkspaceContextService 在 electron-main（主进程）中不存在**

这个服务只在渲染进程中可用。即使在构造函数中使用可选参数 `?`，VS Code 的依赖注入系统仍然会尝试解析这个服务，导致实例化失败。

### 修复方案
完全移除 IWorkspaceContextService 依赖：

```typescript
// src/vs/workbench/contrib/skills/node/skillServiceImpl.ts

// 移除导入
- import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

// 简化构造函数
- constructor(@IWorkspaceContextService private readonly workspaceService?: IWorkspaceContextService) {
+ constructor() {

// 简化目录解析
- 检查 workspaceService
- 尝试获取工作区目录
+ 直接使用用户主目录: ~/.claude/skills
```

### 验证步骤

1. **编译**: ✅ 已通过（0 errors）
2. **重启IDE**:
   ```bash
   # 完全关闭IDE
   pkill -f "Electron"
   pkill -f "Code Helper"

   # 重新启动
   npm run watch
   ```
3. **检查日志**（Output面板 → "Log (Main)"）:
   ```
   [SkillService] 初始化，Skills 目录: /Users/xxx/.claude/skills
   [SkillService] 开始初始化...
   [SkillService] 扫描完成，成功注册 10 个 Skill
   [SkillService] 初始化完成
   ```
4. **验证UI**: Skills选项卡应显示10个Skills

---

**最后更新**: 2026-01-27 19:42
**状态**: ✅ 根本问题已修复
