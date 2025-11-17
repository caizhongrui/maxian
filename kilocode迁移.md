# Kilocode 完整迁移计划

## 迁移原则
1. **完全照抄**：不改动任何逻辑，只做必要的路径和集成调整
2. **保持原有架构**：维持Kilocode的目录结构和模块划分
3. **按功能迁移**：从底层基础功能到上层应用功能，逐个迁移
4. **可运行优先**：每个功能迁移完成后立即验证可运行
5. **集成到AI Chat**：将功能集成到现有的AI Chat视图中

## 源码位置
- **Kilocode源码**: `/Users/caizhongrui/Downloads/kilocode-main/src/`
- **目标位置**: `/Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/tianhe-zhikai-ide/extensions/kilocode/src/`
- **集成位置**: `/Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/tianhe-zhikai-ide/src/vs/workbench/contrib/aiChat/`

---

## 阶段一：基础设施层（功能1-7）

### ✅ 功能1：类型定义系统
**优先级**: P0（必须最先完成）
**依赖**: 无

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/packages/types/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/shared/ExtensionMessage.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/shared/tools.ts`

**目标位置**:
- `extensions/kilocode/src/packages/types/`
- `extensions/kilocode/src/shared/ExtensionMessage.ts`
- `extensions/kilocode/src/shared/tools.ts`

**迁移内容**:
- 所有TypeScript类型定义
- 工具类型（ToolName, ToolParams等）
- 消息类型（ExtensionMessage, ClineMessage等）
- API类型（ApiConfiguration, ApiHandler等）

**验证标准**:
- [ ] TypeScript编译无类型错误
- [ ] 所有类型可以正确导入导出

---

### 功能2：工具函数库
**优先级**: P0
**依赖**: 功能1（类型定义）

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/utils/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/shared/array.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/shared/fs.ts`

**目标位置**:
- `extensions/kilocode/src/utils/`
- `extensions/kilocode/src/shared/`

**迁移内容**:
- 路径处理函数
- 文件系统工具
- 字符串处理
- 数组工具
- 日志工具
- 其他通用工具函数

**验证标准**:
- [ ] 所有工具函数可以正常调用
- [ ] 单元测试通过（如果有）

---

### 功能3：文件系统服务
**优先级**: P0
**依赖**: 功能1, 功能2

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/glob/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/ripgrep/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/ignore/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/protect/`

**目标位置**:
- `extensions/kilocode/src/services/glob/`
- `extensions/kilocode/src/services/ripgrep/`
- `extensions/kilocode/src/core/ignore/`
- `extensions/kilocode/src/core/protect/`

**迁移内容**:
- 文件列表工具（list-files.ts）
- 文件搜索工具（ripgrep封装）
- .rooignore 文件处理
- .rooprotect 文件保护

**验证标准**:
- [ ] 可以列出文件和目录
- [ ] 可以搜索文件内容
- [ ] .rooignore 规则生效
- [ ] .rooprotect 规则生效

---

### 功能4：环境信息收集
**优先级**: P1
**依赖**: 功能2, 功能3

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/environment/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/integrations/workspace/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/integrations/misc/get-theme.ts`

**目标位置**:
- `extensions/kilocode/src/core/environment/`
- `extensions/kilocode/src/integrations/workspace/`
- `extensions/kilocode/src/integrations/misc/`

**迁移内容**:
- 操作系统信息
- Shell环境信息
- 工作区信息
- VSCode版本信息
- 主题信息

**验证标准**:
- [ ] 可以获取完整的环境信息
- [ ] 环境信息格式正确

---

### 功能5：上下文管理
**优先级**: P1
**依赖**: 功能1, 功能2, 功能3

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/context/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/context-tracking/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/mentions/`

**目标位置**:
- `extensions/kilocode/src/core/context/`
- `extensions/kilocode/src/core/context-tracking/`
- `extensions/kilocode/src/core/mentions/`

**迁移内容**:
- 上下文提供器
- 文件上下文追踪
- @提及功能（@文件, @文件夹, @网址等）
- URL内容抓取

**验证标准**:
- [ ] 可以追踪已使用的文件
- [ ] @提及可以正确解析和获取内容

---

### 功能6：配置管理
**优先级**: P1
**依赖**: 功能1, 功能2

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/config/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/roo-config/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/shared/modes.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/shared/experiments.ts`

