# Ripgrep Service 使用示例

## 完整使用示例

### 示例 1: 在扩展中使用文件列表功能

```typescript
import { Disposable } from 'vs/base/common/lifecycle';
import { IRipgrepService } from 'vs/workbench/services/ripgrep/common/ripgrep';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { CancellationTokenSource } from 'vs/base/common/cancellation';

export class FileExplorer extends Disposable {
    constructor(
        @IRipgrepService private readonly ripgrepService: IRipgrepService,
        @IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService
    ) {
        super();
    }

    async listWorkspaceFiles(): Promise<void> {
        const workspace = this.workspaceService.getWorkspace();
        if (!workspace.folders.length) {
            return;
        }

        const workspacePath = workspace.folders[0].uri.fsPath;

        // 列出工作区中的所有文件（递归，限制200个）
        const result = await this.ripgrepService.listFiles({
            dirPath: workspacePath,
            recursive: true,
            limit: 200
        });

        console.log(`Found ${result.files.length} files`);
        if (result.limitReached) {
            console.log('File limit reached, some files were omitted');
        }

        // 处理文件列表
        result.files.forEach(file => {
            console.log(file);
        });
    }
}
```

### 示例 2: 搜索代码中的TODO标记

```typescript
import { Disposable } from 'vs/base/common/lifecycle';
import { IRipgrepService } from 'vs/workbench/services/ripgrep/common/ripgrep';
import { INotificationService } from 'vs/platform/notification/common/notification';

export class TodoFinder extends Disposable {
    constructor(
        @IRipgrepService private readonly ripgrepService: IRipgrepService,
        @INotificationService private readonly notificationService: INotificationService
    ) {
        super();
    }

    async findTodos(workspacePath: string): Promise<string> {
        try {
            const result = await this.ripgrepService.regexSearch({
                cwd: workspacePath,
                directoryPath: workspacePath,
                regex: '(TODO|FIXME|HACK|XXX):',
                filePattern: '*.{ts,js,tsx,jsx}'
            });

            this.notificationService.info(`Found TODOs in workspace`);
            return result;
        } catch (error) {
            this.notificationService.error(`Failed to search for TODOs: ${error.message}`);
            return '';
        }
    }
}
```

### 示例 3: 使用取消令牌的大型目录扫描

```typescript
import { Disposable } from 'vs/base/common/lifecycle';
import { IRipgrepService } from 'vs/workbench/services/ripgrep/common/ripgrep';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';

export class LargeDirectoryScanner extends Disposable {
    private currentScan: CancellationTokenSource | undefined;

    constructor(
        @IRipgrepService private readonly ripgrepService: IRipgrepService,
        @IProgressService private readonly progressService: IProgressService
    ) {
        super();
    }

    async scanDirectory(dirPath: string): Promise<string[]> {
        // 取消之前的扫描
        this.cancelCurrentScan();

        // 创建新的取消令牌
        this.currentScan = new CancellationTokenSource();

        return this.progressService.withProgress(
            {
                location: ProgressLocation.Notification,
                title: 'Scanning directory...',
                cancellable: true
            },
            async (progress, token) => {
                // 链接用户取消和我们的取消令牌
                token.onCancellationRequested(() => {
                    this.currentScan?.cancel();
                });

                try {
                    const result = await this.ripgrepService.listFiles({
                        dirPath,
                        recursive: true,
                        limit: 1000,
                        token: this.currentScan!.token
                    });

                    progress.report({
                        message: `Found ${result.files.length} files`
                    });

                    return result.files;
                } catch (error) {
                    if (error.message === 'Operation cancelled') {
                        progress.report({ message: 'Scan cancelled' });
                        return [];
                    }
                    throw error;
                } finally {
                    this.currentScan = undefined;
                }
            }
        );
    }

    cancelCurrentScan(): void {
        if (this.currentScan) {
            this.currentScan.cancel();
            this.currentScan = undefined;
        }
    }

    override dispose(): void {
        this.cancelCurrentScan();
        super.dispose();
    }
}
```

### 示例 4: 批量搜索多个模式

```typescript
import { Disposable } from 'vs/base/common/lifecycle';
import { IRipgrepService } from 'vs/workbench/services/ripgrep/common/ripgrep';

export class PatternSearcher extends Disposable {
    constructor(
        @IRipgrepService private readonly ripgrepService: IRipgrepService
    ) {
        super();
    }

    async searchPatterns(
        workspacePath: string,
        patterns: string[]
    ): Promise<Map<string, string>> {
        const results = new Map<string, string>();

        for (const pattern of patterns) {
            try {
                const searchResult = await this.ripgrepService.regexSearch({
                    cwd: workspacePath,
                    directoryPath: workspacePath,
                    regex: pattern,
                    filePattern: '*.ts'
                });

                results.set(pattern, searchResult);
            } catch (error) {
                console.error(`Failed to search pattern "${pattern}":`, error);
                results.set(pattern, 'Search failed');
            }
        }

        return results;
    }

    async searchWithAlternatives(
        workspacePath: string,
        patterns: string[]
    ): Promise<string> {
        // 将多个模式组合成一个正则表达式
        const combinedPattern = `(${patterns.join('|')})`;

        return this.ripgrepService.regexSearch({
            cwd: workspacePath,
            directoryPath: workspacePath,
            regex: combinedPattern,
            filePattern: '*.ts'
        });
    }
}
```

