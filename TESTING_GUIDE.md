# 智开 AI - 工具测试指南

## 快速测试所有30个工具

### 前置条件
1. 确保项目已编译：`npm run compile`
2. 启动VS Code扩展开发模式：按F5
3. 打开一个工作区（项目目录）
4. 打开"智开"AI聊天面板
5. 切换到Agent模式（点击Mode按钮切换到"🤖 Agent"）

---

## 核心工具测试（完全实现）

### 测试1: list_files
**目的**: 列出项目文件结构

**输入**:
```
请列出项目根目录的所有文件和子目录
```

**预期AI行为**:
```xml
<TOOL_USE>
<tool_name>list_files</tool_name>
<path>.</path>
<recursive>true</recursive>
</TOOL_USE>
```

**预期结果**: 显示文件树（📁目录 📄文件）

---

### 测试2: read_file
**目的**: 读取文件内容

**输入**:
```
请读取 package.json 文件的内容
```

**预期AI行为**:
```xml
<TOOL_USE>
<tool_name>read_file</tool_name>
<path>package.json</path>
</TOOL_USE>
```

**预期结果**: 显示package.json的内容（带行号）

---

### 测试3: write_to_file
**目的**: 创建新文件

**输入**:
```
创建一个新文件 test.txt，内容是 "Hello World"
```

**预期AI行为**:
```xml
<TOOL_USE>
<tool_name>write_to_file</tool_name>
<path>test.txt</path>
<content>Hello World</content>
</TOOL_USE>
```

**预期结果**:
- ✅ "Successfully created file: test.txt"
- 文件在编辑器中自动打开
- 文件存在于项目根目录

---

### 测试4: edit_file (搜索替换)
**目的**: 修改现有文件内容

**输入**:
```
把 test.txt 中的 "Hello" 替换为 "Hi"
```

**预期AI行为**:
```xml
<TOOL_USE>
<tool_name>read_file</tool_name>
<path>test.txt</path>
</TOOL_USE>

<TOOL_USE>
<tool_name>edit_file</tool_name>
<path>test.txt</path>
<search>Hello</search>
<replace>Hi</replace>
</TOOL_USE>
```

**预期结果**:
- ✅ "Successfully edited file: test.txt"
- 内容变为 "Hi World"

---

### 测试5: edit_file (全文重写)
**目的**: 重写整个文件

**输入**:
```
把 test.txt 的内容改为：
Line 1
Line 2
Line 3
```

**预期AI行为**:
```xml
<TOOL_USE>
<tool_name>edit_file</tool_name>
<path>test.txt</path>
<search></search>
<replace>Line 1
Line 2
Line 3</replace>
</TOOL_USE>
```

**预期结果**:
- ✅ "Successfully rewrote entire file: test.txt"
- 内容变为3行

---

### 测试6: search_files
**目的**: 在文件中搜索内容

**输入**:
```
搜索项目中所有包含 "import" 的 TypeScript 文件
```

**预期AI行为**:
```xml
<TOOL_USE>
<tool_name>search_files</tool_name>
<path>.</path>
<regex>import</regex>
<file_pattern>*.ts</file_pattern>
</TOOL_USE>
```

**预期结果**: 显示匹配的文件、行号和内容

---

### 测试7: apply_diff
**目的**: 应用SEARCH/REPLACE格式的差异

**输入**:
```
使用 apply_diff 给 test.txt 添加一行 "Line 4"
```

**预期AI行为**:
```xml
<TOOL_USE>
<tool_name>read_file</tool_name>
<path>test.txt</path>
</TOOL_USE>

<TOOL_USE>
<tool_name>apply_diff</tool_name>
<path>test.txt</path>
<diff><<<<<<< SEARCH
Line 1
Line 2
Line 3
=======
Line 1
Line 2
Line 3
Line 4
>>>>>>> REPLACE</diff>
</TOOL_USE>
```

**预期结果**: ✅ "Successfully applied 1 diff block(s)"

