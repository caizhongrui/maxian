# Checkpoint Service

代码快照系统服务，提供基于Git的代码版本管理功能。

## 功能特性

1. **自动创建检查点** - 保存当前代码状态为快照
2. **列出所有检查点** - 查看历史快照记录
3. **回滚到指定版本** - 恢复到任意历史快照
4. **显示差异** - 对比不同版本之间的变化

## 架构设计

### 目录结构

```
checkpoints/
├── common/
│   ├── checkpoints.ts          # 服务接口定义
│   ├── gitHelper.ts            # Git操作封装
│   ├── excludePatterns.ts      # 排除模式配置
│   └── index.ts                # 导出索引
├── browser/
│   ├── checkpointService.ts    # 浏览器端实现
│   └── index.ts                # 导出索引
└── README.md                   # 文档
```

### 核心接口

#### ICheckpointService

主服务接口，提供以下方法：

- `initialize(options)` - 初始化服务
- `saveCheckpoint(message, options?)` - 保存检查点
- `getCheckpoints()` - 获取所有检查点
- `restoreCheckpoint(commitHash)` - 恢复检查点
- `getDiff(options)` - 获取差异
- `clear()` - 清除所有检查点

#### 事件系统

服务会发出以下事件：

- `onDidChangeCheckpoint` - 检查点状态变化事件

事件类型：
- `initialize` - 初始化完成
- `checkpoint` - 创建检查点
- `restore` - 恢复检查点
- `error` - 发生错误

## 使用示例

### 基本使用

```typescript
import { ICheckpointService } from 'vs/workbench/services/checkpoints/common/checkpoints';

class MyService {
    constructor(
        @ICheckpointService private readonly checkpointService: ICheckpointService
    ) {}

    async initializeCheckpoints() {
        // 初始化检查点服务
        const result = await this.checkpointService.initialize({
            workspaceUri: this.workspaceUri,
            storageUri: this.storageUri,
            taskId: 'my-task-id'
        });

        console.log('Checkpoint service initialized:', result.created);
    }

    async saveCurrentState() {
        // 保存当前状态为检查点
        const result = await this.checkpointService.saveCheckpoint(
            'Implemented new feature',
            { allowEmpty: false }
        );

        if (result) {
            console.log('Checkpoint created:', result.commit);
        }
    }

    async listCheckpoints() {
        // 获取所有检查点
        const checkpoints = this.checkpointService.getCheckpoints();

        checkpoints.forEach(cp => {
            console.log(`${cp.hash}: ${cp.message} (${new Date(cp.timestamp)})`);
        });
    }

    async restoreToCheckpoint(hash: string) {
        // 恢复到指定检查点
        await this.checkpointService.restoreCheckpoint(hash);
        console.log('Restored to checkpoint:', hash);
    }

    async showDiff(from: string, to?: string) {
        // 显示差异
        const diffs = await this.checkpointService.getDiff({ from, to });

        diffs.forEach(diff => {
            console.log(`File: ${diff.paths.relative}`);
            console.log('Before:', diff.content.before);
            console.log('After:', diff.content.after);
        });
    }
}
```

### 监听事件

```typescript
import { ICheckpointService, ICheckpointEvent } from 'vs/workbench/services/checkpoints/common/checkpoints';

class CheckpointMonitor {
    constructor(
        @ICheckpointService private readonly checkpointService: ICheckpointService
    ) {
        // 监听检查点变化事件
        this.checkpointService.onDidChangeCheckpoint(this.onCheckpointChange.bind(this));
    }

    private onCheckpointChange(event: ICheckpointEvent): void {
        switch (event.type) {
            case 'initialize':
                console.log('Service initialized for:', event.workspaceUri?.toString());
                break;
            case 'checkpoint':
                console.log('New checkpoint created:', event.commitHash);
                break;
            case 'restore':
                console.log('Restored to:', event.commitHash);
                break;
            case 'error':
                console.error('Error occurred:', event.error);
                break;
        }
    }
}
```

### 高级用法

```typescript
// 自动保存检查点
class AutoCheckpointService {
    private timer: NodeJS.Timeout | undefined;

    constructor(
        @ICheckpointService private readonly checkpointService: ICheckpointService
    ) {}

    startAutoSave(intervalMs: number = 300000) { // 默认5分钟
        this.timer = setInterval(async () => {
            try {
                await this.checkpointService.saveCheckpoint(
                    `Auto checkpoint at ${new Date().toISOString()}`,
                    { allowEmpty: false, suppressMessage: true }
                );
            } catch (error) {
                console.error('Auto save failed:', error);
            }
        }, intervalMs);
    }

    stopAutoSave() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
}
```

## 与Git扩展集成

CheckpointService通过VS Code的SCM服务与Git扩展集成：

1. 使用`ISCMService`获取Git仓库
2. 通过`ISCMRepository`访问Git provider
3. 利用Git extension API执行Git命令

### 注意事项

1. **Git依赖** - 服务需要工作区已初始化Git仓库
2. **权限检查** - 会验证工作区路径，防止在受保护目录使用
3. **文件排除** - 自动排除build产物、媒体文件、缓存等
4. **存储管理** - 检查点历史保存在workspace storage中

## 排除模式

服务会自动排除以下文件/目录：

- **构建产物**: node_modules, dist, build等
- **媒体文件**: 图片、视频、音频文件
- **缓存文件**: *.cache, *.log, *.tmp等
- **配置文件**: .env*, *.local等
- **大文件**: 压缩包、二进制文件等
- **数据库文件**: *.db, *.sqlite等

详见 `excludePatterns.ts`

## 扩展开发

### 自定义Git Helper

如果需要扩展Git操作：

```typescript
import { GitHelper } from 'vs/workbench/services/checkpoints/common/gitHelper';

class ExtendedGitHelper extends GitHelper {
    async customOperation() {
        // 实现自定义Git操作
    }
}
```

### 自定义排除模式

```typescript
import { getExcludePatterns } from 'vs/workbench/services/checkpoints/common/excludePatterns';

const customPatterns = [
    ...getExcludePatterns(),
    'my-custom-pattern/*',
    '*.custom'
];
```

## 错误处理

服务提供完整的错误处理：

```typescript
try {
    await checkpointService.saveCheckpoint('message');
} catch (error) {
    if (error.message.includes('not initialized')) {
        // 服务未初始化
        await checkpointService.initialize(options);
    } else if (error.message.includes('Git repository')) {
        // Git仓库问题
        console.error('Please initialize Git repository first');
    } else {
        // 其他错误
        console.error('Unexpected error:', error);
    }
}
```

## 性能考虑

1. **延迟加载** - 服务使用`InstantiationType.Delayed`注册
2. **增量保存** - 只保存变更的文件
3. **异步操作** - 所有Git操作都是异步的
4. **事件驱动** - 使用事件系统避免轮询

## 待实现功能

以下功能标记为待实现（需要完整的Git扩展集成）：

1. Git命令执行 (`GitHelper.executeCommand`)
2. 提交操作 (`GitHelper.commit`)
3. 重置操作 (`GitHelper.reset`)
4. 清理操作 (`GitHelper.clean`)
5. 显示文件内容 (`GitHelper.show`)

这些功能的实现需要：
- Git扩展的完整API访问
- 或者直接调用系统Git命令
- 或者使用simple-git等库

## 参考资料

- [VS Code SCM API](https://code.visualstudio.com/api/extension-guides/scm-provider)
- [Git Extension](https://github.com/microsoft/vscode/tree/main/extensions/git)
- Kilocode源代码: `src/services/checkpoints/`

## License

MIT License - 基于VS Code源代码
