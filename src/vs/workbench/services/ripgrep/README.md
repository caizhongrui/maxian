# Ripgrep Service

VS Code集成的高性能Ripgrep服务，提供文件列表和正则搜索功能。

## 功能特性

- 使用VS Code内置的ripgrep二进制文件
- 高性能文件列表功能（支持递归和非递归）
- 正则表达式搜索
- 支持gitignore规则
- 文件数量限制（默认200个）
- 支持取消操作

## 架构

```
ripgrep/
├── common/
│   └── ripgrep.ts          # 接口定义
├── browser/
│   └── ripgrepService.ts   # Browser层存根实现
└── node/
    └── ripgrepService.ts   # Node层实际实现
```

## 使用示例

### 1. 列出文件

```typescript
import { IRipgrepService } from 'vs/workbench/services/ripgrep/common/ripgrep';

// 通过依赖注入获取服务
constructor(
    @IRipgrepService private readonly ripgrepService: IRipgrepService
) {}

// 非递归列出文件
const result = await this.ripgrepService.listFiles({
    dirPath: '/path/to/directory',
    recursive: false,
    limit: 200
});

console.log('Files:', result.files);
console.log('Limit reached:', result.limitReached);

// 递归列出文件
const recursiveResult = await this.ripgrepService.listFiles({
    dirPath: '/path/to/directory',
    recursive: true,
    limit: 200
});
```

### 2. 正则搜索

```typescript
// 搜索包含TODO的文件
const searchResult = await this.ripgrepService.regexSearch({
    cwd: '/workspace',
    directoryPath: '/workspace/src',
    regex: 'TODO:',
    filePattern: '*.ts'
});

console.log(searchResult);
```

### 3. 使用取消令牌

```typescript
import { CancellationTokenSource } from 'vs/base/common/cancellation';

const cts = new CancellationTokenSource();

// 启动操作
const promise = this.ripgrepService.listFiles({
    dirPath: '/large/directory',
    recursive: true,
    limit: 1000,
    token: cts.token
});

// 如果需要，可以取消操作
setTimeout(() => cts.cancel(), 5000);

try {
    const result = await promise;
} catch (error) {
    if (error.message === 'Operation cancelled') {
        console.log('Operation was cancelled');
    }
}
```

## API文档

### IRipgrepService

#### listFiles(options: IListFilesOptions): Promise<IListFilesResult>

列出目录中的文件。

**参数:**
- `options.dirPath`: 要列出文件的目录路径
- `options.recursive`: 是否递归列出子目录中的文件
- `options.limit`: 最大文件数量限制
- `options.token`: 可选的取消令牌

**返回:**
- `files`: 文件路径数组
- `limitReached`: 是否达到限制

#### regexSearch(options: IRegexSearchOptions): Promise<string>

执行正则表达式搜索。

**参数:**
- `options.cwd`: 当前工作目录（用于计算相对路径）
- `options.directoryPath`: 要搜索的目录
- `options.regex`: 正则表达式（Rust正则语法）
- `options.filePattern`: 可选的文件模式过滤器（glob格式）
- `options.token`: 可选的取消令牌

**返回:**
格式化的搜索结果字符串

#### getRipgrepPath(): Promise<string>

获取ripgrep二进制文件的路径。

**返回:**
ripgrep二进制文件的完整路径

## 配置

### 忽略目录

服务会自动忽略以下目录：
- `node_modules`
- `.git`
- `__pycache__`
- `venv`
- `env`
- `.venv`
- `dist`
- `build`
- `out`
- 所有隐藏目录（以`.`开头）

### 限制

- 默认文件限制：200个
- 默认搜索结果限制：300个
- 默认行长度限制：500字符
- 操作超时：10秒

## 特殊目录处理

服务会特别处理以下目录：
- **根目录**：不允许完整列出，只返回根路径
- **用户主目录**：不允许完整列出，只返回主目录路径

## Gitignore支持

服务默认尊重.gitignore规则：
- 递归模式下自动应用.gitignore
- 可以通过ripgrep参数覆盖此行为

## 性能考虑

1. **文件限制**: 始终设置合理的文件限制以避免过载
2. **超时**: 长时间运行的操作会在10秒后超时
3. **取消**: 使用取消令牌来中止长时间运行的操作
4. **递归深度**: 递归搜索大目录树时要小心

## 错误处理

服务会记录错误并返回部分结果，而不是失败：
- 目录不存在：返回空结果并记录警告
- 进程超时：返回部分结果
- 进程错误：返回空结果或"No results found"

## 注意事项

1. 此服务仅在Node环境中可用
2. 在browser上下文中使用会抛出错误
3. 服务使用VS Code内置的ripgrep二进制文件
4. 所有路径都应该是绝对路径