**目标位置**:
- `extensions/kilocode/src/core/config/`
- `extensions/kilocode/src/services/roo-config/`
- `extensions/kilocode/src/shared/modes.ts`
- `extensions/kilocode/src/shared/experiments.ts`

**迁移内容**:
- API配置管理
- 模式配置（Chat/Agent/Architect）
- 实验性功能开关
- 用户偏好设置
- Roo配置文件处理

**验证标准**:
- [ ] 可以读取和保存配置
- [ ] 模式切换正常
- [ ] 实验性功能开关生效

---

### 功能7：国际化系统
**优先级**: P2
**依赖**: 功能1

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/i18n/`

**目标位置**:
- `extensions/kilocode/src/i18n/`

**迁移内容**:
- 多语言翻译文件
- i18next配置
- 翻译函数（t()）

**验证标准**:
- [ ] 可以切换语言
- [ ] 翻译文本正确显示

---

## 阶段二：API和消息处理层（功能8-12）

### 功能8：API抽象层
**优先级**: P0
**依赖**: 功能1, 功能2, 功能6

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/api/`（核心文件）

**目标位置**:
- `extensions/kilocode/src/api/`

**迁移内容**:
- ApiHandler 基类
- API配置接口
- 错误处理
- 重试逻辑

**验证标准**:
- [ ] ApiHandler 可以正确初始化
- [ ] 错误处理正常工作

---

### 功能9：API提供商（Anthropic, OpenAI等）
**优先级**: P0
**依赖**: 功能8

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/api/providers/anthropic.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/api/providers/openai.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/api/providers/openrouter.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/api/providers/bedrock.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/api/providers/vertex.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/api/providers/openai-native.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/api/providers/glama.ts`

**目标位置**:
- `extensions/kilocode/src/api/providers/`

**迁移内容**:
- 所有API提供商实现
- 流式响应处理
- Token计数
- 缓存处理

**验证标准**:
- [ ] 可以成功调用API
- [ ] 流式响应正常工作
- [ ] Token计数准确

---

### 功能10：消息格式转换
**优先级**: P0
**依赖**: 功能1, 功能9

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/api/transform/`

**目标位置**:
- `extensions/kilocode/src/api/transform/`

**迁移内容**:
- Anthropic ↔ OpenAI 消息格式转换
- 工具调用格式转换
- 图片格式转换

**验证标准**:
- [ ] 消息格式转换正确
- [ ] 工具调用可以正常工作

---

### 功能11：滑动窗口和上下文压缩
**优先级**: P1
**依赖**: 功能1, 功能8

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/sliding-window/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/condense/`

**目标位置**:
- `extensions/kilocode/src/core/sliding-window/`
- `extensions/kilocode/src/core/condense/`

**迁移内容**:
- truncateConversation 函数
- 上下文压缩（使用LLM总结）
- Token计数和管理

**验证标准**:
- [ ] 消息历史可以正确截断
- [ ] 上下文压缩功能正常（可选）

---

### 功能12：提示词系统
**优先级**: P0
**依赖**: 功能1, 功能4, 功能5, 功能6

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/prompts/`

**目标位置**:
- `extensions/kilocode/src/core/prompts/`

**迁移内容**:
- 系统提示词模板
- 工具描述生成
- 响应格式化（responses.ts）
- 模式特定提示词

**验证标准**:
- [ ] 系统提示词可以正确生成
- [ ] 包含所有必要的上下文信息

---

## 阶段三：工具系统（功能13-22）

### 功能13：工具基础设施
**优先级**: P0
**依赖**: 功能1, 功能2, 功能3

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/ToolRepetitionDetector.ts`

**目标位置**:
- `extensions/kilocode/src/core/tools/ToolRepetitionDetector.ts`

**迁移内容**:
- ToolRepetitionDetector 类
- 工具类型定义
- 工具验证逻辑

**验证标准**:
- [ ] 工具重复检测正常工作

---

### 功能14：文件读取工具
**优先级**: P0
**依赖**: 功能3, 功能13

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/readFileTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/simpleReadFileTool.ts`

**目标位置**:
- `extensions/kilocode/src/core/tools/readFileTool.ts`
- `extensions/kilocode/src/core/tools/simpleReadFileTool.ts`

**迁移内容**:
- read_file 工具实现
- simple_read_file 工具实现
- 文件内容读取和格式化

**验证标准**:
- [ ] 可以读取文件内容
- [ ] 支持偏移和限制参数

---

