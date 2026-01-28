#!/bin/bash

# Skills 系统快速测试脚本

echo "======================================"
echo "  Skills 系统快速测试"
echo "======================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SKILLS_DIR="$HOME/.claude/skills"

# 测试1: 检查Skills目录
echo "测试1: 检查Skills目录..."
if [ -d "$SKILLS_DIR" ]; then
    echo -e "${GREEN}✅ Skills目录存在: $SKILLS_DIR${NC}"
else
    echo -e "${RED}❌ Skills目录不存在: $SKILLS_DIR${NC}"
    exit 1
fi
echo ""

# 测试2: 检查所有10个Skills
echo "测试2: 检查官方Skills文件..."
SKILLS=("code-review" "git-workflow" "debugging" "testing" "refactoring" "security" "performance" "documentation" "architecture" "api-design")
FOUND=0

for skill in "${SKILLS[@]}"; do
    if [ -f "$SKILLS_DIR/$skill/SKILL.md" ]; then
        echo -e "${GREEN}✅ $skill${NC}"
        ((FOUND++))
    else
        echo -e "${RED}❌ $skill - SKILL.md缺失${NC}"
    fi
done

echo ""
echo "找到 $FOUND/10 个Skills"
echo ""

# 测试3: 验证Skill文件格式
echo "测试3: 验证Skill文件格式..."
for skill in "${SKILLS[@]}"; do
    SKILL_FILE="$SKILLS_DIR/$skill/SKILL.md"
    if [ -f "$SKILL_FILE" ]; then
        # 检查是否有frontmatter标记
        if grep -q "^---$" "$SKILL_FILE"; then
            # 检查必需字段
            if grep -q "^name:" "$SKILL_FILE" && \
               grep -q "^slug:" "$SKILL_FILE" && \
               grep -q "^description:" "$SKILL_FILE" && \
               grep -q "^category:" "$SKILL_FILE"; then
                echo -e "${GREEN}✅ $skill - 格式正确${NC}"
            else
                echo -e "${RED}❌ $skill - 缺少必需字段${NC}"
            fi
        else
            echo -e "${RED}❌ $skill - 缺少frontmatter${NC}"
        fi
    fi
done
echo ""

# 测试4: 统计Token估算
echo "测试4: Token统计..."
TOTAL_TOKENS=0
for skill in "${SKILLS[@]}"; do
    SKILL_FILE="$SKILLS_DIR/$skill/SKILL.md"
    if [ -f "$SKILL_FILE" ]; then
        TOKENS=$(grep "^estimatedTokens:" "$SKILL_FILE" | sed 's/estimatedTokens: //')
        if [ -n "$TOKENS" ]; then
            echo "  $skill: $TOKENS tokens"
            TOTAL_TOKENS=$((TOTAL_TOKENS + TOKENS))
        fi
    fi
done
echo ""
echo -e "${YELLOW}总计: $TOTAL_TOKENS tokens (如果全部加载)${NC}"
echo -e "${GREEN}Skills目录: ~200 tokens (实际System Prompt)${NC}"
echo -e "${GREEN}节省: ~$((TOTAL_TOKENS - 200)) tokens (${YELLOW}$(( (TOTAL_TOKENS - 200) * 100 / TOTAL_TOKENS ))%${GREEN})${NC}"
echo ""

# 测试5: 检查编译状态
echo "测试5: 检查编译状态..."
if [ -d "out" ]; then
    echo -e "${GREEN}✅ 项目已编译${NC}"
else
    echo -e "${YELLOW}⚠️  项目未编译，请运行: npm run compile${NC}"
fi
echo ""

# 总结
echo "======================================"
echo "  测试总结"
echo "======================================"
if [ $FOUND -eq 10 ]; then
    echo -e "${GREEN}✅ 所有Skills文件完整${NC}"
    echo -e "${GREEN}✅ Skills系统准备就绪！${NC}"
    echo ""
    echo "下一步："
    echo "1. 启动IDE: npm run watch"
    echo "2. 打开右侧边栏 -> 码弦 Agent -> Skills"
    echo "3. 查看Skills列表"
    echo "4. 参考 SKILLS_TESTING_GUIDE.md 进行详细测试"
else
    echo -e "${RED}❌ 发现问题，请检查上述错误${NC}"
fi
echo ""
