# Checkpoint Service 快速开始

## 1. 导入服务

```typescript
import { ICheckpointService } from 'vs/workbench/services/checkpoints/common/checkpoints';
```

## 2. 依赖注入

在你的类中注入CheckpointService：

```typescript
class MyFeature {
    constructor(
        @ICheckpointService private readonly checkpointService: ICheckpointService
    ) {}
}
```

## 3. 初始化

在使用前必须先初始化服务：

```typescript
await this.checkpointService.initialize({
    workspaceUri: URI.file('/path/to/workspace'),
    storageUri: URI.file('/path/to/storage'),
    taskId: 'optional-task-id'
});
```

## 4. 基本操作

### 保存检查点

```typescript
// 保存当前状态
const result = await this.checkpointService.saveCheckpoint('My checkpoint message');
console.log('Created:', result?.commit);
```

### 列出检查点

```typescript
// 获取所有检查点
const checkpoints = this.checkpointService.getCheckpoints();
checkpoints.forEach(cp => {
    console.log(`${cp.hash}: ${cp.message}`);
});
```

### 恢复检查点

```typescript
// 回退到指定检查点
await this.checkpointService.restoreCheckpoint('commit-hash');
```

### 查看差异

```typescript
// 比较两个版本
const diffs = await this.checkpointService.getDiff({
    from: 'hash1',
    to: 'hash2'  // 可选，默认为HEAD
});

diffs.forEach(diff => {
    console.log(`Changed: ${diff.paths.relative}`);
});
```

## 5. 监听事件

```typescript
// 监听检查点变化
this.checkpointService.onDidChangeCheckpoint(event => {
    console.log('Event:', event.type);
    if (event.type === 'checkpoint') {
        console.log('New checkpoint:', event.commitHash);
    }
});
```

## 6. 完整示例

```typescript
import { ICheckpointService } from 'vs/workbench/services/checkpoints/common/checkpoints';
import { URI } from 'vs/base/common/uri';

class CodeSnapshotFeature {
    constructor(
        @ICheckpointService private readonly checkpointService: ICheckpointService
    ) {
        this.init();
    }

    private async init() {
        // 1. 初始化
        await this.checkpointService.initialize({
            workspaceUri: URI.file('/my/workspace'),
            storageUri: URI.file('/my/storage')
        });

        // 2. 创建初始检查点
        await this.checkpointService.saveCheckpoint('Initial state');

        // 3. 做一些改动...
        // ... 编辑代码 ...

        // 4. 保存新检查点
        const result = await this.checkpointService.saveCheckpoint('Added new feature');

        // 5. 列出所有检查点
        const checkpoints = this.checkpointService.getCheckpoints();
        console.log(`Total checkpoints: ${checkpoints.length}`);

        // 6. 如需回退
        // await this.checkpointService.restoreCheckpoint(checkpoints[0].hash);
    }
}
```

## 7. 常见模式

### 自动保存模式

```typescript
// 每5分钟自动保存
setInterval(async () => {
    await this.checkpointService.saveCheckpoint(
        `Auto-save ${new Date().toISOString()}`,
        { allowEmpty: false, suppressMessage: true }
    );
}, 5 * 60 * 1000);
```

### 关键步骤保存

```typescript
async function performTask() {
    // 步骤1
    await doStep1();
    await checkpointService.saveCheckpoint('Completed step 1');

    // 步骤2
    await doStep2();
    await checkpointService.saveCheckpoint('Completed step 2');

    // 步骤3
    await doStep3();
    await checkpointService.saveCheckpoint('Completed step 3');
}
```

### 带错误恢复

```typescript
const checkpointHash = (await checkpointService.saveCheckpoint('Before risky operation'))?.commit;

try {
    await riskyOperation();
} catch (error) {
    console.error('Operation failed, restoring checkpoint');
    if (checkpointHash) {
        await checkpointService.restoreCheckpoint(checkpointHash);
    }
    throw error;
}
```

## 8. 注意事项

1. **初始化** - 必须先调用`initialize()`才能使用其他功能
2. **Git依赖** - 工作区需要已初始化Git仓库
3. **异步操作** - 所有操作都是异步的，使用`await`
4. **错误处理** - 使用try-catch处理可能的错误
5. **事件监听** - 使用事件系统获取状态变化通知

## 9. 故障排除

### 服务未初始化错误

```typescript
try {
    await checkpointService.saveCheckpoint('test');
} catch (error) {
    if (error.message.includes('not initialized')) {
        await checkpointService.initialize({...});
    }
}
```

### Git仓库不存在

```typescript
// 确保工作区已初始化Git
// 检查 .git 目录是否存在
```

### 无变更可提交

```typescript
// saveCheckpoint 返回 undefined 表示没有变更
const result = await checkpointService.saveCheckpoint('test');
if (!result) {
    console.log('No changes to save');
}
```

## 10. 更多示例

查看 `example.ts` 文件获取更多使用示例：

- `BasicCheckpointManager` - 基础使用
- `EventDrivenCheckpointManager` - 事件驱动
- `AutoCheckpointService` - 自动保存
- `CheckpointComparator` - 版本比较
- `TaskCheckpointManager` - 任务管理

## 相关文档

- [README.md](./README.md) - 完整文档
- [example.ts](./example.ts) - 详细示例代码
