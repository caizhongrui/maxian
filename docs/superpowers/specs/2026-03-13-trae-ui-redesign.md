# 码弦 IDE UI 全面改造设计规范
> 参照 Trae IDE 视觉语言，在新分支 `feature/trae-ui-redesign` 上实施

**日期**：2026-03-13
**基础分支**：`feature/agent-architecture-optimization`
**新分支**：`feature/trae-ui-redesign`

---

## 一、背景与目标

当前码弦 IDE 的 UI 各部件配色分散（inline style + `var(--vscode-*)`），没有统一的 Design Token，视觉上与 VS Code 默认主题割裂。对标 Trae（字节跳动 AI IDE）进行全面视觉升级，同时补充关键功能缺口。

**目标**：
- 整体视觉对齐 Trae 的设计语言（深色主题为默认，支持用户切换）
- 聊天面板 UI 达到现代 AI IDE 水准（消息气泡、工具折叠卡片、模式 Tab）
- 补充三个功能：对话历史、文件变更面板、Cmd+K 内联编辑

---

## 二、Design Token 系统

### 2.1 三套主题

| 主题名 | 定位 | 默认 |
|--------|------|------|
| `trae-dark` | 深色，完全对齐 Trae 色值 | ✅ |
| `light` | 浅色，干净白底 | — |
| `trae-blue` | 深色 + 蓝色强调变体 | — |

主题切换入口：聊天面板右上角 ⚙️ 设置图标，弹出浮层选择，立即生效并持久化到 `localStorage`。

### 2.2 CSS 变量定义

```css
/* ===== Trae Dark（默认） ===== */
[data-mx-theme="trae-dark"] {
  --mx-bg-primary:     #181A1F;   /* 主背景：壳子+聊天面板统一 */
  --mx-bg-secondary:   #30343F;   /* 次背景：输入框、激活 Tab、激活卡片 */
  --mx-bg-tertiary:    #24262B;   /* 三级背景：hover、AI 消息卡片 */
  --mx-bg-deepest:     #16181D;   /* 最深背景：代码块、gutter */
  --mx-text-primary:   #FFFFFF;
  --mx-text-secondary: #A9A9A9;
  --mx-text-muted:     #6B7280;
  --mx-border:         #2D3139;
  --mx-accent:         #4C9BE8;   /* 蓝色强调：按钮、激活态、用户气泡 */
  --mx-accent-hover:   #6AAFEF;
  --mx-accent-bg:      rgba(76,155,232,0.15);
  --mx-selection:      #3A3D41;
  --mx-success:        #3FB950;
  --mx-error:          #F85149;
  --mx-warning:        #D29922;
  --mx-scrollbar:      #3A3D41;
  --mx-radius-sm:      6px;
  --mx-radius-md:      8px;
  --mx-radius-lg:      12px;
}

/* ===== Light ===== */
[data-mx-theme="light"] {
  --mx-bg-primary:     #FFFFFF;
  --mx-bg-secondary:   #F5F7FA;
  --mx-bg-tertiary:    #EBEDF0;
  --mx-bg-deepest:     #F0F2F5;
  --mx-text-primary:   #1A1A2E;
  --mx-text-secondary: #6B7280;
  --mx-text-muted:     #9CA3AF;
  --mx-border:         #E4E7ED;
  --mx-accent:         #1677FF;
  --mx-accent-hover:   #4096FF;
  --mx-accent-bg:      #EFF6FF;
  --mx-selection:      #D6E4FF;
  --mx-success:        #22C55E;
  --mx-error:          #EF4444;
  --mx-warning:        #F59E0B;
  --mx-scrollbar:      #D1D5DB;
  --mx-radius-sm:      6px;
  --mx-radius-md:      8px;
  --mx-radius-lg:      12px;
}

/* ===== Trae Blue ===== */
[data-mx-theme="trae-blue"] {
  /* 继承 trae-dark，强调色变为更亮的蓝 */
  --mx-bg-primary:     #0D1117;
  --mx-bg-secondary:   #161B22;
  --mx-bg-tertiary:    #21262D;
  --mx-bg-deepest:     #0A0E14;
  --mx-text-primary:   #E6EDF3;
  --mx-text-secondary: #848D97;
  --mx-text-muted:     #656D76;
  --mx-border:         #30363D;
  --mx-accent:         #58A6FF;
  --mx-accent-hover:   #79C0FF;
  --mx-accent-bg:      rgba(88,166,255,0.12);
  --mx-selection:      #264F78;
  --mx-success:        #3FB950;
  --mx-error:          #F85149;
  --mx-warning:        #D29922;
  --mx-scrollbar:      #30363D;
  --mx-radius-sm:      6px;
  --mx-radius-md:      8px;
  --mx-radius-lg:      12px;
}
```

Token 通过 `maxianView.ts` 中 `renderBody()` 时在根容器上设置 `data-mx-theme` 属性注入。

---

## 三、P1：VS Code 壳子