### 功能15：文件写入工具
**优先级**: P0
**依赖**: 功能3, 功能13

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/writeToFileTool.ts`

**目标位置**:
- `extensions/kilocode/src/core/tools/writeToFileTool.ts`

**迁移内容**:
- write_to_file 工具实现
- 文件创建和覆盖逻辑

**验证标准**:
- [ ] 可以创建新文件
- [ ] 可以覆盖现有文件

---

### 功能16：文件编辑工具（Diff系统）
**优先级**: P0
**依赖**: 功能3, 功能13

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/applyDiffTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/applyDiffToolLegacy.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/multiApplyDiffTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/editFileTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/insertContentTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/diff/`

**目标位置**:
- `extensions/kilocode/src/core/tools/`
- `extensions/kilocode/src/core/diff/`

**迁移内容**:
- apply_diff 工具（搜索替换）
- edit_file 工具（Morph fast apply）
- insert_content 工具
- 多文件diff支持
- Diff策略（SearchReplace, BlockReplacement等）
- 模糊匹配

**验证标准**:
- [ ] 可以使用搜索替换编辑文件
- [ ] 可以使用行号编辑文件
- [ ] 可以插入内容
- [ ] 支持多文件同时编辑

---

### 功能17：文件浏览工具
**优先级**: P0
**依赖**: 功能3, 功能13

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/listFilesTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/searchFilesTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/listCodeDefinitionNamesTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/codebaseSearchTool.ts`

**目标位置**:
- `extensions/kilocode/src/core/tools/`

**迁移内容**:
- list_files 工具
- search_files 工具（ripgrep）
- list_code_definition_names 工具（tree-sitter）
- codebase_search 工具（语义搜索）

**验证标准**:
- [ ] 可以列出文件和目录
- [ ] 可以搜索文件内容
- [ ] 可以列出代码定义
- [ ] 语义搜索正常工作（可选）

---

### 功能18：终端命令工具
**优先级**: P1
**依赖**: 功能13

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/executeCommandTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/terminal/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/integrations/terminal/`

**目标位置**:
- `extensions/kilocode/src/core/tools/executeCommandTool.ts`
- `extensions/kilocode/src/services/terminal/`
- `extensions/kilocode/src/integrations/terminal/`

**迁移内容**:
- execute_command 工具
- 终端进程管理
- 命令执行和输出捕获

**验证标准**:
- [ ] 可以执行终端命令
- [ ] 可以获取命令输出

---

### 功能19：浏览器自动化工具
**优先级**: P2
**依赖**: 功能13

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/browserActionTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/browser/`

**目标位置**:
- `extensions/kilocode/src/core/tools/browserActionTool.ts`
- `extensions/kilocode/src/services/browser/`

**迁移内容**:
- browser_action 工具
- Puppeteer集成
- 浏览器截图

**验证标准**:
- [ ] 可以启动浏览器
- [ ] 可以执行浏览器操作
- [ ] 可以获取截图

---

### 功能20：MCP工具集成
**优先级**: P2
**依赖**: 功能13

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/useMcpToolTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/accessMcpResourceTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/mcp/`

**目标位置**:
- `extensions/kilocode/src/core/tools/`
- `extensions/kilocode/src/services/mcp/`

**迁移内容**:
- use_mcp_tool 工具
- access_mcp_resource 工具
- MCP服务器管理

**验证标准**:
- [ ] 可以连接MCP服务器
- [ ] 可以调用MCP工具
- [ ] 可以访问MCP资源

---

### 功能21：任务管理工具
**优先级**: P1
**依赖**: 功能13

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/attemptCompletionTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/askFollowupQuestionTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/updateTodoListTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/newTaskTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/switchModeTool.ts`

**目标位置**:
- `extensions/kilocode/src/core/tools/`

**迁移内容**:
- attempt_completion 工具
- ask_followup_question 工具
- update_todo_list 工具
- new_task 工具
- switch_mode 工具

**验证标准**:
- [ ] 可以完成任务
- [ ] 可以询问用户问题
- [ ] 可以管理TODO列表
- [ ] 可以创建子任务
- [ ] 可以切换模式

---

### 功能22：其他工具
**优先级**: P2
**依赖**: 功能13

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/fetchInstructionsTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/runSlashCommandTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/generateImageTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/newRuleTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/reportBugTool.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/tools/condenseTool.ts`

**目标位置**:
- `extensions/kilocode/src/core/tools/`

