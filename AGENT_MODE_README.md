# 智开 AI - Agent模式完整指南

## 概述

智开AI的Agent模式是一个强大的代码生成和项目管理助手，它通过30个专业工具来自动完成复杂的编程任务。

## 功能特性

### 🎯 核心能力
- ✅ **自动代码生成** - 根据需求自动创建文件和代码
- ✅ **智能文件管理** - 读取、修改、搜索项目文件
- ✅ **项目结构分析** - 理解项目架构和代码组织
- ✅ **差异应用** - 精确修改代码片段
- ✅ **错误处理** - 自动检测和纠正错误

### 🛠️ 30个专业工具

#### 文件操作工具 (6个)
1. **read_file** - 读取文件内容（支持行范围）
2. **write_to_file** - 创建新文件
3. **edit_file** - 修改文件内容
4. **apply_diff** - 应用代码差异
5. **insert_content** - 在指定行插入内容
6. **simple_read_file** - 简单读取文件

#### 文件浏览工具 (4个)
7. **list_files** - 列出目录文件
8. **search_files** - 搜索文件内容
9. **list_code_definition_names** - 列出代码定义
10. **codebase_search** - 语义搜索代码库

#### 执行和交互工具 (3个)
11. **execute_command** - 执行终端命令
12. **attempt_completion** - 完成任务
13. **ask_followup_question** - 询问用户

#### 扩展工具 (17个)
14-30. 包括浏览器自动化、图像生成、任务管理、Bug报告等

---

## 快速开始

### 1. 启动Agent模式
1. 打开VS Code
2. 点击侧边栏的"智开"图标
3. 点击模式切换按钮，选择"🤖 Agent"

### 2. 给出任务描述
在输入框中输入您的需求，例如：

```
创建一个用户管理功能，包括：
- UserDTO（id, username, email, phone）
- UserService（增删改查）
- UserController（REST API）
- UserMapper（MyBatis）
```

### 3. AI自动执行
Agent会：
1. 使用 `list_files` 了解项目结构
2. 使用 `read_file` 学习现有代码风格
3. 使用 `write_to_file` 创建新文件
4. 使用 `attempt_completion` 完成任务

---

## 使用示例

### 示例1: 创建简单文件

**用户输入**:
```
创建一个 Hello.java 文件，包含 main 方法打印 "Hello World"
```

**Agent执行流程**:
```
🤔 思考中...

💬 AI: 我将创建 Hello.java 文件

🔧 使用工具: write_to_file
📋 参数:
{
  "path": "Hello.java",
  "content": "public class Hello {\n    public static void main(String[] args) {\n        System.out.println(\"Hello World\");\n    }\n}"
}

✅ 结果: Successfully created file: Hello.java (85 bytes)

✅ 任务完成

已创建 Hello.java 文件，包含 main 方法打印 "Hello World"
```

---

### 示例2: 修改现有文件

**用户输入**:
```
在 User.java 中添加一个 phone 字段
```

**Agent执行流程**:
```
🤔 思考中...

💬 AI: 我将先读取 User.java 了解当前代码结构

🔧 使用工具: read_file
📋 参数:
{
  "path": "src/User.java"
}

✅ 结果:
1: public class User {
2:     private Long id;
3:     private String username;
4:     private String email;
5: }

🤔 思考中...

💬 AI: 现在我将添加 phone 字段

🔧 使用工具: edit_file
📋 参数:
{
  "path": "src/User.java",
  "search": "private String email;",
  "replace": "private String email;\n    private String phone;"
}

✅ 结果: Successfully edited file: src/User.java

✅ 任务完成

已在 User.java 中成功添加 phone 字段
```

---

### 示例3: 创建完整的业务层

**用户输入**:
```
创建订单管理功能，包括 Order 的完整后端实现（DTO、Service、Mapper、Controller）
```

**Agent执行流程**:
```
🤔 思考中...

💬 AI: 我将先了解项目结构和现有代码风格

🔧 使用工具: list_files
📋 参数:
{
  "path": "src/main/java",
  "recursive": "true"
}

✅ 结果:
📁 com/
  📁 example/
    📁 dto/
      📄 UserDTO.java
      📄 ProductDTO.java
    📁 service/
      📄 UserService.java
    📁 mapper/
      📄 UserMapper.java
    📁 controller/
      📄 UserController.java

🤔 思考中...

💬 AI: 我将读取现有的 UserDTO 来学习项目的代码风格

🔧 使用工具: read_file
📋 参数:
{
  "path": "src/main/java/com/example/dto/UserDTO.java"
}

✅ 结果:
[显示UserDTO内容]

🤔 思考中...

💬 AI: 现在我将创建 OrderDTO

🔧 使用工具: write_to_file
📋 参数:
{
  "path": "src/main/java/com/example/dto/OrderDTO.java",
  "content": "package com.example.dto;\n\nimport lombok.Data;\n..."
}

✅ 结果: Successfully created file: OrderDTO.java

💬 AI: 创建 OrderMapper

🔧 使用工具: write_to_file
📋 参数:
{
  "path": "src/main/java/com/example/mapper/OrderMapper.java",
  "content": "package com.example.mapper;\n..."
}

✅ 结果: Successfully created file: OrderMapper.java

💬 AI: 创建 OrderService

🔧 使用工具: write_to_file
📋 参数:
{
  "path": "src/main/java/com/example/service/OrderService.java",
  "content": "package com.example.service;\n..."
}

✅ 结果: Successfully created file: OrderService.java

💬 AI: 创建 OrderController

🔧 使用工具: write_to_file
📋 参数:
{
  "path": "src/main/java/com/example/controller/OrderController.java",
  "content": "package com.example.controller;\n..."
}

✅ 结果: Successfully created file: OrderController.java

✅ 任务完成

完整的订单管理功能已创建，包括：
- OrderDTO (数据传输对象)
- OrderMapper (数据访问层)
- OrderService (业务逻辑层)
- OrderController (REST API控制层)

所有文件已创建在正确的包路径下，遵循项目的现有代码风格。
```