### 3.1 Activity Bar

| 属性 | 目标值 |
|------|--------|
| 宽度 | 44px（保持） |
| 背景 | `--mx-bg-primary`（与编辑器统一，无边界） |
| 图标颜色（未选中） | `--mx-text-secondary` |
| 图标颜色（选中） | `--mx-text-primary` |
| 激活指示 | 图标背景 `--mx-bg-secondary`，圆角 `--mx-radius-sm` |
| hover | 背景 `--mx-bg-tertiary`，圆角 `--mx-radius-sm` |
| 右侧边框 | 去掉，靠色差自然分隔 |

### 3.2 标题栏

- 背景：`--mx-bg-primary`，与 Activity Bar 同色，视觉上是一整块
- 文字：`--mx-text-secondary`
- 无下边框（色差即边界）

### 3.3 状态栏

- 背景：`--mx-bg-deepest`（比主背景略深，作为视觉底部锚点）
- 文字：`--mx-text-secondary`
- Debug 模式下允许变色（保留现有逻辑）

### 3.4 侧边栏文件树

- 背景：`--mx-bg-primary`
- 选中行：`--mx-bg-secondary`
- hover：`--mx-bg-tertiary`
- 文件名字号：12.5px，行高 22px

### 3.5 Tab 标签栏

- 活动 Tab 背景：`--mx-bg-secondary`；文字：`--mx-text-primary`
- 非活动 Tab 背景：`--mx-bg-primary`；文字：`--mx-text-secondary`
- Tab 间无多余竖线边框

**实现文件**：修改 `activitybarpart.css`、`activityaction.css`、`sidebarpart.css`，以及通过 VS Code workbench color customization JSON 注入主题色覆盖。

---

## 四、P2：聊天面板全改（maxianView.ts）

### 4.1 整体布局

```
┌─────────────────────────────┐
│  顶部操作栏（40px）           │  模式 Tab + 历史 + 设置 + 清空
├─────────────────────────────┤
│                             │
│       消息区域（flex-1）     │  滚动
│                             │
├─────────────────────────────┤
│  文件变更面板（可折叠）        │  仅 agent 执行后出现
├─────────────────────────────┤
│  Todo 列表（可折叠）          │
├─────────────────────────────┤
│  输入区域（auto）             │
└─────────────────────────────┘
```

面板整体背景：`--mx-bg-primary`

### 4.2 顶部操作栏

```
[🏗架构] [💻编码] [💬问答] [🐛调试] [🎯编排] [📋规范]    [🕐] [⚙️] [🗑]
```

- 模式 Tab：水平排列，激活态背景 `--mx-bg-secondary`，圆角 `--mx-radius-sm`
- 非激活：透明背景，`--mx-text-secondary`
- 宽度不足时横向滚动（`overflow-x: auto; white-space: nowrap`）
- 右侧：历史按钮（🕐）、设置按钮（⚙️）、清空按钮（🗑）

### 4.3 欢迎页

- 品牌 logo 60px，圆角 12px
- 标题「码弦」24px 700，副标题 14px muted
- 3 个**可点击快捷问题卡片**（替换现有的通用介绍卡片），点击直接填入输入框
- 最近 3 条对话历史（从 localStorage 读取），点击可恢复

### 4.4 用户消息气泡

- 右对齐（`margin-left: auto`）
- 背景 `--mx-accent`，白色文字，圆角 `--mx-radius-lg`
- 附带的 @文件 chip 显示在气泡内底部，小号字体 + 半透明背景

### 4.5 AI 消息卡片

- 左对齐，背景 `--mx-bg-tertiary`，圆角 `--mx-radius-lg`
- 左上角：16px 品牌小图标
- 内容区：Markdown 渲染（保持现有 MarkdownRendererDom）
- 滚动时头像固定在顶部（sticky，仅流式输出时）

### 4.6 代码块

```
┌─ src/utils.ts ─────────── TypeScript  [复制] [diff] ─┐
│ function parseDate(str: string) {                      │
│   ...（超过20行时折叠）                                 │
│                                          [展开全部 ▼] │
└────────────────────────────────────────────────────────┘
```

- Header：文件名左对齐（从工具结果中提取），语言标签 + 操作按钮右对齐
- 背景 `--mx-bg-deepest`
- 字体：JetBrains Mono / Consolas / monospace，12.5px
- 超过 20 行默认折叠

### 4.7 工具执行折叠卡片

```
▶ ✏️  edit   src/utils.ts          ✅  +12 -3
```

- 默认折叠（一行）
- 点击展开：显示工具输入参数 + 完整输出
- 状态图标：`⏳` 执行中 / `✅` 成功（含 diff 统计）/ `❌` 失败（含错误信息）
- 多工具并行时纵向堆叠，每条独立卡片
- 背景 `--mx-bg-secondary`，圆角 `--mx-radius-md`

### 4.8 Thinking / Reasoning

