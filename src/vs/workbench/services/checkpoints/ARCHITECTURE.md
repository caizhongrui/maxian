# Checkpoint Service 架构设计

## 系统概述

Checkpoint Service是一个基于Git的代码快照系统，集成到VS Code工作台服务层中，提供自动化的版本控制和回滚功能。

## 目录结构

```
checkpoints/
├── browser/                          # 浏览器端实现
│   ├── checkpointService.ts         # 主服务实现
│   └── index.ts                     # 导出索引
├── common/                          # 公共代码（浏览器+Node.js）
│   ├── checkpoints.ts              # 接口定义
│   ├── gitHelper.ts                # Git操作封装
│   ├── excludePatterns.ts          # 文件排除模式
│   └── index.ts                    # 导出索引
├── example.ts                      # 使用示例
├── README.md                       # 完整文档
├── QUICKSTART.md                   # 快速开始
└── ARCHITECTURE.md                 # 架构设计（本文件）
```

## 核心组件

### 1. ICheckpointService (接口层)

**文件**: `common/checkpoints.ts`

定义了服务的公共契约：

```typescript
export interface ICheckpointService {
    // 事件
    readonly onDidChangeCheckpoint: Event<ICheckpointEvent>;

    // 状态
    readonly isInitialized: boolean;
    readonly baseHash: string | undefined;

    // 操作
    initialize(options: ICheckpointServiceOptions): Promise<...>;
    saveCheckpoint(message: string, options?): Promise<...>;
    getCheckpoints(): ICheckpoint[];
    restoreCheckpoint(commitHash: string): Promise<void>;
    getDiff(options): Promise<ICheckpointDiff[]>;
    clear(): Promise<void>;
}
```

**设计原则**：
- 使用依赖注入模式 (`createDecorator`)
- 所有操作都是异步的
- 通过事件系统通知状态变化
- 强类型定义，提供完整的TypeScript支持

### 2. CheckpointService (实现层)

**文件**: `browser/checkpointService.ts`

主服务实现，继承自`Disposable`：

```typescript
export class CheckpointService extends Disposable implements ICheckpointService {
    // 依赖服务
    @ILogService private readonly logService
    @IStorageService private readonly storageService
    @ISCMService private readonly scmService
    @IWorkspaceContextService private readonly workspaceContextService
}
```

**职责**：
1. 管理检查点生命周期
2. 协调Git操作
3. 持久化检查点历史
4. 发出状态变化事件
5. 错误处理和日志记录

**状态管理**：
```typescript
private _isInitialized: boolean = false;
private _baseHash: string | undefined;
private _checkpoints: ICheckpoint[] = [];
private _gitHelper: GitHelper | undefined;
private _workspaceUri: URI | undefined;
private _storageUri: URI | undefined;
```

### 3. GitHelper (Git操作封装)

**文件**: `common/gitHelper.ts`

封装了所有Git相关操作：

```typescript
export class GitHelper {
    constructor(private readonly repository: ISCMRepository) {}

    // Git命令
    async executeCommand(args: string[]): Promise<IGitCommandResult>
    async getCurrentBranch(): Promise<string>
    async getCommit(hash: string): Promise<IGitCommitInfo | undefined>
    async getDiffSummary(from: string, to?: string): Promise<IGitDiffSummary>
    async stageAll(): Promise<void>
    async commit(message: string, options?): Promise<string>
    async reset(commitHash: string, hard?: boolean): Promise<void>
    async clean(options?): Promise<void>
    async show(commitHash: string, filePath: string): Promise<string>
}
```

**设计考虑**：
- 使用VS Code的SCM服务而不是直接调用Git
- 提供统一的错误处理
- 支持异步操作
- 可扩展性：易于添加新的Git操作

### 4. 排除模式系统

**文件**: `common/excludePatterns.ts`

定义了哪些文件应该被排除在检查点之外：

```typescript
export function getExcludePatterns(): string[] {
    return [
        '.git/',
        ...getBuildArtifactPatterns(),    // node_modules, dist, build等
        ...getMediaFilePatterns(),         // 图片、视频、音频
        ...getCacheFilePatterns(),         // .cache, .log等
        ...getConfigFilePatterns(),        // .env*, *.local等
        ...getLargeDataFilePatterns(),     // .zip, .tar等
        ...getDatabaseFilePatterns(),      // .db, .sqlite等
        ...getLogFilePatterns(),           // *.log, *.out等
    ];
}
```

**分类**：
- 构建产物
- 媒体文件
- 缓存文件
- 配置文件
- 大文件
- 数据库文件
- 日志文件

## 数据流

### 1. 初始化流程

```
用户调用 initialize()
    ↓
验证工作区路径
    ↓
查找或创建Git仓库
    ↓
创建GitHelper实例
    ↓
加载检查点历史（从Storage）
    ↓
获取当前commit hash作为baseHash
    ↓
设置 _isInitialized = true
    ↓
发出 'initialize' 事件
```

### 2. 保存检查点流程

```
用户调用 saveCheckpoint(message)
    ↓
检查初始化状态
    ↓
GitHelper.stageAll() - 暂存所有变更
    ↓
GitHelper.commit(message) - 创建提交
    ↓
GitHelper.getDiffSummary() - 获取变更统计
    ↓
创建 ICheckpoint 记录
    ↓
添加到 _checkpoints 数组
    ↓
保存到 Storage
    ↓
发出 'checkpoint' 事件
    ↓
返回 ICheckpointResult
```

### 3. 恢复检查点流程

