# Batch工具测试指南

> 如何测试batch工具的优化效果

---

## 🎯 测试目标

验证batch工具优化后的效果：
1. ✅ MAX=25是否生效
2. ✅ 多文件编辑batch是否可用
3. ✅ 性能提升是否达到预期（2-5倍）

---

## 📁 方法1：使用空目录快速测试（推荐）

### 第1步：创建测试目录

```bash
# 创建测试目录
mkdir -p /tmp/batch-test
cd /tmp/batch-test

# 创建测试文件
for i in {1..30}; do
  echo "// File $i
export const value$i = $i;
export function func$i() {
  return value$i * 2;
}" > "file$i.ts"
done

# 创建package.json
echo '{
  "name": "batch-test",
  "version": "1.0.0",
  "description": "Testing batch tool"
}' > package.json

# 确认文件创建成功
ls -la
```

### 第2步：启动IDE并测试

#### 测试场景1：读取多个文件（验证MAX=25）

**打开IDE**：
```bash
cd /tmp/batch-test
code .  # 或使用你的IDE启动命令
```

**在Chat中输入**：
```
请使用batch工具读取file1.ts到file20.ts这20个文件
```

**预期结果**：
- ✅ 1次batch调用成功读取20个文件
- ✅ 不会因为超过10个而拆分成2次
- ✅ 所有文件内容都能显示

**验证命令**（查看日志）：
```bash
# 如果IDE有日志输出，应该看到：
[BatchTool] 开始执行 20 个工具 (丢弃 0 个)
所有 20 个工具执行成功。
```

---

#### 测试场景2：读取25+文件（验证MAX限制）

**在Chat中输入**：
```
请使用batch工具读取file1.ts到file30.ts这30个文件
```

**预期结果**：
- ✅ 前25个文件成功读取
- ✅ 后5个文件报错"Maximum of 25 tools allowed in batch"
- ✅ 日志显示：`开始执行 25 个工具 (丢弃 5 个)`

---

#### 测试场景3：多文件编辑（验证最重要的优化）

**在Chat中输入**：
```
请使用batch工具修改以下文件：
1. file1.ts - 将value1改为100
2. file2.ts - 将value2改为200
3. file3.ts - 将value3改为300
```

**预期结果**：
- ✅ AI会使用batch工具
- ✅ 1次batch调用完成3个文件的修改
- ✅ 使用apply_diff或edit工具（不再被禁止）
- ✅ 所有修改都成功应用

**验证方法**：
```bash
# 检查文件是否修改成功
grep "value1 = 100" file1.ts
grep "value2 = 200" file2.ts
grep "value3 = 300" file3.ts
```

---

#### 测试场景4：组合操作（验证多种工具batch）

**在Chat中输入**：
```
请使用batch工具完成以下操作：
1. 读取package.json
2. 搜索所有包含"export"的ts文件
3. 列出当前目录的所有文件
```

**预期结果**：
- ✅ 1次batch调用完成3种不同类型的操作
- ✅ read_file + search_files + list_files 都成功
- ✅ 所有结果都正确返回

---

### 第3步：性能对比测试

#### 对比测试：读取10个文件

**测试A - 逐个读取**（优化前的行为）：
```
请依次读取file1.ts, file2.ts, ..., file10.ts

不要使用batch工具，分别读取每个文件
```

**测试B - 使用batch**（优化后）：
```
请使用batch工具读取file1.ts到file10.ts
```

**对比指标**：
| 指标 | 测试A（逐个） | 测试B（batch） | 提升 |
|------|--------------|---------------|------|
| API调用次数 | 10次 | 1次 | **10倍** |
| 总耗时 | ~30-50秒 | ~5-8秒 | **5-6倍** |
| 用户等待 | 很长 | 很短 | ⭐⭐⭐⭐⭐ |

---

## 📁 方法2：使用现有项目测试

如果你有现有项目，可以直接测试：

### 测试用例1：探索项目结构

**输入**：
```
请帮我了解这个项目的核心结构：
1. 读取package.json
2. 读取tsconfig.json
3. 读取README.md
4. 列出src目录下的所有文件
5. 搜索src目录中包含"export class"的文件
```

**预期**：AI会用batch工具，1次完成所有操作

### 测试用例2：代码审查

**输入**：
```
请审查以下文件：
src/index.ts
src/types.ts
src/utils.ts
src/config.ts
```

**预期**：AI会用batch工具并行读取4个文件

### 测试用例3：批量重构（最重要）

**输入**：
```
请在以下文件中将所有的 console.log 改为 logger.info：
src/a.ts
src/b.ts
src/c.ts
```

**预期**：
- ✅ AI会用batch工具
- ✅ 3个apply_diff在1次batch中执行
- ✅ 所有修改同时完成

---

## 🔍 如何验证batch工具被正确使用

### 方法1：查看IDE的Developer Tools（最准确）

1. 打开IDE的Developer Tools（F12或Help > Toggle Developer Tools）
2. 切换到Console标签
3. 执行测试操作
4. 查找日志：

