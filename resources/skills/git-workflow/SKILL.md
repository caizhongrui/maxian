---
name: Git Workflow
slug: git-workflow
description: Git 工作流程和安全操作规范
category: development
estimatedTokens: 600
version: 1.0.0
author: Official
tags: [git, workflow, version-control, safety]
official: true
createdAt: 2026-01-27
updatedAt: 2026-01-27
---

# Git Workflow Skill

## 概述

Git 安全操作规范和最佳实践，防止数据丢失和冲突。

## Git 安全协议

### 🚨 禁止操作

**永远不要执行以下命令（除非用户明确要求）：**

- `git push --force` / `git push -f` - 强制推送到 main/master
- `git reset --hard` - 硬重置（会丢失未提交的更改）
- `git checkout .` - 丢弃所有未暂存更改
- `git clean -fd` - 删除未跟踪文件
- `git branch -D` - 强制删除分支
- `--no-verify` - 跳过 Git hooks
- `--no-gpg-sign` - 跳过 GPG 签名

### ✅ 安全操作流程

#### 提交前检查

```bash
# 1. 查看状态
git status

# 2. 查看差异
git diff
git diff --staged

# 3. 查看最近提交
git log --oneline -5
```

#### 创建提交

```bash
# 1. 添加特定文件（推荐）
git add path/to/file.ts

# 2. 避免 git add -A（可能包含敏感文件）

# 3. 创建提交（包含 Co-Authored-By）
git commit -m "feat: add user authentication

Implemented JWT-based authentication system.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

#### 分支管理

```bash
# 创建并切换分支
git checkout -b feature/new-feature

# 查看所有分支
git branch -a

# 合并前先更新
git fetch origin
git merge origin/main
```

## 常见场景

### 场景 1: 修改上次提交

```bash
# ❌ 错误：直接 amend
git commit --amend

# ✅ 正确：创建新提交
git add .
git commit -m "fix: correct typo in previous commit"
```

### 场景 2: 撤销修改

```bash
# ❌ 错误：硬重置
git reset --hard

# ✅ 正确：安全撤销
git stash  # 保存更改
git stash pop  # 恢复更改（如需要）
```

### 场景 3: 同步远程

```bash
# 推荐流程
git fetch origin
git rebase origin/main  # 或 git merge origin/main
git push origin feature-branch
```

## 提交消息规范

### 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 类型（Type）

- **feat**: 新功能
- **fix**: Bug 修复
- **docs**: 文档更新
- **style**: 代码格式（不影响功能）
- **refactor**: 重构（不是新功能也不是修复）
- **test**: 添加测试
- **chore**: 构建过程或辅助工具变动

### 示例

```
feat(auth): add JWT authentication

Implemented JWT-based authentication with refresh tokens.

- Added JWT middleware
- Created auth service
- Added unit tests

Closes #123

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

## 冲突解决

```bash
# 1. 拉取最新代码
git fetch origin

# 2. 查看冲突
git status

# 3. 手动解决冲突
# 编辑冲突文件，删除 <<<<<<<, =======, >>>>>>> 标记

# 4. 标记为已解决
git add conflicted-file.ts

# 5. 完成合并
git commit
```

## Pre-commit Hook 失败处理

```bash
# ❌ 错误：跳过 hook
git commit --no-verify

# ✅ 正确：修复问题后重新提交
# 1. 查看错误信息
# 2. 修复代码
# 3. 重新暂存
git add .
# 4. 再次提交
git commit
```

## 最佳实践

1. **频繁提交** - 小步快跑，便于回滚
2. **清晰消息** - 提交消息要描述"为什么"
3. **功能分支** - 为每个功能创建独立分支
4. **定期同步** - 经常从 main 拉取更新
5. **审查差异** - 提交前仔细检查 `git diff`

## 参考资料

- [Conventional Commits](https://www.conventionalcommits.org/)
- [Git Best Practices](https://git-scm.com/book/en/v2)