```
用户调用 restoreCheckpoint(hash)
    ↓
检查初始化状态
    ↓
GitHelper.clean() - 清理未跟踪文件
    ↓
GitHelper.reset(hash, hard=true) - 硬重置到指定commit
    ↓
删除该commit之后的检查点记录
    ↓
更新 Storage
    ↓
发出 'restore' 事件
```

### 4. 获取差异流程

```
用户调用 getDiff({from, to})
    ↓
检查初始化状态
    ↓
GitHelper.getDiffSummary(from, to) - 获取变更文件列表
    ↓
对每个文件：
    ├─ GitHelper.show(from, file) - 获取旧内容
    └─ GitHelper.show(to, file) - 获取新内容
    ↓
组装 ICheckpointDiff[] 数组
    ↓
返回结果
```

## 事件系统

### 事件类型

```typescript
export interface ICheckpointEvent {
    readonly type: 'initialize' | 'checkpoint' | 'restore' | 'error';
    readonly workspaceUri?: URI;
    readonly commitHash?: string;
    readonly duration?: number;
    readonly error?: Error;
}
```

### 事件流

```
CheckpointService
    ↓
_onDidChangeCheckpoint (Emitter)
    ↓
onDidChangeCheckpoint (Event)
    ↓
订阅者接收事件通知
```

## 依赖关系

```
CheckpointService
    ├─→ ILogService (日志记录)
    ├─→ IStorageService (持久化)
    ├─→ ISCMService (Git操作)
    ├─→ IWorkspaceContextService (工作区信息)
    └─→ GitHelper
            └─→ ISCMRepository
                    └─→ ISCMProvider
```

## 存储策略

### 1. 检查点历史

存储在 Workspace Storage：

```typescript
storageService.store(
    'checkpoint.history',
    JSON.stringify(checkpoints),
    StorageScope.WORKSPACE,
    StorageTarget.MACHINE
);
```

**数据结构**：
```json
[
    {
        "hash": "abc123...",
        "message": "Feature X implemented",
        "timestamp": 1699000000000,
        "author": "User Name"
    }
]
```

### 2. Git数据

存储在工作区的 `.git` 目录（由Git管理）

## 错误处理

### 分层错误处理

```
1. GitHelper层
   ├─ 捕获Git操作错误
   └─ 转换为统一的错误格式

2. CheckpointService层
   ├─ 捕获业务逻辑错误
   ├─ 记录日志
   ├─ 发出error事件
   └─ 向上抛出

3. 用户代码层
   └─ try-catch处理
```

### 错误类型

1. **初始化错误**
   - 工作区路径无效
   - Git仓库不存在
   - 权限问题

2. **Git操作错误**
   - 提交失败
   - 重置失败
   - 冲突

3. **存储错误**
   - 写入失败
   - 读取失败
   - 序列化错误

## 性能优化

### 1. 延迟加载

```typescript
registerSingleton(
    ICheckpointService,
    CheckpointService,
    InstantiationType.Delayed  // 延迟实例化
);
```

### 2. 异步操作

所有Git操作都是异步的，不阻塞UI线程。

### 3. 增量保存

只提交实际变更的文件，而不是整个工作区。

### 4. 事件驱动

使用事件系统而不是轮询来获取状态更新。

## 扩展点

### 1. 自定义Git操作

```typescript
class ExtendedGitHelper extends GitHelper {
    async customOperation() {
        // 添加自定义Git操作
    }
}
```

### 2. 自定义排除模式

```typescript
const customPatterns = [
    ...getExcludePatterns(),
    'my-custom-pattern/*'
];
```

### 3. 事件订阅

```typescript
checkpointService.onDidChangeCheckpoint(event => {
    // 自定义事件处理
});
```

## 安全考虑

### 1. 路径验证

```typescript
private validateWorkspace(workspaceUri: URI): void {
    const protectedPaths = [
        process.env.HOME,
        process.env.USERPROFILE,
    ];

    if (protectedPaths.some(p => p && path === p)) {
        throw new Error('Cannot use checkpoints in protected directory');
    }
}
```

### 2. 文件排除

自动排除敏感文件：
- `.env*` - 环境变量
- `*.local` - 本地配置
- 配置文件

### 3. 权限检查

在初始化时验证对工作区的读写权限。

## 未来增强

### 1. 完整Git集成

当前GitHelper的许多方法是占位符，需要：
- 集成Git扩展API
- 或使用simple-git库
- 或直接调用Git命令

### 2. 分支管理

支持多分支检查点：
- 为每个任务创建独立分支
- 支持分支切换
- 合并检查点

### 3. 远程同步

支持推送到远程仓库：
- 备份检查点到云端
- 团队协作
- 跨设备同步

### 4. 压缩和清理

自动管理检查点数量：
- 压缩旧检查点
- 删除过期检查点
- 限制总大小

### 5. UI集成

- 检查点时间线视图
- 可视化差异对比
- 一键恢复按钮

## 测试策略

### 1. 单元测试

```typescript
suite('CheckpointService', () => {
    test('initialize', async () => {
        const service = new CheckpointService(...);
        const result = await service.initialize({...});
        assert.ok(result);
    });

    test('saveCheckpoint', async () => {
        // ...
    });
});
```

### 2. 集成测试

测试与SCM服务的集成。

### 3. E2E测试

完整的工作流测试。

## 参考资料

- [VS Code服务架构](https://github.com/microsoft/vscode/wiki/Services)
- [SCM API](https://code.visualstudio.com/api/extension-guides/scm-provider)
- [Kilocode Checkpoint实现](https://github.com/RooVetGit/Roo-Code/tree/main/src/services/checkpoints)
