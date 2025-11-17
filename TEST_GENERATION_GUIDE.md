# 🧪 AI自动化测试生成指南

## ✨ Phase 3.6 完成

### 核心改进
- ✅ TestGenerator现在使用AI自动生成测试用例
- ✅ 不再生成空的TODO模板
- ✅ AI失败时自动降级到模板生成
- ✅ 支持批量生成测试文件

---

## 🚀 功能特性

### 1. AI智能测试生成

**TestGenerator** 现在能够：
- 分析源代码结构（函数、类、方法）
- 使用AI生成真实的测试用例
- 包含正常、边界、异常场景
- 生成可运行的测试代码

### 2. 支持的测试框架

| 语言 | 框架 | 文件命名 |
|------|------|---------|
| TypeScript/JavaScript | Jest, Vitest, Mocha | `file.test.ts` |
| Python | Pytest | `test_file.py` |
| Java | JUnit 5 | `FileTest.java` |
| Go | Go Testing | `file_test.go` |
| Rust | Cargo | `file_test.rs` |

### 3. 降级机制

如果AI服务失败，自动使用模板生成：
```
AI生成（首选）→ 失败 → 模板生成（降级）
```

---

## 📝 使用方法

### 方法1：右键菜单生成

1. **在资源管理器中右键点击**
   - 文件：为该文件生成测试
   - 文件夹：为所有源文件批量生成测试

2. **选择 "Generate Tests"**

3. **等待生成完成**
   - AI会分析代码
   - 生成测试文件
   - 显示成功通知

### 方法2：命令面板

1. **打开命令面板**
   - `Cmd+Shift+P` (Mac)
   - `Ctrl+Shift+P` (Windows/Linux)

2. **输入并选择**
   ```
   Generate Tests
   ```

3. **系统会对当前工作区生成测试**

---

## 🎯 生成示例

### 输入：Calculator.java
```java
public class Calculator {
    public int add(int a, int b) {
        return a + b;
    }

    public int subtract(int a, int b) {
        return a - b;
    }

    public double divide(int a, int b) {
        if (b == 0) {
            throw new IllegalArgumentException("Cannot divide by zero");
        }
        return (double) a / b;
    }
}
```

### 输出：CalculatorTest.java (AI生成)
```java
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CalculatorTest {

    @Test
    void testAdd_PositiveNumbers() {
        Calculator calculator = new Calculator();
        assertEquals(5, calculator.add(2, 3));
    }

    @Test
    void testAdd_NegativeNumbers() {
        Calculator calculator = new Calculator();
        assertEquals(-1, calculator.add(-3, 2));
    }

    @Test
    void testSubtract_PositiveResult() {
        Calculator calculator = new Calculator();
        assertEquals(1, calculator.subtract(3, 2));
    }

    @Test
    void testSubtract_NegativeResult() {
        Calculator calculator = new Calculator();
        assertEquals(-1, calculator.subtract(2, 3));
    }

    @Test
    void testDivide_NormalCase() {
        Calculator calculator = new Calculator();
        assertEquals(2.0, calculator.divide(6, 3), 0.001);
    }

    @Test
    void testDivide_WithRemainder() {
        Calculator calculator = new Calculator();
        assertEquals(1.5, calculator.divide(3, 2), 0.001);
    }

    @Test
    void testDivide_ThrowsExceptionWhenDivideByZero() {
        Calculator calculator = new Calculator();
        assertThrows(IllegalArgumentException.class, () -> {
            calculator.divide(5, 0);
        });
    }
}
```

---

## 🔍 技术细节

### AI Prompt策略

TestGenerator使用精心设计的prompt：

```
你是一个专业的单元测试专家。请为以下{language}代码生成完整的{framework}测试文件。

源代码：
```{language}
{sourceCode}
```

要求：
1. 为每个实体生成完整的测试用例
2. 包含以下测试场景：
   - 正常功能测试
   - 边界条件测试
   - 异常情况测试（如果适用）
3. 使用{framework}的标准断言和语法
4. 测试命名要清晰，反映测试意图
5. 生成完整的测试文件，包含：
   - 必要的import/导入语句
   - 完整的测试套件结构
   - 实际的测试实现（不要只写TODO）
6. 【重要】返回完整可运行的测试代码
```