---

## Agent工作原理

### 1. 任务理解
Agent首先分析用户的需求，理解要实现什么功能。

### 2. 项目探索
- 使用 `list_files` 了解项目结构
- 使用 `read_file` 阅读现有代码
- 学习项目的编码风格和架构模式

### 3. 代码生成
- 根据学到的风格生成代码
- 使用 `write_to_file` 创建新文件
- 使用 `edit_file` 修改现有文件

### 4. 任务完成
- 使用 `attempt_completion` 标记任务完成
- 提供详细的完成报告

---

## 最佳实践

### ✅ 做这些
1. **清晰描述需求** - 说明要创建什么功能、包含哪些组件
2. **提供上下文** - 说明项目类型、使用的框架
3. **分步执行** - 复杂任务可以分成多个小任务
4. **验证结果** - 任务完成后检查生成的代码

### ❌ 避免这些
1. 不要给出模糊的需求
2. 不要期望Agent猜测你的意图
3. 不要一次要求太多不相关的功能
4. 不要在没有工作区的情况下使用Agent模式

---

## 工具调用格式

Agent使用XML格式调用工具：

```xml
<TOOL_USE>
<tool_name>工具名称</tool_name>
<参数1>值1</参数1>
<参数2>值2</参数2>
</TOOL_USE>
```

### 示例：读取文件
```xml
<TOOL_USE>
<tool_name>read_file</tool_name>
<path>src/User.java</path>
</TOOL_USE>
```

### 示例：创建文件
```xml
<TOOL_USE>
<tool_name>write_to_file</tool_name>
<path>src/dto/OrderDTO.java</path>
<content>package com.example.dto;

import lombok.Data;

@Data
public class OrderDTO {
    private Long id;
    private String orderNumber;
}</content>
</TOOL_USE>
```

---

## 常见问题

### Q1: Agent模式和Chat模式有什么区别？
**A**:
- **Chat模式** - 问答式交互，回答问题、解释代码
- **Agent模式** - 自动执行任务，生成和修改代码文件

### Q2: Agent会覆盖我的现有代码吗？
**A**: Agent只会在你明确要求时修改文件。建议使用Git版本控制。

### Q3: Agent可以执行终端命令吗？
**A**: 框架已支持，但需要集成终端服务才能实际执行（当前返回占位符）。

### Q4: 如何停止Agent正在执行的任务？
**A**: 点击"⬛ 停止"按钮（在生成过程中会显示）。

### Q5: Agent支持哪些编程语言？
**A**: Agent支持所有主流编程语言（Java、Python、TypeScript、JavaScript、Go等），它会学习项目的现有代码风格。

---

## 技术细节

### 工具执行流程
```
用户输入
  ↓
解析任务
  ↓
AI生成工具调用（XML格式）
  ↓
parseToolCallsFromXml()
  ↓
执行工具（switch语句）
  ↓
返回结果
  ↓
继续对话或完成任务
```

### 核心组件
- **AIChatView.executeAgentTask()** - Agent主循环
- **ToolExecutor** - 工具执行器
- **parseToolCallsFromXml()** - XML解析器
- **30个工具函数** - 各种文件操作和项目管理功能

---

## 未来计划

### 短期（优先级高）
- [ ] 集成VS Code终端服务（execute_command）
- [ ] 实现用户问答对话框（ask_followup_question）
- [ ] 集成向量存储（codebase_search）

### 中期（优先级中）
- [ ] 实现Todo列表UI（update_todo_list）
- [ ] 支持批量文件操作（multi_apply_diff）
- [ ] 增强Tree-sitter代码解析（list_code_definition_names）

### 长期（优先级低）
- [ ] 集成浏览器自动化（browser_action）
- [ ] 集成图像生成API（generate_image）
- [ ] 支持Model Context Protocol（MCP工具）

---

## 反馈和贡献

如有问题或建议，请：
1. 查看 `TESTING_GUIDE.md` 进行功能测试
2. 查看 `TOOL_PARAMETERS_GUIDE.md` 了解工具详情
3. 查看 `TOOL_INTEGRATION_SUMMARY.md` 了解整合状态

---

## 版本历史

### v1.0.0 (当前版本)
- ✅ 30个工具全部整合到Agent模式
- ✅ 9个核心文件操作工具完全实现
- ✅ 17个工具框架完成（待实现具体功能）
- ✅ 完整的错误处理和日志记录
- ✅ 支持Chat、Agent、Architect三种模式

---

## 致谢

本项目基于以下开源项目的灵感：
- [Kilocode](https://github.com/cyanheads/kilocode) - 工具系统设计
- [Claude Code](https://github.com/anthropics/claude-code) - Agent模式概念
- [VS Code](https://github.com/microsoft/vscode) - IDE平台

---

**智开 AI - 让AI成为你的编程助手** 🚀