---

### 测试8: insert_content
**目的**: 在指定行插入内容

**输入**:
```
在 test.txt 的第2行前面插入 "Line 1.5"
```

**预期AI行为**:
```xml
<TOOL_USE>
<tool_name>insert_content</tool_name>
<path>test.txt</path>
<line>2</line>
<content>Line 1.5</content>
</TOOL_USE>
```

**预期结果**: ✅ "Content inserted at line 2"

---

### 测试9: list_code_definition_names
**目的**: 列出代码定义

**输入**:
```
列出 src/vs/workbench/contrib/aiChat/browser/aiChatView.ts 中的所有类和方法
```

**预期AI行为**:
```xml
<TOOL_USE>
<tool_name>list_code_definition_names</tool_name>
<path>src/vs/workbench/contrib/aiChat/browser/aiChatView.ts</path>
</TOOL_USE>
```

**预期结果**: 显示类名、方法名和行号

---

## 综合测试（多个工具组合）

### 测试10: 创建完整的Java类
**目的**: 测试工具链协作

**输入**:
```
创建一个简单的用户管理功能，包括：
1. UserDTO（id, username, email）
2. UserService（增删改查方法）
```

**预期AI行为**:
```xml
<!-- 步骤1：了解项目结构 -->
<TOOL_USE>
<tool_name>list_files</tool_name>
<path>.</path>
<recursive>true</recursive>
</TOOL_USE>

<!-- 步骤2：创建UserDTO -->
<TOOL_USE>
<tool_name>write_to_file</tool_name>
<path>src/dto/UserDTO.java</path>
<content>package com.example.dto;

import lombok.Data;

@Data
public class UserDTO {
    private Long id;
    private String username;
    private String email;
}</content>
</TOOL_USE>

<!-- 步骤3：创建UserService -->
<TOOL_USE>
<tool_name>write_to_file</tool_name>
<path>src/service/UserService.java</path>
<content>package com.example.service;

import com.example.dto.UserDTO;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class UserService {
    public UserDTO create(UserDTO user) { ... }
    public UserDTO update(UserDTO user) { ... }
    public void delete(Long id) { ... }
    public UserDTO findById(Long id) { ... }
    public List<UserDTO> findAll() { ... }
}</content>
</TOOL_USE>

<!-- 步骤4：完成 -->
<TOOL_USE>
<tool_name>attempt_completion</tool_name>
<result>已创建UserDTO和UserService</result>
</TOOL_USE>
```

**预期结果**:
- ✅ 创建了两个Java文件
- ✅ 文件在编辑器中打开
- ✅ 显示"✅ 任务完成"

---

## 占位符工具测试（框架完成）

这些工具目前返回占位符消息，测试目的是确认它们能被正确调用：

### 测试11: execute_command
**输入**: `执行命令 npm install`

**预期结果**: ⚠️ "Command execution not yet implemented: npm install"

---

### 测试12: ask_followup_question
**输入**: `询问用户他们喜欢哪种数据库`

**预期结果**: ❓ "AI 询问: 您喜欢哪种数据库？"

---

### 测试13: codebase_search
**输入**: `搜索代码库中的用户认证逻辑`

**预期结果**: ⚠️ "Codebase semantic search not yet implemented"

---

### 测试14: browser_action
**输入**: `打开浏览器访问 http://localhost:3000`

**预期结果**: ⚠️ "Browser automation not yet implemented"

---

### 测试15: generate_image
**输入**: `生成一张现代化的Web应用界面图片`

**预期结果**: ⚠️ "Image generation not yet implemented"

---

### 测试16-26: 其他占位符工具
类似地测试其余工具，确认它们都能返回相应的占位符消息。

---

## 错误处理测试

### 测试27: 读取不存在的文件
**输入**: `读取 nonexistent.txt 文件`

**预期结果**: ❌ "Error: File not found: nonexistent.txt"

---

### 测试28: 写入到只读目录
**输入**: `在 /etc 目录创建文件`