```javascript
// 应该看到：
[BatchTool] 开始执行 X 个工具 (丢弃 Y 个)
[BatchTool] Executing tool: read_file
[BatchTool] Executing tool: search_files
所有 X 个工具执行成功。
```

### 方法2：查看Network面板

1. 打开Developer Tools
2. 切换到Network标签
3. 筛选API调用
4. 执行测试操作
5. 验证：

**优化前**（多次API调用）：
```
POST /api/chat - Request 1
POST /api/chat - Request 2
POST /api/chat - Request 3
...
```

**优化后**（1次API调用）：
```
POST /api/chat - Request 1  ← 只有1次！
```

### 方法3：观察AI的工具调用

在Chat界面，AI使用工具时会显示：

**优化后应该看到**：
```xml
<batch>
<tool_calls>[
  {"tool": "read_file", "parameters": {"path": "file1.ts"}},
  {"tool": "read_file", "parameters": {"path": "file2.ts"}},
  {"tool": "read_file", "parameters": {"path": "file3.ts"}}
]</tool_calls>
</batch>
```

**而不是**：
```xml
<read_file><path>file1.ts</path></read_file>
<read_file><path>file2.ts</path></read_file>
<read_file><path>file3.ts</path></read_file>
```

---

## 📊 测试检查清单

### ✅ 基础功能测试

- [ ] batch工具可以正常调用
- [ ] 可以读取多个文件（1-25个）
- [ ] 超过25个会报错并丢弃多余的
- [ ] 部分失败不影响其他工具

### ✅ P0优化验证

- [ ] **MAX=25生效**：可以1次batch读取20个文件
- [ ] **多文件编辑可用**：apply_diff可以在batch中使用
- [ ] **禁止列表正确**：只有3个工具被禁止
  - batch（嵌套）
  - ask_followup_question
  - attempt_completion

### ✅ 性能提升验证

- [ ] 读取10个文件：1次batch vs 10次调用
- [ ] 编辑5个文件：1次batch vs 5次调用
- [ ] 组合操作：1次batch vs 多次调用
- [ ] 实际感受：等待时间明显减少

### ✅ AI行为验证

- [ ] AI主动使用batch（当有2+独立操作时）
- [ ] 提示词有效：AI知道batch能提升性能
- [ ] 不会在禁止的情况下使用batch（如操作有依赖）

---

## 🐛 常见问题排查

### 问题1：AI不使用batch工具

**可能原因**：
- System Prompt未更新
- 模型版本过旧

**解决方法**：
```bash
# 重启IDE
# 清除缓存
# 检查prompts是否正确加载
```

### 问题2：batch工具报错

**常见错误**：
```
工具 'apply_diff' 不允许在 batch 中执行
```

**解决方法**：
- 检查BATCH_CONFIG.DISALLOWED_TOOLS是否正确更新
- 应该只有3个：batch, ask_followup_question, attempt_completion

### 问题3：超过10个文件就失败

**说明**：MAX_PARALLEL_TOOLS没有更新

**解决方法**：
```bash
# 检查代码
grep "MAX_PARALLEL_TOOLS" src/vs/workbench/contrib/maxian/common/tools/batchTool.ts

# 应该显示：
MAX_PARALLEL_TOOLS: 25,
```

---

## 📈 性能测试报告模板

测试完成后，可以填写以下报告：

```markdown
## Batch工具性能测试报告

**测试环境**：
- 项目：[项目名称]
- 文件数：[N个文件]
- 测试日期：[日期]

**测试场景1：读取多个文件**
| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 读取10个文件 | 10次API | 1次API | 10倍 |
| 总耗时 | [X秒] | [Y秒] | [倍数] |

**测试场景2：多文件编辑**
| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 编辑5个文件 | [禁止/5次API] | 1次API | [倍数] |
| 总耗时 | [X秒] | [Y秒] | [倍数] |

**结论**：
- [ ] 性能提升达到预期（2-5倍）
- [ ] AI主动使用batch
- [ ] 用户体验明显改善

**问题**：
- [列出发现的问题]
```

---

## 🎉 快速开始

**最简单的测试（5分钟）**：

```bash
# 1. 创建测试目录
mkdir -p /tmp/batch-test && cd /tmp/batch-test

# 2. 创建10个测试文件
for i in {1..10}; do echo "export const value$i = $i;" > "file$i.ts"; done

# 3. 启动IDE
code .

# 4. 在Chat中输入
"请使用batch工具读取file1.ts到file10.ts，然后将所有的value改为value * 100"

# 5. 观察
- 应该看到1次batch调用
- 包含read_file和apply_diff
- 所有操作同时完成
```

**预期结果**：
- ✅ 1次batch = 10个read + 10个edit = 20个操作
- ✅ 对比优化前：需要20次API调用
- ✅ 性能提升：**20倍**

---

## 📚 参考文档

- `Batch工具对比分析-OpenCode-vs-MaXian.md` - 详细对比
- `Batch工具优化总结报告.md` - 优化成果
- `P0优化进度-Batch工具实现.md` - 进度跟踪

---

**准备好了吗？开始测试吧！** 🚀
