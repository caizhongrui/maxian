# 智开 AI - 工具参数详细说明

本文档详细说明所有30个工具的参数、返回值和使用示例。

## 文件操作工具

### 1. read_file
**功能**: 读取文件内容，支持指定行范围

**参数**:
```typescript
{
  path: string;          // 文件相对路径
  start_line?: string;   // 可选：起始行号（1-based）
  end_line?: string;     // 可选：结束行号（1-based）
}
```

**返回**: 文件内容，带行号

**示例**:
```xml
<TOOL_USE>
<tool_name>read_file</tool_name>
<path>src/User.java</path>
<start_line>10</start_line>
<end_line>20</end_line>
</TOOL_USE>
```

---

### 2. write_to_file
**功能**: 创建新文件

**参数**:
```typescript
{
  path: string;    // 文件相对路径
  content: string; // 文件内容
}
```

**返回**: 成功消息和文件大小

**示例**:
```xml
<TOOL_USE>
<tool_name>write_to_file</tool_name>
<path>src/dto/UserDTO.java</path>
<content>package com.example.dto;

import lombok.Data;

@Data
public class UserDTO {
    private Long id;
    private String username;
}</content>
</TOOL_USE>
```

---

### 3. edit_file
**功能**: 修改文件内容（搜索替换或全文重写）

**参数**:
```typescript
{
  path: string;      // 文件相对路径
  search?: string;   // 要搜索的内容（留空表示重写整个文件）
  replace: string;   // 替换后的内容
}
```

**返回**: 成功消息

**示例 1 - 搜索替换**:
```xml
<TOOL_USE>
<tool_name>edit_file</tool_name>
<path>src/User.java</path>
<search>private String name;</search>
<replace>private String username;</replace>
</TOOL_USE>
```

**示例 2 - 全文重写**:
```xml
<TOOL_USE>
<tool_name>edit_file</tool_name>
<path>src/User.java</path>
<search></search>
<replace>package com.example;

public class User {
    private Long id;
    private String username;
}</replace>
</TOOL_USE>
```

---

### 4. apply_diff
**功能**: 应用 SEARCH/REPLACE 格式的差异

**参数**:
```typescript
{
  path: string;        // 文件相对路径
  diff: string;        // SEARCH/REPLACE格式的差异
  start_line?: number; // 可选：起始行号
}
```

**diff格式**:
```
<<<<<<< SEARCH
old content here
=======
new content here
>>>>>>> REPLACE
```

**示例**:
```xml
<TOOL_USE>
<tool_name>apply_diff</tool_name>
<path>src/User.java</path>
<diff><<<<<<< SEARCH
private String name;
private String email;
=======
private String username;
private String email;
private String phone;
>>>>>>> REPLACE</diff>
</TOOL_USE>
```

---

### 5. insert_content
**功能**: 在文件的指定行插入内容

**参数**:
```typescript
{
  path: string;    // 文件相对路径
  line: number;    // 插入的行号（1-based，0表示追加到末尾）
  content: string; // 要插入的内容
}
```

**返回**: 成功消息

**示例**:
```xml
<TOOL_USE>
<tool_name>insert_content</tool_name>
<path>src/User.java</path>
<line>5</line>
<content>    private String phone;</content>
</TOOL_USE>
```

---

### 6. simple_read_file
**功能**: 简单读取文件（不带行号）

**参数**:
```typescript
{
  path: string; // 文件相对路径
}
```

**返回**: 纯文本内容

**示例**:
```xml
<TOOL_USE>
<tool_name>simple_read_file</tool_name>
<path>package.json</path>
</TOOL_USE>
```

---

## 文件浏览工具

### 7. list_files
**功能**: 列出目录中的文件和子目录

**参数**:
```typescript
{
  path: string;        // 目录相对路径（"."表示根目录）
  recursive?: string;  // "true"表示递归列出子目录
}
```

**返回**: 文件和目录列表（📁目录 📄文件）

**示例**:
```xml
<TOOL_USE>
<tool_name>list_files</tool_name>
<path>src</path>
<recursive>true</recursive>
</TOOL_USE>
```

---

### 8. search_files
**功能**: 在文件中搜索匹配的内容

**参数**:
```typescript
{
  path: string;          // 搜索的目录路径
  regex: string;         // 搜索的正则表达式
  file_pattern?: string; // 可选：文件名匹配模式（如 "*.java"）
}
```

**返回**: 匹配的文件、行号和内容

