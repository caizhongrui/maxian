# AI Tools Migration - Adaptation Summary

## 概述

本次适配将 Kilocode 项目中的剩余 AI 工具文件迁移到 VS Code 架构中。所有工具都已转换为纯函数形式，移除了对 VS Code 特定 API 和外部依赖的直接引用。

## 已适配的工具文件（19个）

### 1. 核心工具

#### updateTodoListTool.ts
- **功能**: 管理 TODO 列表（添加、更新、删除、验证）
- **主要导出**:
  - `TodoItem`, `TodoStatus` 类型定义
  - `addTodoToTask()`, `updateTodoStatus()`, `removeTodo()`
  - `parseMarkdownChecklist()`, `validateTodos()`
  - `todoListToMarkdown()` - 将 TODO 列表转换为 Markdown
- **适配重点**: 移除了 Task 依赖，改为纯函数操作

#### switchModeTool.ts
- **功能**: 在不同 AI 交互模式间切换
- **主要导出**:
  - `ModeInfo` 接口
  - `getModeBySlug()`, `getAllModes()`
  - `validateModeSwitch()` - 验证模式切换
- **适配重点**: 定义了内置模式（code, architect, ask）

#### newTaskTool.ts
- **功能**: 创建新的子任务
- **主要导出**:
  - `NewTaskParams`, `NewTaskResult` 接口
  - `validateNewTaskParams()` - 参数验证
- **适配重点**: 移除了 VS Code 特定的 workspace 配置依赖

### 2. 代码搜索工具

#### codebaseSearchTool.ts
- **功能**: 语义代码搜索
- **主要导出**:
  - `VectorStoreSearchResult`, `CodebaseSearchResult` 接口
  - `formatCodebaseSearchResults()`, `formatCodebaseSearchOutput()`
  - `getIndexStatusMessage()` - 索引状态消息
- **适配重点**: 纯数据处理函数，不依赖索引服务

#### listCodeDefinitionNamesTool.ts
- **功能**: 提取源代码定义
- **主要导出**:
  - `CodeDefinition` 接口
  - `parseCodeDefinitions()` - 简化的定义解析
  - `formatCodeDefinitions()`, `truncateDefinitionsToLineLimit()`
- **适配重点**: 使用正则表达式代替 tree-sitter（占位符）

### 3. MCP (Model Context Protocol) 工具

#### useMcpToolTool.ts
- **功能**: 执行 MCP 服务器工具
- **主要导出**:
  - `McpToolParams`, `McpToolResult`, `McpServer`, `McpTool` 接口
  - `validateMcpToolParams()`, `validateToolExists()`
  - `processToolContent()` - 处理工具结果
  - `reversePropertyRenaming()` - 反向属性重命名
- **适配重点**: 移除了对 MCP Hub 的直接依赖

#### accessMcpResourceTool.ts
- **功能**: 访问 MCP 服务器资源
- **主要导出**:
  - `AccessMcpResourceParams`, `McpResourceResult` 接口
  - `validateAccessMcpResourceParams()`
  - `processResourceContent()` - 处理资源内容和图片
- **适配重点**: 纯数据处理，支持图片数据提取

### 4. 浏览器自动化工具

#### browserActionTool.ts
- **功能**: 浏览器自动化操作
- **主要导出**:
  - `BrowserAction` 类型（launch, click, hover, type, scroll, resize, close）
  - `BrowserActionParams`, `BrowserActionResult` 接口
  - `validateBrowserActionParams()` - 参数验证
  - `toStringlyTyped()` - 类型转换工具
- **适配重点**: 定义了完整的浏览器操作类型系统

### 5. 文件操作工具

#### simpleReadFileTool.ts
- **功能**: 简化的文件读取（单文件模式）
- **主要导出**:
  - `SimpleReadFileParams`, `FileReadResult` 接口
  - `isSupportedImageFormat()`, `isSupportedBinaryFormat()`
  - `addLineNumbers()`, `stripLineNumbers()`, `everyLineHasLineNumbers()`
  - `formatAsXml()` - XML 格式化输出
- **适配重点**: 支持多种文件格式，包括图片和二进制文件

#### newRuleTool.ts
- **功能**: 创建或修改文件（带验证）
- **主要导出**:
  - `NewRuleParams`, `NewRuleResult` 接口
  - `preprocessContent()` - 内容预处理（移除 markdown 标记）
  - `unescapeHtmlEntities()` - HTML 实体反转义
  - `hasLineNumbers()`, `stripLineNumbers()`, `addLineNumbers()`
  - `createPrettyPatch()` - 创建美化的补丁
- **适配重点**: 完整的文件创建和修改流程

### 6. Diff 工具

#### multiApplyDiffTool.ts
- **功能**: 批量应用多文件差异
- **主要导出**:
  - `DiffOperation`, `OperationResult` 接口
  - `OperationStatus` 类型
  - `parseDiffOperationsFromXml()` - 从 XML 解析操作
  - `createBatchDiffData()` - 创建批量 diff 数据
  - `processBatchApprovalResponse()` - 处理批量审批响应
  - `checkForSingleBlockWarning()` - 检查单块警告
- **适配重点**: 支持批量文件操作和审批流程

### 7. 辅助工具

#### condenseTool.ts
- **功能**: 对话摘要，减少上下文大小
- **主要导出**:
  - `ConversationMessage`, `CondenseResult` 接口
  - `estimateTokens()`, `calculateConversationTokens()`
  - `createConversationSummary()`, `condenseConversation()`