**迁移内容**:
- fetch_instructions 工具
- run_slash_command 工具
- generate_image 工具
- new_rule 工具
- report_bug 工具
- condense 工具

**验证标准**:
- [ ] 各工具可以正常调用

---

## 阶段四：核心任务系统（功能23-27）

### 功能23：消息处理和工具执行
**优先级**: P0
**依赖**: 功能8, 功能12, 功能13-22（所有工具）

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/assistant-message/`

**目标位置**:
- `extensions/kilocode/src/core/assistant-message/`

**迁移内容**:
- presentAssistantMessage 函数
- parseAssistantMessage 函数
- 流式消息解析
- 工具执行循环
- 工具审批机制

**验证标准**:
- [ ] 可以解析助手消息
- [ ] 可以执行工具
- [ ] 工具审批正常工作

---

### 功能24：任务持久化
**优先级**: P1
**依赖**: 功能1, 功能2

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/task-persistence/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/checkpoints/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/checkpoints/`

**目标位置**:
- `extensions/kilocode/src/core/task-persistence/`
- `extensions/kilocode/src/core/checkpoints/`
- `extensions/kilocode/src/services/checkpoints/`

**迁移内容**:
- 任务历史存储
- API消息存储
- 检查点管理
- 任务恢复

**验证标准**:
- [ ] 任务历史可以保存和加载
- [ ] 检查点可以创建和恢复

---

### 功能25：消息队列
**优先级**: P1
**依赖**: 功能1

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/message-queue/`

**目标位置**:
- `extensions/kilocode/src/core/message-queue/`

**迁移内容**:
- 消息队列管理
- 消息优先级处理

**验证标准**:
- [ ] 消息可以正确排队和处理

---

### 功能26：Task核心类
**优先级**: P0
**依赖**: 功能1-25（几乎所有功能）

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/task/Task.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/task/types.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/task/AutoApprovalHandler.ts`

**目标位置**:
- `extensions/kilocode/src/core/task/`

**迁移内容**:
- Task 类（3000+行核心逻辑）
- recursivelyMakeClineRequests 方法
- attemptApiRequest 方法
- 任务生命周期管理
- 自动审批处理

**验证标准**:
- [ ] Task可以成功创建
- [ ] 可以发起API请求
- [ ] 工具执行循环正常
- [ ] 任务可以完成或中止

---

### 功能27：斜杠命令
**优先级**: P2
**依赖**: 功能1, 功能2, 功能26

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/slash-commands/`

**目标位置**:
- `extensions/kilocode/src/core/slash-commands/`

**迁移内容**:
- 斜杠命令解析
- 预定义命令执行

**验证标准**:
- [ ] 可以解析斜杠命令
- [ ] 预定义命令可以执行

---

## 阶段五：UI和集成层（功能28-32）

### 功能28：Webview UI（Provider）
**优先级**: P0
**依赖**: 功能26

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/webview/ClineProvider.ts`
- `/Users/caizhongrui/Downloads/kilocode-main/src/core/webview/HistoryViewProvider.ts`

**目标位置**:
- `extensions/kilocode/src/core/webview/`

**迁移内容**:
- ClineProvider（主视图提供器）
- HistoryViewProvider（历史视图）
- Webview消息通信
- 状态管理

**验证标准**:
- [ ] Webview可以正常显示
- [ ] 消息通信正常
- [ ] 状态同步正常

---

### 功能29：编辑器集成
**优先级**: P1
**依赖**: 功能26, 功能28

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/integrations/editor/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/integrations/diagnostics/`

**目标位置**:
- `extensions/kilocode/src/integrations/editor/`
- `extensions/kilocode/src/integrations/diagnostics/`

**迁移内容**:
- 编辑器装饰器
- Diff预览
- 诊断信息集成

**验证标准**:
- [ ] 文件修改可以在编辑器中显示
- [ ] Diff预览正常工作

---

### 功能30：通知和主题
**优先级**: P2
**依赖**: 功能28

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/integrations/notifications/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/integrations/theme/`

**目标位置**:
- `extensions/kilocode/src/integrations/notifications/`
- `extensions/kilocode/src/integrations/theme/`

**迁移内容**:
- 通知显示
- 主题适配

**验证标准**:
- [ ] 通知可以正常显示
- [ ] 主题切换正常

---