**示例**:
```xml
<TOOL_USE>
<tool_name>search_files</tool_name>
<path>src</path>
<regex>class\s+\w+DTO</regex>
<file_pattern>*.java</file_pattern>
</TOOL_USE>
```

---

### 9. list_code_definition_names
**功能**: 列出源文件中的代码定义（函数、类、接口等）

**参数**:
```typescript
{
  path: string; // 文件相对路径
}
```

**返回**: 代码定义列表（名称、类型、行号）

**示例**:
```xml
<TOOL_USE>
<tool_name>list_code_definition_names</tool_name>
<path>src/service/UserService.java</path>
</TOOL_USE>
```

---

### 10. codebase_search
**功能**: 语义搜索代码库（需要向量存储）

**参数**:
```typescript
{
  query: string;  // 搜索查询
  path?: string;  // 可选：限制搜索路径
}
```

**返回**: 相关代码片段（当前为占位符）

**示例**:
```xml
<TOOL_USE>
<tool_name>codebase_search</tool_name>
<query>用户认证逻辑</query>
<path>src</path>
</TOOL_USE>
```

---

## 命令执行工具

### 11. execute_command
**功能**: 在终端中执行命令

**参数**:
```typescript
{
  command: string; // 要执行的命令
  cwd?: string;    // 可选：工作目录
}
```

**返回**: 命令输出（当前为占位符）

**示例**:
```xml
<TOOL_USE>
<tool_name>execute_command</tool_name>
<command>npm install</command>
<cwd>frontend</cwd>
</TOOL_USE>
```

---

## 交互工具

### 12. attempt_completion
**功能**: 标记任务完成

**参数**:
```typescript
{
  result: string; // 任务完成的总结
}
```

**返回**: 任务完成消息

**示例**:
```xml
<TOOL_USE>
<tool_name>attempt_completion</tool_name>
<result>已成功创建 UserDTO、UserService、UserController 和 UserMapper。用户管理功能的后端 CRUD API 已完成。</result>
</TOOL_USE>
```

---

### 13. ask_followup_question
**功能**: 向用户询问问题

**参数**:
```typescript
{
  question: string; // 要询问的问题
}
```

**返回**: 用户回答（当前为占位符）

**示例**:
```xml
<TOOL_USE>
<tool_name>ask_followup_question</tool_name>
<question>您希望使用哪个数据库？MySQL 还是 PostgreSQL？</question>
</TOOL_USE>
```

---

## 浏览器自动化工具

### 14. browser_action
**功能**: 控制浏览器操作

**参数**:
```typescript
{
  action: 'launch' | 'click' | 'hover' | 'type' | 'scroll_down' | 'scroll_up' | 'resize' | 'close';
  url?: string;        // launch时需要
  coordinate?: string; // click/hover时需要 "x,y"
  text?: string;       // type时需要
  size?: string;       // resize时需要 "width,height"
}
```

**返回**: 操作结果（当前为占位符）

**示例**:
```xml
<TOOL_USE>
<tool_name>browser_action</tool_name>
<action>launch</action>
<url>http://localhost:3000</url>
</TOOL_USE>
```

---

## MCP工具

### 15. access_mcp_resource
**功能**: 访问MCP资源

**参数**: 待定（依赖MCP协议）

**返回**: MCP资源内容（当前为占位符）

---

### 16. use_mcp_tool
**功能**: 使用MCP工具

**参数**: 待定（依赖MCP协议）

**返回**: 工具执行结果（当前为占位符）

---

## 图像生成工具

### 17. generate_image
**功能**: 生成AI图像

**参数**:
```typescript
{
  prompt: string; // 图像描述提示词
}
```

**返回**: 图像URL或Base64（当前为占位符）

**示例**:
```xml
<TOOL_USE>
<tool_name>generate_image</tool_name>
<prompt>A modern web application dashboard with clean UI design</prompt>
</TOOL_USE>
```

---

## 指令和规则工具

### 18. fetch_instructions
**功能**: 获取项目指令

**参数**: 待定

**返回**: 项目指令内容（当前为占位符）

---

### 19. new_rule
**功能**: 创建新的代码规则

**参数**: 待定

**返回**: 规则创建结果（当前为占位符）

---

## 任务管理工具

### 20. new_task
**功能**: 创建新任务

**参数**:
```typescript
{
  task: string; // 任务描述
}
```

**返回**: 任务创建结果（当前为占位符）

**示例**:
```xml
<TOOL_USE>
<tool_name>new_task</tool_name>
<task>实现用户登录功能</task>
</TOOL_USE>
```

---

### 21. update_todo_list
**功能**: 更新待办事项列表

