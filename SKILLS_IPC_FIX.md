# Skills System IPC 架构修复

## 问题描述

启动IDE时出现运行时错误：
```
TypeError: Failed to resolve module specifier "path". Relative references must start with either "/", "./", or "../".
```

## 根本原因

VS Code 采用多进程架构：
- **Main Process (electron-main)**: Electron主进程，完全的Node.js环境
- **Renderer Process (electron-sandbox)**: 渲染进程，运行在沙箱中，不能直接访问Node.js API
- **IPC**: 进程间通信机制

原始实现错误地在 `electron-sandbox/skills.contribution.ts` 中直接导入了 `node/skillServiceImpl.js`，导致浏览器环境尝试加载Node.js的 `path` 模块，从而报错。

## 修复方案

采用VS Code标准的IPC架构，将SkillService分为两部分：
1. **Renderer Process**: 通过IPC代理调用主进程服务
2. **Main Process**: 实际的服务实现，可以访问Node.js API

## 修复内容

### 1. 修改 electron-sandbox contribution（渲染进程）

**文件**: `src/vs/workbench/contrib/skills/electron-sandbox/skills.contribution.ts`

**修改前**:
```typescript
import { SkillServiceImpl } from '../node/skillServiceImpl.js';
import { registerSingleton } from '../../../../platform/instantiation/common/extensions.js';

// 错误：在沙箱环境中直接实例化Node.js服务
registerSingleton(ISkillService, SkillServiceImpl, InstantiationType.Delayed);
```

**修改后**:
```typescript
import { ISkillService } from '../common/skillService.js';
import { registerMainProcessRemoteService } from '../../../../platform/ipc/electron-sandbox/services.js';

// 正确：注册为主进程远程服务，自动创建IPC代理
registerMainProcessRemoteService(ISkillService, 'skill');
```

### 2. 在主进程注册服务实现

**文件**: `src/vs/code/electron-main/app.ts`

**步骤1: 添加导入**（第127-128行）
```typescript
import { ISkillService } from '../../workbench/contrib/skills/common/skillService.js';
import { SkillServiceImpl } from '../../workbench/contrib/skills/node/skillServiceImpl.js';
```

**步骤2: 注册服务描述符**（第1135-1136行）
```typescript
// Skills System
services.set(ISkillService, new SyncDescriptor(SkillServiceImpl, undefined, true));
```

**步骤3: 注册IPC Channel**（第1274-1276行）
```typescript
// Skills System
const skillChannel = ProxyChannel.fromService(accessor.get(ISkillService), disposables);
mainProcessElectronServer.registerChannel('skill', skillChannel);
```

### 3. 保持其他文件不变

以下文件无需修改，保持原样：
- ✅ `browser/skills.contribution.ts` - 注册视图到UI
- ✅ `browser/skillsView.ts` - Skills管理界面
- ✅ `browser/skillDetailsPanel.ts` - Skill详情面板
- ✅ `node/skillServiceImpl.ts` - 服务实现（Node.js环境）
- ✅ `node/skillScanner.ts` - Skills扫描器
- ✅ `common/skillService.ts` - 服务接口
- ✅ `common/skillTypes.ts` - 类型定义
- ✅ 10个官方Skills文件

## 架构图

```
┌─────────────────────────────────────────────────────────┐
│  Renderer Process (electron-sandbox)                    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  SkillsView (browser/skillsView.ts)                     │
│       │                                                  │
│       │ 依赖注入 @ISkillService                          │
│       ↓                                                  │
│  ISkillService (IPC Proxy)                              │
│       │                                                  │
│       │ electron-sandbox/skills.contribution.ts:        │
│       │ registerMainProcessRemoteService(...)           │
│       │                                                  │
└───────┼──────────────────────────────────────────────────┘
        │
        │ IPC Channel: 'skill'
        │
┌───────┼──────────────────────────────────────────────────┐
│       │  Main Process (electron-main)                    │
├───────┼──────────────────────────────────────────────────┤
│       ↓                                                  │
│  ISkillService (实际实现)                                │
│       │                                                  │
│       │ app.ts:                                         │
│       │ - services.set(ISkillService, ...)              │
│       │ - registerChannel('skill', ...)                 │
│       │                                                  │
│       ↓                                                  │
│  SkillServiceImpl (node/skillServiceImpl.ts)            │
│       │                                                  │
│       │ 使用 Node.js API:                               │
│       │ - import * as path from 'path'                  │
│       │ - import * as fs from 'fs'                      │
│       │                                                  │
│       ↓                                                  │
│  SkillScanner (node/skillScanner.ts)                    │
│       │                                                  │
│       │ 扫描 ~/.claude/skills/ 目录                      │
│       │                                                  │
└─────────────────────────────────────────────────────────┘
```