### 功能31：其他集成
**优先级**: P2
**依赖**: 功能28

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/integrations/`（其他文件）

**目标位置**:
- `extensions/kilocode/src/integrations/`

**迁移内容**:
- 其他VSCode集成功能

**验证标准**:
- [ ] 相关集成功能正常

---

### 功能32：激活和入口
**优先级**: P0
**依赖**: 功能26, 功能28

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/activate/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/extension.ts`

**目标位置**:
- `extensions/kilocode/src/activate/`
- `extensions/kilocode/src/extension.ts`

**迁移内容**:
- 扩展激活逻辑
- 命令注册
- 视图注册

**验证标准**:
- [ ] 扩展可以正常激活
- [ ] 命令和视图可以注册

---

## 阶段六：高级功能和服务（功能33-40）

### 功能33：Tree-sitter代码解析
**优先级**: P2
**依赖**: 功能3

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/tree-sitter/`

**目标位置**:
- `extensions/kilocode/src/services/tree-sitter/`

**迁移内容**:
- Tree-sitter解析器
- 代码定义提取

**验证标准**:
- [ ] 可以解析代码文件
- [ ] 可以提取函数/类定义

---

### 功能34：代码索引
**优先级**: P2
**依赖**: 功能3, 功能33

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/code-index/`

**目标位置**:
- `extensions/kilocode/src/services/code-index/`

**迁移内容**:
- 代码索引构建
- 语义搜索

**验证标准**:
- [ ] 可以构建代码索引
- [ ] 语义搜索返回相关结果

---

### 功能35：提交消息生成
**优先级**: P2
**依赖**: 功能8, 功能26

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/commit-message/`

**目标位置**:
- `extensions/kilocode/src/services/commit-message/`

**迁移内容**:
- Git diff分析
- 提交消息生成

**验证标准**:
- [ ] 可以生成合适的提交消息

---

### 功能36-40：其他服务
**优先级**: P3
**依赖**: 按具体功能而定

**源文件**:
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/ghost/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/auto-purge/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/marketplace/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/mdm/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/command/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/continuedev/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/mocking/`
- `/Users/caizhongrui/Downloads/kilocode-main/src/services/terminal-welcome/`
- `/Users/caizhongrui/Downloads/kilocode-main/packages/telemetry/`
- `/Users/caizhongrui/Downloads/kilocode-main/packages/cloud/`

**目标位置**:
- `extensions/kilocode/src/services/`
- `extensions/kilocode/src/packages/`

**迁移内容**:
- 各种辅助服务和功能

**验证标准**:
- [ ] 相关服务正常工作（按需）

---

## 阶段七：AI Chat集成（功能41）

### 功能41：将Kilocode集成到AI Chat
**优先级**: P0
**依赖**: 功能1-40（所有功能）

**修改文件**:
- `src/vs/workbench/contrib/aiChat/browser/aiChatView.ts`
- `src/vs/workbench/contrib/aiChat/common/aiChatService.ts`

**集成方案**:

#### 方案A：完全替换（推荐）
```typescript
// 1. AIChatView 内部完全使用 Kilocode
import { ClineProvider } from '../../../extensions/kilocode/src/core/webview/ClineProvider.js';
import { Task } from '../../../extensions/kilocode/src/core/task/Task.js';

export class AIChatView extends ViewPane {
    private kilocodeProvider: ClineProvider;

    constructor(...) {
        // 初始化Kilocode Provider
        this.kilocodeProvider = new ClineProvider(context);
    }

    // Agent模式直接使用Kilocode的Task
    async executeAgentTask(requirement: string) {
        const task = await this.kilocodeProvider.createTask({
            task: requirement,
            mode: 'agent'
        });
    }
}
```

#### 方案B：混合使用
- Chat模式：继续使用现有的流式响应
- Agent模式：使用Kilocode的Task
- Architect模式：使用Kilocode的Task（只读工具）

**验证标准**:
- [ ] Agent模式使用Kilocode核心
- [ ] 消息显示在AI Chat UI中
- [ ] 工具执行正常
- [ ] 用户交互正常
- [ ] 任务历史可以保存和恢复

---

## 迁移进度跟踪表

