# Tree-sitter Service for VS Code

这个服务集成了Tree-sitter到VS Code核心，用于解析源代码并提取代码定义（类、函数、接口等）。

## 功能特性

- 支持多种编程语言：Java, TypeScript, TSX, JavaScript, Python
- 提取类、函数、方法、接口等代码定义
- 异步解析，不阻塞UI
- 可扩展的查询系统

## 架构

```
src/vs/workbench/services/treeSitter/
├── browser/
│   ├── treeSitterService.ts              # 服务实现
│   └── treeSitterService.contribution.ts # 服务注册
└── common/
    ├── treeSitter.ts                      # 服务接口定义
    └── treeSitterUtils.ts                 # 工具函数
```

## 使用方法

### 1. 依赖注入

在需要使用Tree-sitter服务的类中注入服务：

```typescript
import { ITreeSitterService } from 'vs/workbench/services/treeSitter/common/treeSitter';

class MyService {
    constructor(
        @ITreeSitterService private readonly treeSitterService: ITreeSitterService
    ) {}
}
```

### 2. 解析单个文件

```typescript
const uri = URI.file('/path/to/file.java');
const result = await this.treeSitterService.parseFile(uri);

if (result.error) {
    console.error('解析失败:', result.error);
} else {
    console.log('找到', result.definitions.length, '个定义');
    for (const def of result.definitions) {
        console.log(`${def.type}: ${def.name} (行 ${def.startLine}-${def.endLine})`);
    }
}
```

### 3. 解析多个文件

```typescript
const uris = [
    URI.file('/path/to/file1.ts'),
    URI.file('/path/to/file2.java'),
    URI.file('/path/to/file3.py')
];

const results = await this.treeSitterService.parseFiles(uris);
for (const result of results) {
    console.log(`文件: ${result.uri.fsPath}`);
    console.log(`定义数量: ${result.definitions.length}`);
}
```

### 4. 检查文件是否支持

```typescript
const uri = URI.file('/path/to/file.java');
if (this.treeSitterService.isSupported(uri)) {
    const result = await this.treeSitterService.parseFile(uri);
    // 处理结果...
}
```

### 5. 使用工具函数格式化输出

```typescript
import { formatCodeDefinitions } from 'vs/workbench/services/treeSitter/common/treeSitterUtils';

const result = await this.treeSitterService.parseFile(uri);
const formatted = formatCodeDefinitions(result);
console.log(formatted);
```

输出示例：
```
# /path/to/Example.java

## Classes
10--50 | public class Example {

## Methods
15--20 | public void doSomething() {
25--30 | private int calculate() {
```

## 支持的语言

当前支持的文件扩展名：
- `.java` - Java
- `.ts` - TypeScript
- `.tsx` - TypeScript with JSX
- `.js` - JavaScript
- `.jsx` - JavaScript with JSX
- `.py` - Python

## 提取的代码定义类型

根据不同的语言，可以提取以下类型的定义：

### Java
- 类 (class)
- 接口 (interface)
- 枚举 (enum)
- 方法 (method)
- 构造函数 (constructor)

### TypeScript/JavaScript
- 类 (class)
- 接口 (interface)
- 函数 (function)
- 方法 (method)
- 类型别名 (type)
- 枚举 (enum)

### Python
- 类 (class)
- 函数 (function)
- 装饰器类 (decorated class)
- 装饰器函数 (decorated function)

## 为list_code_definitions工具集成

这个服务专门设计用于支持`list_code_definitions`工具。使用示例：

```typescript
import { ITreeSitterService } from 'vs/workbench/services/treeSitter/common/treeSitter';
import { extractDefinitionsFromFiles } from 'vs/workbench/services/treeSitter/common/treeSitterUtils';

async function listCodeDefinitions(
    treeSitterService: ITreeSitterService,
    directoryUri: URI
): Promise<string> {
    // 获取目录中所有支持的文件
    const files = await getFilesInDirectory(directoryUri);

    // 提取定义
    const result = await extractDefinitionsFromFiles(treeSitterService, files);

    return result;
}
```

## 性能考虑

- 服务使用延迟初始化（Delayed instantiation）
- Tree-sitter WASM模块按需加载
- 已解析的语法树会被缓存
- 支持批量解析多个文件

## 扩展支持新语言

要添加新语言支持：

1. 在`package.json`中添加对应的tree-sitter包
2. 在`TreeSitterService`的`_loadParser`方法中添加新的case
3. 创建对应的查询字符串方法（如`_getJavaQuery()`）
4. 将新扩展名添加到`_supportedExtensions`数组

## 依赖

- `web-tree-sitter`: Tree-sitter的WebAssembly绑定
- `tree-sitter-java`: Java语法支持
- `tree-sitter-typescript`: TypeScript/TSX语法支持
- `tree-sitter-python`: Python语法支持

所有依赖已在项目的`package.json`中配置。

## 注意事项

1. WASM文件需要正确的路径配置
2. 初始化是异步的，首次使用可能需要等待
3. 大文件可能需要较长的解析时间
4. 查询字符串需要匹配对应的Tree-sitter语法

## 调试

服务会通过`ILogService`输出日志：

- `[TreeSitter] Service initialized successfully` - 初始化成功
- `[TreeSitter] Loaded parser for .java` - 加载解析器
- `[TreeSitter] Parsed /path/to/file: found 5 definitions` - 解析完成
- `[TreeSitter] Failed to load parser for .xyz` - 加载失败

## 测试

TODO: 添加单元测试和集成测试

## 参考

- [Tree-sitter官方文档](https://tree-sitter.github.io/)
- [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web)
- 原始实现: `../kilocode-migration-backup/tree-sitter/`