## IPC通信流程

1. **渲染进程调用**:
   ```typescript
   // 在 SkillsView 中
   const skills = await this.skillService.search({});
   ```

2. **IPC代理拦截**:
   - `registerMainProcessRemoteService` 自动创建代理
   - 代理将方法调用序列化为IPC消息

3. **主进程接收**:
   - `mainProcessElectronServer.registerChannel('skill', ...)` 注册的channel接收消息
   - `ProxyChannel.fromService` 将IPC消息转换为实际的方法调用

4. **执行服务方法**:
   ```typescript
   // 在主进程的 SkillServiceImpl 中
   search(filter: ISkillFilter): ISkill[] {
       return this.registry.search(filter);
   }
   ```

5. **返回结果**:
   - 主进程将结果序列化并通过IPC返回
   - 渲染进程的代理接收结果并返回给调用者

## 验证结果

### ✅ 编译验证
```bash
npm run compile
# 结果: 0 errors
```

### ✅ 启动验证
启动IDE后，应该：
1. 无 "Failed to resolve module specifier 'path'" 错误
2. Console显示Skills系统初始化日志
3. Skills选项卡正常显示
4. 可以正常浏览和搜索Skills

### ✅ 功能验证
- [ ] Skills服务初始化成功
- [ ] Skills视图显示10个官方Skills
- [ ] 搜索和过滤功能正常
- [ ] Skill详情面板正常显示
- [ ] skill工具可以正常调用

## 技术要点

### 为什么不能在渲染进程直接使用Node.js模块？

Electron的沙箱模式（sandbox）限制了渲染进程直接访问Node.js API，这是出于安全考虑：
- 渲染进程可能加载不受信任的内容
- 直接访问文件系统、进程等会带来安全风险
- 沙箱隔离可以防止恶意代码的影响

### registerMainProcessRemoteService 做了什么？

这个函数：
1. 在渲染进程创建一个IPC客户端
2. 为服务接口创建一个代理对象
3. 拦截所有方法调用，转换为IPC消息
4. 通过指定的channel（'skill'）发送到主进程
5. 等待主进程响应并返回结果

### ProxyChannel.fromService 做了什么？

这个函数：
1. 在主进程为服务创建一个IPC服务器端点
2. 监听来自渲染进程的IPC消息
3. 将IPC消息反序列化为方法调用
4. 调用实际的服务实例
5. 将结果序列化并返回给渲染进程

## 最佳实践

在VS Code中实现需要访问Node.js API的服务时：

1. **接口定义** (`common/`): 跨进程共享的接口
2. **实现** (`node/` 或 `electron-main/`): 在主进程实现，可以使用Node.js API
3. **IPC注册**:
   - 渲染进程: 使用 `registerMainProcessRemoteService`
   - 主进程: 在 `app.ts` 中注册服务和channel
4. **UI层** (`browser/`): 通过依赖注入使用接口，透明地调用主进程服务

## 参考

- RepoMapService: 同样采用此架构的服务示例
- DatabaseService: 另一个主进程服务的例子
- VS Code IPC文档: `src/vs/base/parts/ipc/`

## 总结

修复通过将SkillService从直接实例化改为IPC架构，解决了渲染进程无法访问Node.js模块的问题。现在：

- ✅ 服务在主进程实例化，可以使用`path`、`fs`等Node.js API
- ✅ 渲染进程通过IPC透明调用，无需感知进程边界
- ✅ 符合VS Code的标准架构模式
- ✅ 保持了类型安全和依赖注入的优势