**预期结果**: ❌ "Error writing file: ..."

---

### 测试29: 搜索替换失败
**输入**: `替换 test.txt 中的 "NOTEXIST" 为 "NEW"`

**预期结果**: ⚠️ "Warning: Search text not found in test.txt. File unchanged."

---

## 测试检查清单

### 文件操作 (9/9 完成)
- [x] read_file
- [x] write_to_file
- [x] edit_file
- [x] apply_diff
- [x] insert_content
- [x] simple_read_file
- [x] list_files
- [x] search_files
- [x] list_code_definition_names

### 交互工具 (2/2 完成)
- [x] attempt_completion
- [x] ask_followup_question (占位符)

### 占位符工具 (17/17 框架完成)
- [x] execute_command
- [x] codebase_search
- [x] browser_action
- [x] generate_image
- [x] access_mcp_resource
- [x] use_mcp_tool
- [x] fetch_instructions
- [x] new_rule
- [x] new_task
- [x] update_todo_list
- [x] switch_mode
- [x] report_bug
- [x] run_slash_command
- [x] condense
- [x] multi_apply_diff
- [x] (其他2个)

### 错误处理 (3/3)
- [x] 文件不存在错误
- [x] 权限错误
- [x] 搜索未找到警告

---

## 调试技巧

### 1. 查看控制台日志
打开"帮助" > "切换开发人员工具" > "控制台"，查看：
```
[Agent] Executing tool: read_file
[Agent] read_file result: ...
```

### 2. 检查XML解析
确认AI输出的XML格式正确：
```xml
<TOOL_USE>
<tool_name>工具名</tool_name>
<参数名>参数值</参数名>
</TOOL_USE>
```

### 3. 验证文件路径
- 路径必须相对于工作区根目录
- 使用正斜杠 `/`
- 不要使用绝对路径

### 4. 检查工具响应
所有工具执行后都应该显示：
- ✅ 成功消息
- ❌ 错误消息（以"Error:"开头）
- ⚠️ 占位符消息（未实现的工具）

---

## 性能测试

### 测试30: 大文件读取
**目的**: 测试read_file处理大文件的能力

**输入**: `读取一个超过1000行的文件`

**预期**: 正常读取并显示（可能截断显示）

---

### 测试31: 深层目录递归
**目的**: 测试list_files的递归能力

**输入**: `递归列出 src 目录的所有文件`

**预期**:
- 显示最多200个文件
- 超出限制显示截断消息

---

### 测试32: 复杂正则搜索
**目的**: 测试search_files的性能

**输入**: `搜索所有匹配 "function.*async" 的代码`

**预期**: 显示前100个匹配结果

---

## 验收标准

### 必须通过（核心功能）
- ✅ 所有9个核心文件操作工具可用
- ✅ 文件能被正确创建、读取、修改
- ✅ 错误处理正常工作
- ✅ attempt_completion能结束任务循环

### 应该通过（框架完整性）
- ✅ 所有30个工具都能被识别
- ✅ 占位符工具返回适当消息
- ✅ 未知工具显示警告

### 可选通过（高级功能）
- ⏳ 命令执行（需要终端服务）
- ⏳ 用户问答（需要UI）
- ⏳ 语义搜索（需要向量存储）

---

## 已知问题和限制

1. **execute_command**: 需要集成VS Code终端服务
2. **ask_followup_question**: 需要实现用户输入对话框
3. **codebase_search**: 需要集成向量存储和嵌入模型
4. **browser_action**: 需要集成浏览器自动化库
5. **generate_image**: 需要集成图像生成API

这些功能框架已完成，但需要额外的服务依赖才能实现。

---

## 总结

✅ **30/30 工具已整合到Agent模式**
- 9个核心工具完全可用
- 17个工具框架完成
- 4个辅助工具支持运行
- 错误处理完善
- 工具调用流程清晰

Agent模式现已具备完整的代码生成和文件操作能力！
