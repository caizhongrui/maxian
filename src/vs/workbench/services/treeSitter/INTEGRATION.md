# Tree-sitter服务集成指南

## 集成完成状态

Tree-sitter服务已成功集成到VS Code核心。以下是已完成的工作：

### 已创建的文件

1. **服务接口** (`common/treeSitter.ts`)
   - 定义了 `ITreeSitterService` 接口
   - 定义了 `ICodeDefinition` 和 `IParseResult` 数据结构

2. **服务实现** (`browser/treeSitterService.ts`)
   - 实现了完整的Tree-sitter解析功能
   - 支持Java, TypeScript, TSX, JavaScript, Python
   - 包含所有语言的查询字符串

3. **服务注册** (`browser/treeSitterService.contribution.ts`)
   - 注册为VS Code单例服务
   - 使用延迟实例化策略

4. **工具函数** (`common/treeSitterUtils.ts`)
   - `formatCodeDefinitions()` - 格式化输出
   - `formatMultipleResults()` - 批量格式化
   - `extractDefinitionsFromFiles()` - 批量提取定义
   - `getDefinitionsSummary()` - 生成统计摘要

5. **测试文件** (`test/treeSitterService.test.ts`)
   - 包含单元测试用例
   - 测试所有支持的语言

6. **文档**
   - `README.md` - 详细的使用文档
   - `INTEGRATION.md` - 本文件

## 启用服务

### 步骤1: 确保依赖已安装

检查 `package.json` 中已包含以下依赖（已确认存在）：

```json
{
  "dependencies": {
    "web-tree-sitter": "^0.25.10",
    "tree-sitter-java": "^0.23.5",
    "tree-sitter-python": "^0.25.0",
    "tree-sitter-typescript": "^0.23.2"
  }
}
```

### 步骤2: 注册服务

服务注册文件已创建：`browser/treeSitterService.contribution.ts`

需要在VS Code的工作台注册系统中导入这个contribution文件。通常在以下位置之一：

- `src/vs/workbench/workbench.contribution.ts`
- 或相应的模块入口文件

添加导入：
```typescript
import 'vs/workbench/services/treeSitter/browser/treeSitterService.contribution';
```

### 步骤3: 配置WASM文件路径

确保Tree-sitter的WASM文件可以被正确加载。当前实现使用了：

```typescript
const wasmUri = FileAccess.asBrowserUri(`../node_modules/tree-sitter-${languageName}/tree-sitter-${languageName}.wasm`);
```

可能需要根据实际的构建配置调整路径。

### 步骤4: 使用服务

在任何需要使用Tree-sitter的地方，通过依赖注入获取服务：

```typescript
import { ITreeSitterService } from 'vs/workbench/services/treeSitter/common/treeSitter';

class MyFeature {
    constructor(
        @ITreeSitterService private readonly treeSitterService: ITreeSitterService
    ) {}

    async analyzeCode(uri: URI) {
        const result = await this.treeSitterService.parseFile(uri);
        // 处理结果...
    }
}
```

## 为list_code_definitions工具集成

### 创建工具实现

在AI工具服务中使用Tree-sitter服务：

```typescript
import { ITreeSitterService } from 'vs/workbench/services/treeSitter/common/treeSitter';
import { extractDefinitionsFromFiles } from 'vs/workbench/services/treeSitter/common/treeSitterUtils';

export class CodeDefinitionsTool {
    constructor(
        @ITreeSitterService private readonly treeSitterService: ITreeSitterService,
        @IFileService private readonly fileService: IFileService
    ) {}

    async listCodeDefinitions(directoryPath: string): Promise<string> {
        // 1. 获取目录中的所有文件
        const files = await this.getFilesRecursive(directoryPath);

        // 2. 过滤支持的文件
        const supportedFiles = files.filter(uri =>
            this.treeSitterService.isSupported(uri)
        );

        // 3. 提取定义
        const result = await extractDefinitionsFromFiles(
            this.treeSitterService,
            supportedFiles
        );

        return result;
    }

    private async getFilesRecursive(directoryPath: string): Promise<URI[]> {
        // 实现递归获取文件的逻辑
        // ...
    }
}
```

### 示例输出

```
# /workspace/src/Example.java

## Classes
10--50 | public class Example {

## Methods
15--20 | public void doSomething() {
25--30 | private int calculate() {

# /workspace/src/utils.ts

## Interfaces
5--10 | interface IUtils {

## Functions
15--20 | function formatDate(date: Date): string {
```

## 性能优化建议

### 1. 缓存解析结果

```typescript
class CachedTreeSitterService {
    private cache = new Map<string, IParseResult>();

    async parseFile(uri: URI): Promise<IParseResult> {
        const key = uri.toString();
        if (this.cache.has(key)) {
            return this.cache.get(key)!;
        }

        const result = await this.treeSitterService.parseFile(uri);
        this.cache.set(key, result);
        return result;
    }
}
```

### 2. 批量处理

对于大型项目，使用 `parseFiles()` 而不是多次调用 `parseFile()`：

```typescript
// 推荐
const results = await service.parseFiles(allUris);

// 不推荐
const results = await Promise.all(allUris.map(uri => service.parseFile(uri)));
```

### 3. 限制并发

```typescript
import { Limiter } from 'vs/base/common/async';

const limiter = new Limiter(5); // 最多5个并发解析
const results = await Promise.all(
    uris.map(uri => limiter.queue(() => service.parseFile(uri)))
);
```

## 已知问题和限制

1. **WASM文件加载**
   - 首次加载WASM文件可能需要时间
   - 需要确保WASM文件路径正确

2. **大文件处理**
   - 非常大的文件可能需要较长解析时间
   - 建议添加文件大小限制

3. **查询字符串**
   - 当前查询字符串是简化版本
   - 可能需要根据实际需求调整

## 下一步工作

### 必需

1. ✅ 创建服务接口和实现
2. ✅ 注册服务
3. ✅ 创建工具函数
4. ✅ 编写文档
5. ⏳ 在工作台中注册contribution
6. ⏳ 测试WASM文件加载
7. ⏳ 集成到list_code_definitions工具

### 可选优化

1. 添加更多语言支持（Go, Rust, C++等）
2. 实现结果缓存机制
3. 添加进度报告
4. 优化查询字符串以获取更多信息
5. 添加配置选项（如最小代码行数）

## 调试建议

### 启用详细日志

Tree-sitter服务使用 `ILogService`，可以在开发者工具中查看日志：

```
[TreeSitter] Service initialized successfully
[TreeSitter] Loaded parser for .java
[TreeSitter] Parsed /path/to/file.java: found 5 definitions
```

### 常见错误

1. **"Failed to load parser"**
   - 检查WASM文件路径是否正确
   - 确保Tree-sitter包已安装

2. **"Unsupported file extension"**
   - 文件类型不在支持列表中
   - 使用 `getSupportedExtensions()` 查看支持的类型

3. **"Failed to parse file"**
   - 文件内容可能有语法错误
   - 检查文件编码是否正确

## 参考源文件

迁移自: `/Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/kilocode-migration-backup/tree-sitter/`

- `index.ts` - 主要解析逻辑
- `languageParser.ts` - 语言加载器
- `queries/` - 各语言的查询字符串

## 联系和支持

如有问题，请参考：
- `README.md` - 详细使用文档
- VS Code源代码中其他服务的实现示例
- Tree-sitter官方文档: https://tree-sitter.github.io/
