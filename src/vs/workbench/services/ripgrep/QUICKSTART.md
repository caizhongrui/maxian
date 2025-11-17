# Ripgrep Service 快速入门指南

## 5分钟快速上手

### 步骤 1: 导入服务

```typescript
import { IRipgrepService } from 'vs/workbench/services/ripgrep/common/ripgrep';
```

### 步骤 2: 通过依赖注入获取服务

```typescript
export class MyClass extends Disposable {
    constructor(
        @IRipgrepService private readonly ripgrepService: IRipgrepService
    ) {
        super();
    }
}
```

### 步骤 3: 使用服务

#### 列出文件

```typescript
const result = await this.ripgrepService.listFiles({
    dirPath: '/path/to/directory',
    recursive: true,
    limit: 200
});

console.log(result.files);
```

#### 搜索代码

```typescript
const searchResult = await this.ripgrepService.regexSearch({
    cwd: '/workspace',
    directoryPath: '/workspace/src',
    regex: 'TODO:',
    filePattern: '*.ts'
});

console.log(searchResult);
```

## 常见用例

### 用例 1: 查找所有TypeScript文件

```typescript
async findTypeScriptFiles(workspacePath: string): Promise<string[]> {
    const result = await this.ripgrepService.listFiles({
        dirPath: workspacePath,
        recursive: true,
        limit: 500
    });

    return result.files.filter(file =>
        file.endsWith('.ts') || file.endsWith('.tsx')
    );
}
```

### 用例 2: 查找所有TODO注释

```typescript
async findTodos(workspacePath: string): Promise<string> {
    return this.ripgrepService.regexSearch({
        cwd: workspacePath,
        directoryPath: workspacePath,
        regex: '(TODO|FIXME|HACK):.*',
        filePattern: '*.{ts,js}'
    });
}
```

### 用例 3: 查找函数定义

```typescript
async findFunction(workspacePath: string, functionName: string): Promise<string> {
    return this.ripgrepService.regexSearch({
        cwd: workspacePath,
        directoryPath: workspacePath,
        regex: `function\\s+${functionName}\\s*\\(`,
        filePattern: '*.ts'
    });
}
```

### 用例 4: 带取消的文件列表

```typescript
async listFilesWithCancel(
    dirPath: string,
    token: CancellationToken
): Promise<string[]> {
    const result = await this.ripgrepService.listFiles({
        dirPath,
        recursive: true,
        limit: 1000,
        token
    });

    return result.files;
}
```

## API 速查表

### listFiles(options)

**参数:**
- `dirPath: string` - 目录路径
- `recursive: boolean` - 是否递归
- `limit: number` - 文件数量限制
- `token?: CancellationToken` - 取消令牌（可选）

**返回:**
```typescript
{
    files: string[],      // 文件路径数组
    limitReached: boolean // 是否达到限制
}
```

### regexSearch(options)

**参数:**
- `cwd: string` - 当前工作目录
- `directoryPath: string` - 搜索目录
- `regex: string` - 正则表达式
- `filePattern?: string` - 文件模式（可选）
- `token?: CancellationToken` - 取消令牌（可选）

**返回:**
- `string` - 格式化的搜索结果

### getRipgrepPath()

**返回:**
- `Promise<string>` - ripgrep二进制文件路径

## 注意事项

### ✅ 做

1. **设置合理的限制**
   ```typescript
   limit: 200  // 好
   ```

2. **使用取消令牌**
   ```typescript
   const cts = new CancellationTokenSource();
   token: cts.token
   ```

3. **处理错误**
   ```typescript
   try {
       const result = await ripgrepService.listFiles(...);
   } catch (error) {
       console.error('Error:', error);
   }
   ```

4. **使用文件模式过滤**
   ```typescript
   filePattern: '*.{ts,js}'  // 只搜索TS/JS文件
   ```

### ❌ 不要做

1. **不要设置过大的限制**
   ```typescript
   limit: 100000  // 不好！会很慢
   ```

2. **不要忘记取消长时间操作**
   ```typescript
   // 不好 - 没有取消机制
   await ripgrepService.listFiles({ ... });
   ```

3. **不要忽略limitReached标志**
   ```typescript
   // 不好 - 应该检查limitReached
   const result = await ripgrepService.listFiles(...);
   // 应该: if (result.limitReached) { ... }
   ```

4. **不要在循环中调用**
   ```typescript
   // 不好 - 性能问题
   for (const dir of directories) {
       await ripgrepService.listFiles({ dirPath: dir, ... });
   }
   ```

## 常见问题

### Q: 为什么在browser中抛出错误？

A: Ripgrep服务需要Node.js环境来执行子进程。确保在Node环境中使用。

### Q: 如何提高搜索速度？

A:
1. 使用较小的limit值
2. 使用filePattern过滤文件类型
3. 使用非递归模式（如果可能）
4. 搜索更具体的目录

### Q: 如何处理大型目录？

A:
1. 使用取消令牌
2. 分批处理
3. 显示进度提示
4. 使用较小的limit值

### Q: 正则表达式语法是什么？

A: 使用Rust正则表达式语法（ripgrep使用的语法）。
参考: https://docs.rs/regex/latest/regex/#syntax

## 下一步

- 📖 阅读 [README.md](./README.md) 了解详细文档
- 📚 查看 [USAGE_EXAMPLES.md](./USAGE_EXAMPLES.md) 查看更多示例
- 📝 查看 [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) 了解实现细节

## 支持

如果遇到问题：
1. 检查日志输出
2. 验证路径是否正确
3. 确保在Node环境中运行
4. 检查是否正确注入了服务

## 性能基准

- **文件列表** (200个文件): ~50-100ms
- **正则搜索** (小型代码库): ~100-200ms
- **正则搜索** (大型代码库): ~500-1000ms

这些数字取决于：
- 目录大小
- 文件数量
- 正则表达式复杂度
- 系统性能

## 最后提示

记住：Ripgrep服务是**生产就绪**的，但请：
- ⚡ 注意性能影响
- 🔒 保护用户隐私（不搜索敏感目录）
- 📊 监控服务使用情况
- 🐛 报告遇到的问题