- **适配重点**: Token 估算和对话压缩

#### fetchInstructionsTool.ts
- **功能**: 获取预定义指令和指南
- **主要导出**:
  - `INSTRUCTION_CATEGORIES` 常量
  - `getInstructionCategory()`, `fetchInstructionsForTask()`
  - 各类指令生成函数（diff, search-replace, tools, modes, best-practices）
- **适配重点**: 内置了完整的指令模板系统

#### generateImageTool.ts
- **功能**: AI 图片生成
- **主要导出**:
  - `IMAGE_GENERATION_MODELS`, `SUPPORTED_IMAGE_FORMATS` 常量
  - `validateGenerateImageParams()`, `validateImageFormat()`
  - `extractBase64FromDataUrl()`, `ensureImageExtension()`
  - `readImageAsDataUrl()` - 读取图片为 base64
- **适配重点**: 完整的图片生成和格式处理流程

#### reportBugTool.ts
- **功能**: 创建 GitHub bug 报告
- **主要导出**:
  - `ReportBugParams`, `SystemInfo` 接口
  - `validateReportBugParams()`, `gatherSystemInfo()`
  - `formatBugReport()`, `createGitHubIssueUrl()`
- **适配重点**: 系统信息收集和 GitHub URL 生成

#### runSlashCommandTool.ts
- **功能**: 执行自定义斜杠命令
- **主要导出**:
  - `RunSlashCommandParams`, `SlashCommand` 接口
  - `validateRunSlashCommandParams()`
  - `formatCommandResult()`, `createCommandNotFoundError()`
- **适配重点**: 命令格式化和错误处理

### 8. 验证和检测工具

#### validateToolUse.ts
- **功能**: 基于模式验证工具使用
- **主要导出**:
  - `ToolName`, `Mode`, `ModeConfig` 类型
  - `isToolAllowedForMode()` - 检查工具是否允许在当前模式
  - `validateToolUse()` - 验证工具使用
- **适配重点**: 完整的工具-模式权限系统

#### ToolRepetitionDetector.ts
- **功能**: 检测连续相同工具调用，防止循环
- **主要导出**:
  - `ToolRepetitionDetector` 类
  - `check()` - 检查重复调用
  - `serializeToolUse()` - 序列化工具使用
  - `isBrowserScrollAction()` - 特殊处理浏览器滚动
- **适配重点**: 智能检测和限制重复调用

### 9. Kilocode 特定工具

#### kilocode.ts
- **功能**: Kilocode 特定的工具函数
- **主要导出**:
  - `FileEntry` 接口
  - `checkTokenLimit()`, `estimateTokens()`, `getTokenLimit()`
  - `summarizeSuccessfulMcpOutputWhenTooLong()` - MCP 输出摘要
  - `blockFileReadWhenTooLarge()` - 大文件读取阻止
  - `parseNativeFiles()` - 解析原生文件格式
  - `getNativeReadFileToolDescription()` - 获取工具描述
- **适配重点**: Token 管理和文件大小限制

## 适配原则

### 1. 架构适配
- **移除外部依赖**: 所有文件都移除了对 `Task`, `vscode`, 等外部模块的直接依赖
- **纯函数设计**: 所有工具函数都是纯函数，便于测试和维护
- **类型安全**: 使用 TypeScript 接口确保类型安全

### 2. 功能保留
- **核心逻辑**: 保留了所有核心业务逻辑
- **验证机制**: 保留了完整的参数验证和错误处理
- **格式化**: 保留了各种数据格式化功能

### 3. 简化处理
- **占位实现**: 某些复杂功能（如 tree-sitter）使用简化的占位实现
- **移除 UI 逻辑**: 移除了与 VS Code UI 相关的直接操作
- **数据转换**: 专注于数据处理和转换逻辑

## 文件统计

- **总文件数**: 19 个核心工具文件
- **总代码行数**: ~3,113 行
- **平均文件大小**: ~164 行/文件
- **接口定义**: ~90+ 个 TypeScript 接口
- **导出函数**: ~120+ 个工具函数

## 使用建议

1. **导入方式**:
   ```typescript
   import { validateToolUse } from './tools/validateToolUse.js';
   import { TodoItem, parseMarkdownChecklist } from './tools/updateTodoListTool.js';
   ```

2. **集成方式**:
   - 这些工具函数可以被 `toolExecutor.ts` 或其他服务调用
   - 通过依赖注入提供必要的上下文（文件服务、工作区路径等）

3. **扩展方式**:
   - 所有函数都是纯函数，易于扩展
   - 可以根据需要添加 VS Code 特定的包装器

## 下一步工作

1. **集成测试**: 为每个工具编写单元测试
2. **文档完善**: 为每个工具添加详细的使用文档
3. **性能优化**: 对大文件处理和搜索功能进行性能优化
4. **UI 集成**: 将工具函数集成到 VS Code UI 层
5. **错误处理**: 完善错误处理和用户反馈机制

## 注意事项

- 某些工具（如 `codebaseSearchTool`）需要额外的索引服务支持
- 图片生成工具需要配置外部 API 密钥
- MCP 工具需要 MCP 服务器支持
- 浏览器自动化需要浏览器驱动支持

## 总结

本次适配成功将 Kilocode 项目中的 19 个核心工具文件迁移到 VS Code 架构中，所有工具都保持了核心功能，同时适配了新的架构模式。这些工具为 AI 辅助编程提供了强大的基础设施支持。