### 示例 5: 文件过滤和统计

```typescript
import { Disposable } from 'vs/base/common/lifecycle';
import { IRipgrepService } from 'vs/workbench/services/ripgrep/common/ripgrep';
import * as path from 'path';

interface FileStats {
    total: number;
    byExtension: Map<string, number>;
    directories: Set<string>;
}

export class FileAnalyzer extends Disposable {
    constructor(
        @IRipgrepService private readonly ripgrepService: IRipgrepService
    ) {
        super();
    }

    async analyzeDirectory(dirPath: string): Promise<FileStats> {
        const result = await this.ripgrepService.listFiles({
            dirPath,
            recursive: true,
            limit: 1000
        });

        const stats: FileStats = {
            total: 0,
            byExtension: new Map(),
            directories: new Set()
        };

        for (const file of result.files) {
            if (file.endsWith('/')) {
                // 这是一个目录
                stats.directories.add(file);
            } else {
                // 这是一个文件
                stats.total++;

                const ext = path.extname(file).toLowerCase();
                const count = stats.byExtension.get(ext) || 0;
                stats.byExtension.set(ext, count + 1);
            }
        }

        return stats;
    }

    async findFilesByExtension(
        dirPath: string,
        extension: string
    ): Promise<string[]> {
        const result = await this.ripgrepService.listFiles({
            dirPath,
            recursive: true,
            limit: 500
        });

        return result.files.filter(file =>
            file.toLowerCase().endsWith(extension.toLowerCase())
        );
    }
}
```

### 示例 6: 智能代码搜索

```typescript
import { Disposable } from 'vs/base/common/lifecycle';
import { IRipgrepService } from 'vs/workbench/services/ripgrep/common/ripgrep';

export class CodeSearcher extends Disposable {
    constructor(
        @IRipgrepService private readonly ripgrepService: IRipgrepService
    ) {
        super();
    }

    // 搜索函数定义
    async findFunctionDefinitions(
        workspacePath: string,
        functionName: string
    ): Promise<string> {
        return this.ripgrepService.regexSearch({
            cwd: workspacePath,
            directoryPath: workspacePath,
            regex: `function\\s+${functionName}\\s*\\(`,
            filePattern: '*.{ts,js}'
        });
    }

    // 搜索类定义
    async findClassDefinitions(
        workspacePath: string,
        className: string
    ): Promise<string> {
        return this.ripgrepService.regexSearch({
            cwd: workspacePath,
            directoryPath: workspacePath,
            regex: `class\\s+${className}\\s*[{<]`,
            filePattern: '*.{ts,js,tsx,jsx}'
        });
    }

    // 搜索导入语句
    async findImports(
        workspacePath: string,
        moduleName: string
    ): Promise<string> {
        return this.ripgrepService.regexSearch({
            cwd: workspacePath,
            directoryPath: workspacePath,
            regex: `import.*from\\s+['"].*${moduleName}.*['"]`,
            filePattern: '*.{ts,js,tsx,jsx}'
        });
    }

    // 搜索变量使用
    async findVariableUsage(
        workspacePath: string,
        variableName: string
    ): Promise<string> {
        return this.ripgrepService.regexSearch({
            cwd: workspacePath,
            directoryPath: workspacePath,
            regex: `\\b${variableName}\\b`,
            filePattern: '*.{ts,js,tsx,jsx}'
        });
    }
}
```

### 示例 7: 与Command一起使用

```typescript
import { Disposable } from 'vs/base/common/lifecycle';
import { IRipgrepService } from 'vs/workbench/services/ripgrep/common/ripgrep';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';

export class RipgrepCommands extends Disposable {
    constructor(
        @IRipgrepService private readonly ripgrepService: IRipgrepService,
        @ICommandService private readonly commandService: ICommandService
    ) {
        super();
        this.registerCommands();
    }

    private registerCommands(): void {
        // 注册列出文件命令
        CommandsRegistry.registerCommand({
            id: 'ripgrep.listFiles',
            handler: async (accessor, dirPath: string) => {
                const result = await this.ripgrepService.listFiles({
                    dirPath,
                    recursive: true,
                    limit: 200
                });
                return result.files;
            }
        });

        // 注册搜索命令
        CommandsRegistry.registerCommand({
            id: 'ripgrep.search',
            handler: async (accessor, options: {
                cwd: string;
                directory: string;
                pattern: string;
                filePattern?: string;
            }) => {
                return this.ripgrepService.regexSearch({
                    cwd: options.cwd,
                    directoryPath: options.directory,
                    regex: options.pattern,
                    filePattern: options.filePattern
                });
            }
        });
    }
}
```

## 最佳实践

1. **始终设置合理的限制**: 避免一次性列出过多文件
2. **使用取消令牌**: 对于长时间运行的操作，提供取消机制
3. **错误处理**: 始终捕获和处理可能的错误
4. **进度反馈**: 对于用户发起的操作，显示进度
5. **资源清理**: 在dispose中取消所有进行中的操作
6. **路径验证**: 在调用服务前验证路径是否存在
7. **性能考虑**: 对大型目录树使用较小的限制值

## 性能提示

- 非递归列表比递归列表快得多
- 使用文件模式过滤可以显著提高搜索速度
- 较小的限制值会更快返回结果
- 考虑在后台线程中执行大型操作