### 代码提取逻辑

AI响应会经过清理：
1. 移除Markdown代码块标记 (```)
2. 移除解释性文字
3. 提取纯代码内容
4. 保持正确的缩进

### 实体识别

系统会识别以下代码实体：
- **TypeScript/JavaScript**: export function, export class, export const
- **Python**: def, class (非私有)
- **Java**: public methods, public class
- **Go**: exported functions (大写开头)
- **Rust**: pub fn

---

## 📊 对比：AI vs 模板

### 使用AI生成（新版）

✅ 真实的测试实现
✅ 多种测试场景（正常、边界、异常）
✅ 清晰的测试命名
✅ 开箱即用

**示例**：
```java
@Test
void testDivide_ThrowsExceptionWhenDivideByZero() {
    Calculator calculator = new Calculator();
    assertThrows(IllegalArgumentException.class, () -> {
        calculator.divide(5, 0);
    });
}
```

### 使用模板（旧版/降级）

⚠️ 只有TODO注释
⚠️ 需要手动填充
⚠️ 基础断言

**示例**：
```java
@Test
void testDivide() {
    // TODO: Add test implementation
    Calculator instance = new Calculator();
    assertNotNull(instance);
}
```

---

## 🛠️ 故障排查

### 问题1：生成的测试包含TODO

**原因**：AI服务失败，使用了模板降级

**检查**：
1. 查看开发者工具 Console
2. 查找 `[Test Generator] AI generation failed`

**解决**：
- 检查AI服务配置
- 检查网络连接
- 查看API额度

### 问题2：无法找到"Generate Tests"命令

**原因**：功能未正确注册

**解决**：
```bash
# 重新编译
npm run compile

# 重启IDE
./scripts/code.sh .
```

### 问题3：生成的测试语法错误

**原因**：AI响应格式异常

**解决**：
- 检查是否有警告日志
- 手动调整生成的代码
- 报告问题以改进prompt

---

## 📈 性能考虑

### 单文件生成
- **时间**: 约5-10秒
- **取决于**: 代码复杂度、AI响应时间

### 批量生成（目录）
- **时间**: 文件数量 × 10秒
- **优化**: 跳过已存在的测试文件

### 最佳实践
1. 先为关键文件生成测试
2. 批量生成时选择特定子目录
3. 生成后检查并优化测试代码

---

## 🎓 进阶用法

### 1. 自定义测试框架检测

编辑项目根目录的 `package.json` (JS/TS) 或 `pom.xml` (Java)：
```json
{
  "devDependencies": {
    "jest": "^29.0.0"  // 会检测到Jest
  }
}
```

### 2. 跳过特定文件

测试生成会自动跳过：
- 已有测试文件 (`*.test.*`, `test_*`)
- `node_modules`, `.git`, `dist`, `build`
- 私有函数/方法（`_` 开头）

### 3. 与单方法测试生成结合

- **TestGenerator**: 批量为整个文件生成测试
- **GenerateTestCommand** (Alt+T): 为单个方法生成测试

可以结合使用：
1. 用TestGenerator快速生成基础测试框架
2. 用Alt+T为特定方法添加详细测试

---

## 📞 需要帮助？

如果遇到问题，请提供：

1. **Console日志**
   - Help → Toggle Developer Tools → Console
   - 查找 `[Test Generator]` 相关日志

2. **源代码示例**
   - 你想生成测试的代码

3. **期望的测试**
   - 你希望生成什么样的测试

4. **实际生成的测试**
   - 截图或复制内容

---

**更新日期**: 2025-11-05
**版本**: Phase 3.6 - AI驱动的测试生成
**状态**: ✅ 已完成