- 标题「思考过程 ▶」，默认折叠
- 展开内容：斜体 + `--mx-text-muted` 颜色
- 流式输出时自动展开，完成后自动折叠

### 4.9 输入区域

```
┌─────────────────────────────────────────────┐
│ [@ 上下文]  [chip: utils.ts ✕]              │  上方 context 行（有 chip 时显示）
├─────────────────────────────────────────────┤
│                                             │
│  描述你的任务...                              │  contenteditable，min 3 行
│                                             │
├─────────────────────────────────────────────┤
│ [知识库 ▾] [□ 连续对话]       [⏹停止] [发送↵] │  底部操作行
└─────────────────────────────────────────────┘
```

- 整体背景 `--mx-bg-secondary`，圆角 `--mx-radius-lg`，无外边框
- 焦点时：内边框 1px `--mx-accent`
- 发送按钮：`--mx-accent` 背景，圆角，`Cmd+Enter` 触发
- 知识库 / 连续对话：仅 ask 模式显示（保持现有逻辑）

---

## 五、P3：新功能

### 5.1 对话历史

**触发**：顶部操作栏 🕐 按钮，右侧滑入抽屉（宽 280px）

**内容**：
- 顶部搜索框
- 按日期分组（今天 / 昨天 / 更早）
- 每条：首条消息摘要（最多 40 字）+ 时间
- 点击恢复该对话（加载历史消息列表）

**存储**：每次 `clearConversation` 或窗口关闭时，将当前消息序列化后存入 `localStorage`（key: `mx-history-{timestamp}`），最多保留 50 条。

### 5.2 文件变更面板（Session Changes）

**触发**：Agent 执行 edit/write/delete 工具后，聊天面板底部出现（可折叠）

**内容**：

```
▼ 本次变更（3 个文件）                          [全部接受]
  ✏️  src/utils.ts       +12 -3      [查看] [恢复]
  ✏️  src/types.ts        +5  -0     [查看] [恢复]
  🗑️  src/old.ts          deleted    [查看] [恢复]
```

- 「查看」：打开 VS Code diff 编辑器
- 「恢复」：调用 `git checkout` 回滚单文件
- 「全部接受」：清除变更记录（变更已写入磁盘）
- 变更列表从 TaskService 的工具执行记录中收集（edit/write_to_file/delete_file）

### 5.3 Cmd+K 内联编辑

**触发**：编辑器内选中代码后按 `Cmd+K`（macOS）/ `Ctrl+K`（Windows/Linux）

**流程**：
1. 选中区域下方出现浮层输入框（背景 `--mx-bg-secondary`，圆角 `--mx-radius-md`）
2. 用户输入意图，按 Enter 发送
3. 调用当前选中模式的 AI（使用 `code` 模式）
4. AI 返回后在编辑器内渲染 inline diff（绿色新增 / 红色删除行）
5. 两个按钮：`[✅ 接受]` 应用修改 / `[❌ 拒绝]` 恢复原始

**实现**：注册新的 VS Code command `maxian.inlineEdit`，绑定 keybinding，使用 `ITextEditorModel` API 进行 diff 渲染。

---

## 六、P4：细节打磨（P3 完成后）

- **动效**：消息入场（fade-in + slide-up，150ms）；工具卡片展开（100ms ease）
- **暗色主题适配**：验证所有 `--mx-*` 变量在 3 套主题下的可读性
- **弹窗/通知**：统一使用 `--mx-*` 变量，去掉 VS Code 默认蓝色弹窗
- **滚动条**：统一为 `--mx-scrollbar`，宽度 4px

---

## 七、文件改动范围

### P1（壳子主题）
- `src/vs/workbench/browser/parts/activitybar/media/activitybarpart.css`
- `src/vs/workbench/browser/parts/activitybar/media/activityaction.css`
- `src/vs/workbench/browser/parts/sidebar/media/sidebarpart.css`
- `src/vs/workbench/browser/media/part.css`
- 新增：`src/vs/workbench/contrib/maxian/browser/media/themes.css`（Design Token 定义）

### P2（聊天面板）
- `src/vs/workbench/contrib/maxian/browser/maxianView.ts`（主要改动，6400 行）
- `src/vs/workbench/contrib/maxian/browser/uiUtils.ts`（工具卡片、代码块渲染）
- `src/vs/workbench/contrib/maxian/browser/media/maxian.css`（或新增）

### P3（新功能）
- `src/vs/workbench/contrib/maxian/browser/maxianView.ts`（历史面板、变更面板）
- 新增：`src/vs/workbench/contrib/maxian/browser/inlineEdit.ts`（Cmd+K）
- `src/vs/workbench/contrib/maxian/browser/maxian.contribution.ts`（注册 command + keybinding）

---

## 八、分支策略

```bash
git checkout feature/agent-architecture-optimization
git checkout -b feature/trae-ui-redesign
```

各 Phase 在同一分支上顺序提交，每个 Phase 完成后打一个 tag。