| 阶段 | 功能 | 状态 | 完成日期 | 备注 |
|------|------|------|----------|------|
| 一 | 1. 类型定义系统 | ⬜ 未开始 | - | P0 |
| 一 | 2. 工具函数库 | ⬜ 未开始 | - | P0 |
| 一 | 3. 文件系统服务 | ⬜ 未开始 | - | P0 |
| 一 | 4. 环境信息收集 | ⬜ 未开始 | - | P1 |
| 一 | 5. 上下文管理 | ⬜ 未开始 | - | P1 |
| 一 | 6. 配置管理 | ⬜ 未开始 | - | P1 |
| 一 | 7. 国际化系统 | ⬜ 未开始 | - | P2 |
| 二 | 8. API抽象层 | ⬜ 未开始 | - | P0 |
| 二 | 9. API提供商 | ⬜ 未开始 | - | P0 |
| 二 | 10. 消息格式转换 | ⬜ 未开始 | - | P0 |
| 二 | 11. 滑动窗口和压缩 | 🟡 部分完成 | - | P1 |
| 二 | 12. 提示词系统 | ⬜ 未开始 | - | P0 |
| 三 | 13. 工具基础设施 | 🟡 部分完成 | - | P0 |
| 三 | 14-22. 所有工具 | ⬜ 未开始 | - | P0-P2 |
| 四 | 23. 消息处理和工具执行 | ⬜ 未开始 | - | P0 |
| 四 | 24. 任务持久化 | ⬜ 未开始 | - | P1 |
| 四 | 25. 消息队列 | ⬜ 未开始 | - | P1 |
| 四 | 26. Task核心类 | ⬜ 未开始 | - | P0 最核心 |
| 四 | 27. 斜杠命令 | ⬜ 未开始 | - | P2 |
| 五 | 28. Webview UI | ⬜ 未开始 | - | P0 |
| 五 | 29-32. UI集成 | ⬜ 未开始 | - | P1-P2 |
| 六 | 33-40. 高级服务 | ⬜ 未开始 | - | P2-P3 |
| 七 | 41. AI Chat集成 | ⬜ 未开始 | - | P0 最终目标 |

---

## 推荐迁移顺序

### 最小可行方案（MVP）
专注于核心agent功能，按以下顺序：

**第1周**：基础设施
- 功能1 → 功能2 → 功能3 → 功能6

**第2周**：API层
- 功能8 → 功能9 → 功能10 → 功能12

**第3-4周**：工具系统
- 功能13 → 功能14 → 功能15 → 功能16 → 功能17 → 功能21

**第5周**：任务核心
- 功能11 → 功能23 → 功能24 → 功能26

**第6周**：UI和最终集成
- 功能28 → 功能32 → 功能41

**目标**：6周完成基本agent功能

---

## 每个功能迁移的标准流程

### 1. 准备阶段
- [ ] 阅读Kilocode源码，理解功能
- [ ] 确认依赖功能已迁移
- [ ] 创建目标目录

### 2. 迁移阶段
- [ ] 复制源文件到目标位置
- [ ] 调整import路径
- [ ] 适配VSCode内置API（如需）
- [ ] 添加注释标记：`// Copied from Kilocode`

### 3. 验证阶段
- [ ] TypeScript编译通过
- [ ] 创建简单测试用例
- [ ] 功能正常工作
- [ ] 更新进度表

### 4. 文档阶段
- [ ] 记录遇到的问题和解决方案
- [ ] 更新本迁移文档

---

## 关键注意事项

### 路径调整规则
```typescript
// Kilocode原始
import { Task } from './core/task/Task'
import * as vscode from 'vscode'

// 迁移后
import { Task } from '../kilocode/src/core/task/Task.js'
import * as vscode from 'vscode' // 保持不变
```

### 依赖处理
保留Kilocode的所有依赖：
- @anthropic-ai/sdk
- openai
- ripgrep
- tree-sitter
- 等等

### VSCode API适配
大部分Kilocode代码可以直接使用，因为都是标准的VSCode扩展API

---

## 遇到问题的处理流程

1. **记录问题**：在本文档中记录
2. **查看原始实现**：理解Kilocode的实现
3. **最小化修改**：只做必要的路径和API适配
4. **标记修改**：添加注释 `// Adapted for tianhe-zhikai-ide`
5. **验证功能**：确保功能正常

---

## 参考资料

- **Kilocode源码**: `/Users/caizhongrui/Downloads/kilocode-main/src/`
- **目标位置**: `extensions/kilocode/src/`
- **AI Chat**: `src/vs/workbench/contrib/aiChat/`
- **Kilocode文档**: https://github.com/kilocode/kilocode

---

## 总结

本迁移计划共 **41个功能模块**，分 **7个阶段**。

**核心思路**：完全照抄 + 最小化适配 + 分步验证

**预计时间**：6-8周完成MVP，10-12周完成全部功能