**参数**:
```typescript
{
  todos: Array<{
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}
```

**返回**: 更新结果（当前为占位符）

**示例**:
```xml
<TOOL_USE>
<tool_name>update_todo_list</tool_name>
<todos>[
  {"id": "1", "content": "创建DTO", "status": "completed"},
  {"id": "2", "content": "创建Service", "status": "in_progress"}
]</todos>
</TOOL_USE>
```

---

### 22. switch_mode
**功能**: 切换AI模式

**参数**:
```typescript
{
  mode: 'chat' | 'agent' | 'architect'; // 目标模式
}
```

**返回**: 模式切换结果（当前为占位符）

**示例**:
```xml
<TOOL_USE>
<tool_name>switch_mode</tool_name>
<mode>architect</mode>
</TOOL_USE>
```

---

## Bug报告工具

### 23. report_bug
**功能**: 报告Bug

**参数**:
```typescript
{
  description: string; // Bug描述
}
```

**返回**: Bug报告结果（当前为占位符）

**示例**:
```xml
<TOOL_USE>
<tool_name>report_bug</tool_name>
<description>在创建文件时遇到权限错误</description>
</TOOL_USE>
```

---

## 斜杠命令工具

### 24. run_slash_command
**功能**: 运行斜杠命令

**参数**:
```typescript
{
  command: string; // 斜杠命令（如 "/review"）
}
```

**返回**: 命令执行结果（当前为占位符）

**示例**:
```xml
<TOOL_USE>
<tool_name>run_slash_command</tool_name>
<command>/review</command>
</TOOL_USE>
```

---

## 高级工具

### 25. condense
**功能**: 压缩对话历史

**参数**: 待定

**返回**: 压缩后的对话（当前为占位符）

---

### 26. multi_apply_diff
**功能**: 批量应用多文件差异

**参数**:
```typescript
{
  file: Array<{
    path: string;
    diff: Array<{
      content: string;
      startLine?: number;
    }>;
  }>;
}
```

**返回**: 批量操作结果（当前为占位符）

---

## 工具使用最佳实践

### 1. 文件操作顺序
```
list_files（了解项目结构）
  ↓
read_file（读取现有代码）
  ↓
write_to_file 或 edit_file（创建/修改代码）
  ↓
attempt_completion（完成任务）
```

### 2. 错误处理
- 所有工具都会返回错误消息（以"Error:"开头）
- AI应该根据错误消息调整策略
- 常见错误：文件不存在、权限不足、参数错误

### 3. 路径规范
- 所有路径都是相对于工作区根目录的相对路径
- 使用正斜杠 `/` 而不是反斜杠 `\`
- 不要使用 `..` 返回上级目录

### 4. 内容格式
- 文件内容应该保持正确的缩进
- 代码应该遵循项目的编码风格
- 使用适当的换行符

---

## 工具组合示例

### 示例：创建完整的用户管理功能

```xml
<!-- 步骤1：了解项目结构 -->
<TOOL_USE>
<tool_name>list_files</tool_name>
<path>src/main/java</path>
<recursive>true</recursive>
</TOOL_USE>

<!-- 步骤2：阅读现有代码风格 -->
<TOOL_USE>
<tool_name>read_file</tool_name>
<path>src/main/java/com/example/dto/ProductDTO.java</path>
</TOOL_USE>

<!-- 步骤3：创建UserDTO -->
<TOOL_USE>
<tool_name>write_to_file</tool_name>
<path>src/main/java/com/example/dto/UserDTO.java</path>
<content>package com.example.dto;

import lombok.Data;

@Data
public class UserDTO {
    private Long id;
    private String username;
    private String email;
}</content>
</TOOL_USE>

<!-- 步骤4：创建UserService -->
<TOOL_USE>
<tool_name>write_to_file</tool_name>
<path>src/main/java/com/example/service/UserService.java</path>
<content>package com.example.service;

import com.example.dto.UserDTO;
import org.springframework.stereotype.Service;

@Service
public class UserService {
    // Service implementation
}</content>
</TOOL_USE>

<!-- 步骤5：完成任务 -->
<TOOL_USE>
<tool_name>attempt_completion</tool_name>
<result>已创建UserDTO和UserService，用户管理功能的基本结构已完成</result>
</TOOL_USE>
```

---

## 总结

- ✅ 30个工具全部整合完成
- ✅ 9个核心工具完全可用
- ✅ 17个工具框架完成，待实现
- ✅ 4个辅助工具支持运行

所有工具都遵循统一的XML格式调用规范，便于AI理解和使用。
