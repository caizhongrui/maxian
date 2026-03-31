# Trae UI 全面改造 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 参照 Trae IDE 视觉语言，对码弦 IDE 进行全面 UI 改造，支持 3 套主题切换，重设计聊天面板，新增对话历史、文件变更面板、Cmd+K 内联编辑。

**Architecture:** 以 CSS Design Token（`--mx-*` 变量）为基础，通过 `data-mx-theme` 属性切换 3 套主题；VS Code 壳子通过 CSS override 对齐 Trae 配色；聊天面板（maxianView.ts）重构消息布局、工具卡片、模式 Tab；新功能作为独立模块注册到 contribution。

**Tech Stack:** TypeScript、VS Code 内部 DOM API（`$/append`）、CSS Variables、localStorage 持久化、VS Code IKeybindingService（Cmd+K）

**分支：** 从 `feature/agent-architecture-optimization` 创建 `feature/trae-ui-redesign`

**Spec 文档：** `docs/superpowers/specs/2026-03-13-trae-ui-redesign.md`

---

## 文件改动总览

| 文件 | 操作 | Phase |
|------|------|-------|
| `src/vs/workbench/contrib/maxian/browser/media/themes.css` | 新建 | P1 |
| `src/vs/workbench/browser/parts/activitybar/media/activitybarpart.css` | 修改 | P1 |
| `src/vs/workbench/browser/parts/activitybar/media/activityaction.css` | 修改 | P1 |
| `src/vs/workbench/browser/parts/sidebar/media/sidebarpart.css` | 修改 | P1 |
| `src/vs/workbench/browser/media/part.css` | 修改 | P1 |
| `src/vs/workbench/contrib/maxian/browser/maxianView.ts` | 大量修改 | P2+P3 |
| `src/vs/workbench/contrib/maxian/browser/uiUtils.ts` | 修改 | P2 |
| `src/vs/workbench/contrib/maxian/browser/media/maxian.css` | 新建/修改 | P2 |
| `src/vs/workbench/contrib/maxian/browser/inlineEdit.ts` | 新建 | P3 |
| `src/vs/workbench/contrib/maxian/browser/maxian.contribution.ts` | 修改 | P3 |

---

## Chunk 1：分支创建 + Design Token 系统

### Task 1：创建新分支

**Files:**
- 无代码文件

- [ ] **Step 1：确认当前在 feature/agent-architecture-optimization 分支**

```bash
cd /Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/tianhe-zhikai-ide
git branch --show-current
```
期望输出：`feature/agent-architecture-optimization`

- [ ] **Step 2：创建并切换到新分支**

```bash
git checkout -b feature/trae-ui-redesign
```

- [ ] **Step 3：确认分支创建成功**

```bash
git branch --show-current
```
期望输出：`feature/trae-ui-redesign`

---

### Task 2：创建 Design Token CSS 文件

**Files:**
- 新建：`src/vs/workbench/contrib/maxian/browser/media/themes.css`

- [ ] **Step 1：创建 themes.css，定义 3 套主题的全部 CSS 变量**

```css
/* ============================================================
 * 码弦 IDE - Design Token 系统
 * 通过 data-mx-theme 属性切换：trae-dark / light / trae-blue
 * ============================================================ */

/* ===== 默认（未设置 data-mx-theme 时） ===== */
:root,
[data-mx-theme="trae-dark"] {
  --mx-bg-primary:     #181A1F;
  --mx-bg-secondary:   #30343F;
  --mx-bg-tertiary:    #24262B;
  --mx-bg-deepest:     #16181D;
  --mx-text-primary:   #FFFFFF;
  --mx-text-secondary: #A9A9A9;
  --mx-text-muted:     #6B7280;
  --mx-border:         #2D3139;
  --mx-accent:         #4C9BE8;
  --mx-accent-hover:   #6AAFEF;
  --mx-accent-bg:      rgba(76, 155, 232, 0.15);
  --mx-selection:      #3A3D41;
  --mx-success:        #3FB950;
  --mx-error:          #F85149;
  --mx-warning:        #D29922;
  --mx-scrollbar:      #3A3D41;
  --mx-radius-sm:      6px;
  --mx-radius-md:      8px;
  --mx-radius-lg:      12px;
  --mx-font-mono:      'JetBrains Mono', 'Consolas', 'Monaco', monospace;
}

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
  --mx-font-mono:      'JetBrains Mono', 'Consolas', 'Monaco', monospace;
}

[data-mx-theme="trae-blue"] {
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
  --mx-accent-bg:      rgba(88, 166, 255, 0.12);
  --mx-selection:      #264F78;
  --mx-success:        #3FB950;
  --mx-error:          #F85149;
  --mx-warning:        #D29922;
  --mx-scrollbar:      #30363D;
  --mx-radius-sm:      6px;
  --mx-radius-md:      8px;
  --mx-radius-lg:      12px;
  --mx-font-mono:      'JetBrains Mono', 'Consolas', 'Monaco', monospace;
}
```

- [ ] **Step 2：在 maxianView.ts 的 renderBody() / 构造函数中引入 themes.css**

在 `maxianView.ts` 顶部的 import 段找到现有 CSS import（或通过 contribution 加载），添加 themes.css 的引用。具体方式：在 `maxian.contribution.ts` 中通过 `registerCSSUrl` 或在 `maxianView.ts` 的 `renderBody` 中动态插入 `<link>` 标签。

也可以在 `maxianView.ts` 的 `renderBody()` 里：
```typescript
// 注入主题 CSS（如果未注入）
if (!document.getElementById('mx-themes-css')) {
  const link = document.createElement('link');
  link.id = 'mx-themes-css';
  link.rel = 'stylesheet';
  link.href = FileAccess.asBrowserUri(
    'vs/workbench/contrib/maxian/browser/media/themes.css'
  ).toString(true);
  document.head.appendChild(link);
}
```

- [ ] **Step 3：在聊天面板根容器上设置默认主题属性**

在 `maxianView.ts` 的 `renderBody()` 中，找到创建 `this.container` 的地方，加一行：
```typescript
// 从 localStorage 读取主题，默认 trae-dark
const savedTheme = localStorage.getItem('mx-theme') || 'trae-dark';
this.container.setAttribute('data-mx-theme', savedTheme);
```

- [ ] **Step 4：TypeScript 编译检查**

```bash
cd /Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/tianhe-zhikai-ide
npx tsc -p src/tsconfig.json --noEmit 2>&1 | tail -20
```
期望：0 errors（除已知第三方库问题）

- [ ] **Step 5：提交**

```bash
git add src/vs/workbench/contrib/maxian/browser/media/themes.css \
        src/vs/workbench/contrib/maxian/browser/maxianView.ts
git commit -m "feat(theme): 添加 Design Token CSS 系统，支持 3 套主题变量"
```

---

## Chunk 2：VS Code 壳子主题（P1）

### Task 3：Activity Bar 视觉对齐 Trae

**Files:**
- 修改：`src/vs/workbench/browser/parts/activitybar/media/activitybarpart.css`
- 修改：`src/vs/workbench/browser/parts/activitybar/media/activityaction.css`

- [ ] **Step 1：修改 activitybarpart.css——背景使用 Design Token**

找到 `.monaco-workbench .part.activitybar` 规则，将背景色改为引用 `--mx-bg-primary`（同时保留 VS Code 原生变量作为 fallback）：

```css
.monaco-workbench .part.activitybar {
  width: 44px;
  height: 100%;
  background-color: var(--mx-bg-primary, var(--vscode-activityBar-background));
  border-right: none !important;
}
```

- [ ] **Step 2：修改 activityaction.css——图标颜色、激活态背景、hover 背景**

找到以下规则并修改：

**图标颜色（未激活）：**
在 `.action-label.codicon` 规则中设置颜色：
```css
.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-label.codicon {
  font-size: 22px;
  align-items: center;
  justify-content: center;
  color: var(--mx-text-secondary, var(--vscode-activityBar-inactiveForeground));
  transition: color 0.15s, background-color 0.15s;
}
```

**Hover 态——圆角背景块（替换原来的颜色变化）：**
```css
.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item:hover .action-label.codicon {
  color: var(--mx-text-primary, var(--vscode-activityBar-foreground)) !important;
  background-color: var(--mx-bg-tertiary, rgba(90,93,94,0.2));
  border-radius: var(--mx-radius-sm, 6px);
}
```

**Active/Checked 态——圆角背景块（替换原来的 border-left 线）：**
找到 `.active-item-indicator:before` 规则，将 `border-left: 2px solid` 改为让圆角背景承担激活指示：
```css
.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.active .action-label.codicon,
.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.checked .action-label.codicon {
  color: var(--mx-text-primary, var(--vscode-activityBar-foreground)) !important;
  background-color: var(--mx-bg-secondary, rgba(90,93,94,0.31));
  border-radius: var(--mx-radius-sm, 6px);
}
```

将原 `active-item-indicator::before` 的 `border-left` 改为透明（视觉由背景色承担）：
```css
.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item.checked .active-item-indicator:before,
.monaco-workbench .activitybar > .content :not(.monaco-menu) > .monaco-action-bar .action-item:focus .active-item-indicator:before {
  content: "";
  position: absolute;
  z-index: 1;
  top: 0;
  height: 100%;
  width: 0;
  border-left: none; /* 改为无，激活态由背景色体现 */
}
```

- [ ] **Step 3：启动 IDE 验证 Activity Bar 外观**

```bash
./scripts/code.sh
```
检查：Activity Bar 背景是否与编辑器统一，hover/active 是否显示圆角背景块。

- [ ] **Step 4：提交**

```bash
git add src/vs/workbench/browser/parts/activitybar/media/activitybarpart.css \
        src/vs/workbench/browser/parts/activitybar/media/activityaction.css
git commit -m "feat(shell): Activity Bar 背景与激活态对齐 Trae 风格"
```

---

### Task 4：标题栏、状态栏、Tab 栏、侧边栏

**Files:**
- 修改：`src/vs/workbench/browser/parts/sidebar/media/sidebarpart.css`
- 修改：`src/vs/workbench/browser/media/part.css`

- [ ] **Step 1：标题栏背景改为 --mx-bg-primary**

在现有 VS Code 工作区颜色配置中，找到标题栏相关规则（`titleBar.activeBackground` 等）。
由于 VS Code 标题栏颜色由主题 JSON 控制，需要在 `maxianView.ts` 的初始化时通过 `IWorkbenchThemeService` 或在 `product.json` 中注入颜色覆盖。

**临时方案**：在 themes.css 中加全局 CSS 变量映射：
```css
/* 将 mx token 映射给 VS Code 原生变量（在支持的地方生效） */
[data-mx-theme] {
  --vscode-titleBar-activeBackground: var(--mx-bg-primary);
  --vscode-titleBar-activeForeground: var(--mx-text-secondary);
  --vscode-titleBar-inactiveBackground: var(--mx-bg-primary);
  --vscode-statusBar-background: var(--mx-bg-deepest);
  --vscode-statusBar-foreground: var(--mx-text-secondary);
  --vscode-editor-background: var(--mx-bg-primary);
  --vscode-sideBar-background: var(--mx-bg-primary);
  --vscode-activityBar-background: var(--mx-bg-primary);
  --vscode-tab-activeBackground: var(--mx-bg-secondary);
  --vscode-tab-inactiveBackground: var(--mx-bg-primary);
  --vscode-tab-activeForeground: var(--mx-text-primary);
  --vscode-tab-inactiveForeground: var(--mx-text-secondary);
}
```
注意：VS Code 的 CSS 变量是由 ThemeService 注入的，直接覆盖需要在 `:root` 作用域下且在 ThemeService 注入之后。将上述规则加在 `[data-mx-theme]` 下，套在聊天面板容器内部（即仅影响 AuxiliaryBar 范围）。

**对于全局壳子（编辑器背景、Tab 栏等），最干净的方式是：** 在 `maxian.contribution.ts` 中注册一个 ThemeService 回调，在 IDE 启动后更新颜色 token。但这较复杂，可以先做 CSS 覆盖，后续迭代。

- [ ] **Step 2：侧边栏标题去大写，加适当字重**

`sidebarpart.css` 中已改过，确认：
```css
.monaco-workbench .part.sidebar > .title > .title-label h2 {
  text-transform: none;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  opacity: 0.85;
  color: var(--mx-text-secondary, var(--vscode-sideBarTitle-foreground));
}
```

- [ ] **Step 3：启动验证**

```bash
./scripts/code.sh
```
检查：标题栏、状态栏、侧边栏背景是否统一。

- [ ] **Step 4：提交**

```bash
git add src/vs/workbench/browser/parts/sidebar/media/sidebarpart.css \
        src/vs/workbench/browser/media/part.css \
        src/vs/workbench/contrib/maxian/browser/media/themes.css
git commit -m "feat(shell): 标题栏/状态栏/侧边栏颜色对齐 Trae Design Token"
```

---

## Chunk 3：聊天面板 - 顶部 Tab 和欢迎页（P2 前半）

### Task 5：模式下拉框改为横排 Pill Tab

**Files:**
- 修改：`src/vs/workbench/contrib/maxian/browser/maxianView.ts`

- [ ] **Step 1：在 maxianView.ts 中找到现有模式 Selector 的创建代码**

搜索关键词 `modeSelector` 或 `createModeSelector`，定位现有的下拉框实现（大约在 `renderBody` 或 `createInputArea` 中）。记录起止行号。

- [ ] **Step 2：新建 createModeTabBar() 方法，替换下拉框**

在 maxianView.ts 中新增方法（放在 createInputArea 附近）：

```typescript
private createModeTabBar(parent: HTMLElement): void {
  const tabBar = append(parent, $('div.mx-mode-tabs'));
  tabBar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 6px;
    background: var(--mx-bg-primary);
    border-bottom: 1px solid var(--mx-border);
    overflow-x: auto;
    white-space: nowrap;
    flex-shrink: 0;
  `;
  // 隐藏横向滚动条
  tabBar.style.scrollbarWidth = 'none';

  const modeIcons: Record<string, string> = {
    architect: '🏗',
    code: '💻',
    ask: '💬',
    debug: '🐛',
    orchestrator: '🎯',
    spec: '📋',
  };

  getAllModes().forEach(mode => {
    const tab = append(tabBar, $('div.mx-mode-tab'));
    tab.dataset.mode = mode.slug;
    tab.style.cssText = `
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: var(--mx-radius-sm);
      font-size: 12px;
      cursor: pointer;
      color: var(--mx-text-secondary);
      transition: background 0.15s, color 0.15s;
      user-select: none;
    `;

    const icon = append(tab, $('span'));
    icon.textContent = modeIcons[mode.slug] || '●';
    icon.style.fontSize = '13px';

    const label = append(tab, $('span'));
    label.textContent = mode.name;

    tab.addEventListener('click', () => this.switchMode(mode.slug as Mode));
    tab.addEventListener('mouseenter', () => {
      if (tab.dataset.mode !== this.currentMode) {
        tab.style.background = 'var(--mx-bg-tertiary)';
        tab.style.color = 'var(--mx-text-primary)';
      }
    });
    tab.addEventListener('mouseleave', () => {
      if (tab.dataset.mode !== this.currentMode) {
        tab.style.background = '';
        tab.style.color = 'var(--mx-text-secondary)';
      }
    });
  });

  // 右侧操作按钮区
  const spacer = append(tabBar, $('div'));
  spacer.style.cssText = 'flex: 1; min-width: 8px;';

  this.createTopBarActions(tabBar);

  this.modeTabBar = tabBar;
  this.updateModeTabActive();
}

private updateModeTabActive(): void {
  if (!this.modeTabBar) return;
  this.modeTabBar.querySelectorAll('.mx-mode-tab').forEach((tab: Element) => {
    const el = tab as HTMLElement;
    const isActive = el.dataset.mode === this.currentMode;
    el.style.background = isActive ? 'var(--mx-bg-secondary)' : '';
    el.style.color = isActive ? 'var(--mx-text-primary)' : 'var(--mx-text-secondary)';
    el.style.fontWeight = isActive ? '600' : '400';
  });
}
```

- [ ] **Step 3：添加 modeTabBar 私有字段**

在类顶部私有字段区新增：
```typescript
private modeTabBar: HTMLElement | null = null;
```

- [ ] **Step 4：修改 switchMode 方法，切换后调用 updateModeTabActive**

找到现有的 `switchMode` 或模式切换逻辑，在模式更新后追加：
```typescript
this.updateModeTabActive();
```

- [ ] **Step 5：在 renderBody 中，将原来的 modeSelector 下拉框替换为 createModeTabBar 调用**

找到 `this.modeSelector` 相关的 `append` 调用，将其从 inputContainer 移到聊天面板顶部。在 `renderBody` 中：
```typescript
// 顶部 Tab Bar（在 messageArea 之前）
this.createModeTabBar(this.container);
```
同时注释或移除原有 `createModeSelector` 的调用及相关下拉框 DOM 创建代码。

- [ ] **Step 6：TypeScript 编译检查**

```bash
npx tsc -p src/tsconfig.json --noEmit 2>&1 | tail -20
```

- [ ] **Step 7：启动验证，检查模式 Tab 显示和切换**

```bash
./scripts/code.sh
```
检查：6 个模式 Tab 是否显示，点击是否切换，激活态高亮是否正确。

- [ ] **Step 8：提交**

```bash
git add src/vs/workbench/contrib/maxian/browser/maxianView.ts
git commit -m "feat(chat): 模式选择从下拉框改为横排 Pill Tab"
```

---

### Task 6：顶部操作按钮（历史、设置/主题、清空）

**Files:**
- 修改：`src/vs/workbench/contrib/maxian/browser/maxianView.ts`

- [ ] **Step 1：新增 createTopBarActions 方法**

```typescript
private createTopBarActions(parent: HTMLElement): void {
  const btnStyle = `
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--mx-radius-sm);
    border: none;
    background: transparent;
    color: var(--mx-text-secondary);
    cursor: pointer;
    font-size: 15px;
    transition: background 0.15s, color 0.15s;
  `;

  // 历史按钮
  const historyBtn = append(parent, $('button.mx-btn-history')) as HTMLButtonElement;
  historyBtn.title = '对话历史';
  historyBtn.textContent = '🕐';
  historyBtn.style.cssText = btnStyle;
  historyBtn.addEventListener('click', () => this.toggleHistoryPanel());
  historyBtn.addEventListener('mouseenter', () => {
    historyBtn.style.background = 'var(--mx-bg-tertiary)';
    historyBtn.style.color = 'var(--mx-text-primary)';
  });
  historyBtn.addEventListener('mouseleave', () => {
    historyBtn.style.background = '';
    historyBtn.style.color = 'var(--mx-text-secondary)';
  });

  // 主题切换按钮
  const themeBtn = append(parent, $('button.mx-btn-theme')) as HTMLButtonElement;
  themeBtn.title = '切换主题';
  themeBtn.textContent = '⚙️';
  themeBtn.style.cssText = btnStyle;
  themeBtn.addEventListener('click', (e) => this.showThemePicker(e));
  themeBtn.addEventListener('mouseenter', () => {
    themeBtn.style.background = 'var(--mx-bg-tertiary)';
    themeBtn.style.color = 'var(--mx-text-primary)';
  });
  themeBtn.addEventListener('mouseleave', () => {
    themeBtn.style.background = '';
    themeBtn.style.color = 'var(--mx-text-secondary)';
  });

  // 清空按钮
  const clearBtn = append(parent, $('button.mx-btn-clear')) as HTMLButtonElement;
  clearBtn.title = '清空对话';
  clearBtn.textContent = '🗑';
  clearBtn.style.cssText = btnStyle;
  clearBtn.addEventListener('click', () => this.maxianService.clearConversation());
  clearBtn.addEventListener('mouseenter', () => {
    clearBtn.style.background = 'var(--mx-bg-tertiary)';
    clearBtn.style.color = 'var(--mx-accent)';
  });
  clearBtn.addEventListener('mouseleave', () => {
    clearBtn.style.background = '';
    clearBtn.style.color = 'var(--mx-text-secondary)';
  });
}
```

- [ ] **Step 2：新增主题切换浮层 showThemePicker 方法**

```typescript
private showThemePicker(e: MouseEvent): void {
  // 如果已有浮层，移除
  const existing = document.querySelector('.mx-theme-picker');
  if (existing) { existing.remove(); return; }

  const picker = document.createElement('div');
  picker.className = 'mx-theme-picker';
  picker.style.cssText = `
    position: fixed;
    z-index: 9999;
    background: var(--mx-bg-secondary);
    border: 1px solid var(--mx-border);
    border-radius: var(--mx-radius-md);
    padding: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    min-width: 160px;
  `;

  const themes = [
    { key: 'trae-dark', label: '🌙 Trae Dark', desc: '深色（默认）' },
    { key: 'light',     label: '☀️ Light',      desc: '浅色' },
    { key: 'trae-blue', label: '🔵 Trae Blue',  desc: '深蓝' },
  ];

  const currentTheme = this.container.getAttribute('data-mx-theme') || 'trae-dark';

  themes.forEach(t => {
    const item = document.createElement('div');
    item.style.cssText = `
      padding: 8px 12px;
      border-radius: var(--mx-radius-sm);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 2px;
      ${currentTheme === t.key ? 'background: var(--mx-accent-bg);' : ''}
    `;
    item.innerHTML = `
      <span style="font-size:13px;color:var(--mx-text-primary)">${t.label}</span>
      <span style="font-size:11px;color:var(--mx-text-muted)">${t.desc}</span>
    `;
    item.addEventListener('mouseenter', () => {
      item.style.background = 'var(--mx-bg-tertiary)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = currentTheme === t.key ? 'var(--mx-accent-bg)' : '';
    });
    item.addEventListener('click', () => {
      this.applyTheme(t.key);
      picker.remove();
    });
    picker.appendChild(item);
  });

  // 定位在按钮下方
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  picker.style.right = (window.innerWidth - rect.right) + 'px';
  picker.style.top = (rect.bottom + 4) + 'px';

  document.body.appendChild(picker);

  // 点击外部关闭
  const close = (ev: MouseEvent) => {
    if (!picker.contains(ev.target as Node)) {
      picker.remove();
      document.removeEventListener('click', close, true);
    }
  };
  setTimeout(() => document.addEventListener('click', close, true), 0);
}

private applyTheme(theme: string): void {
  this.container.setAttribute('data-mx-theme', theme);
  localStorage.setItem('mx-theme', theme);
}
```

- [ ] **Step 3：编译检查**

```bash
npx tsc -p src/tsconfig.json --noEmit 2>&1 | tail -20
```

- [ ] **Step 4：提交**

```bash
git add src/vs/workbench/contrib/maxian/browser/maxianView.ts
git commit -m "feat(chat): 顶部操作栏——历史/主题切换/清空按钮"
```

---

### Task 7：欢迎页重设计

**Files:**
- 修改：`src/vs/workbench/contrib/maxian/browser/maxianView.ts`

- [ ] **Step 1：找到现有欢迎页创建代码**

搜索 `欢迎消息` 注释或 `welcomeElement`，定位现有的欢迎页 DOM 构建代码（大约 Task 2 读到的第 261-365 行）。

- [ ] **Step 2：替换欢迎页内容**

将原有 4 个特性卡片改为：
1. 居中大 logo（60px，圆角）
2. 标题「码弦」
3. 3 个可点击的快捷问题卡片
4. 最近对话历史（最多 3 条，从 localStorage 读取）

```typescript
private buildWelcomeScreen(parent: HTMLElement): void {
  const welcome = append(parent, $('div.mx-welcome'));
  welcome.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 32px 20px;
    color: var(--mx-text-secondary);
  `;

  // Logo
  const logo = append(welcome, $('img')) as HTMLImageElement;
  logo.src = FileAccess.asBrowserUri(
    'vs/workbench/contrib/maxian/browser/media/icons/maxian-avatar.png'
  ).toString(true);
  logo.style.cssText = `
    width: 60px; height: 60px;
    border-radius: var(--mx-radius-md);
    margin-bottom: 16px;
    display: block;
  `;

  // 标题
  const title = append(welcome, $('div'));
  title.textContent = '码弦';
  title.style.cssText = `
    font-size: 22px; font-weight: 700;
    color: var(--mx-text-primary);
    margin-bottom: 6px;
  `;

  const subtitle = append(welcome, $('div'));
  subtitle.textContent = 'AI 驱动的智能编程助手';
  subtitle.style.cssText = `
    font-size: 13px;
    color: var(--mx-text-muted);
    margin-bottom: 28px;
  `;

  // 快捷问题卡片
  const suggestions = [
    '📖 解释当前文件的主要逻辑',
    '🔧 帮我重构选中的代码',
    '🐛 分析并修复这个 bug',
  ];

  const suggestContainer = append(welcome, $('div'));
  suggestContainer.style.cssText = `
    width: 100%; max-width: 340px;
    display: flex; flex-direction: column; gap: 8px;
    margin-bottom: 28px;
  `;

  suggestions.forEach(text => {
    const card = append(suggestContainer, $('div.mx-suggest-card'));
    card.textContent = text;
    card.style.cssText = `
      padding: 10px 14px;
      background: var(--mx-bg-secondary);
      border: 1px solid var(--mx-border);
      border-radius: var(--mx-radius-md);
      font-size: 13px;
      color: var(--mx-text-primary);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    `;
    card.addEventListener('mouseenter', () => {
      card.style.background = 'var(--mx-bg-tertiary)';
      card.style.borderColor = 'var(--mx-accent)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.background = 'var(--mx-bg-secondary)';
      card.style.borderColor = 'var(--mx-border)';
    });
    card.addEventListener('click', () => {
      // 填入输入框
      const pureText = text.replace(/^[^\s]+\s/, '');
      if (this.inputBox) {
        this.inputBox.textContent = pureText;
        this.inputBox.focus();
        // 触发 placeholder 隐藏
        this.inputBox.dispatchEvent(new Event('input'));
      }
    });
  });

  // 最近对话历史
  const recentKeys = this.getRecentHistoryKeys().slice(0, 3);
  if (recentKeys.length > 0) {
    const historyLabel = append(welcome, $('div'));
    historyLabel.textContent = '最近对话';
    historyLabel.style.cssText = `
      font-size: 11px; font-weight: 700;
      color: var(--mx-text-muted);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      margin-bottom: 8px;
      align-self: flex-start;
      width: 100%; max-width: 340px;
    `;

    const historyContainer = append(welcome, $('div'));
    historyContainer.style.cssText = `
      width: 100%; max-width: 340px;
      display: flex; flex-direction: column; gap: 4px;
    `;

    recentKeys.forEach(key => {
      try {
        const entry = JSON.parse(localStorage.getItem(key) || '{}');
        const summary = entry.summary || '（无摘要）';
        const time = entry.time ? new Date(entry.time).toLocaleDateString() : '';

        const item = append(historyContainer, $('div.mx-history-item'));
        item.style.cssText = `
          padding: 7px 12px;
          background: var(--mx-bg-secondary);
          border-radius: var(--mx-radius-sm);
          font-size: 12px;
          color: var(--mx-text-secondary);
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          transition: background 0.15s;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        `;
        item.title = summary;

        const summaryEl = append(item, $('span'));
        summaryEl.textContent = summary.length > 35 ? summary.slice(0, 35) + '…' : summary;

        const timeEl = append(item, $('span'));
        timeEl.textContent = time;
        timeEl.style.cssText = 'font-size:11px;color:var(--mx-text-muted);flex-shrink:0;margin-left:8px;';

        item.addEventListener('mouseenter', () => { item.style.background = 'var(--mx-bg-tertiary)'; });
        item.addEventListener('mouseleave', () => { item.style.background = 'var(--mx-bg-secondary)'; });
        item.addEventListener('click', () => this.restoreHistory(key));
      } catch { /* ignore */ }
    });
  }

  this.welcomeElement = welcome;
}

private getRecentHistoryKeys(): string[] {
  const keys: { key: string; time: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('mx-history-')) {
      try {
        const entry = JSON.parse(localStorage.getItem(k) || '{}');
        keys.push({ key: k, time: entry.time || 0 });
      } catch { /* ignore */ }
    }
  }
  return keys.sort((a, b) => b.time - a.time).map(x => x.key);
}

private restoreHistory(key: string): void {
  try {
    const entry = JSON.parse(localStorage.getItem(key) || '{}');
    const messages: ClineMessage[] = entry.messages || [];
    if (messages.length === 0) return;
    // 清空当前，然后重放历史消息（只显示，不重新执行）
    clearNode(this.messageArea);
    messages.forEach(msg => this.renderMessageFromHistory(msg));
  } catch { /* ignore */ }
}
```

- [ ] **Step 3：在 renderBody 中调用 buildWelcomeScreen（替换原有欢迎页代码）**

找到原欢迎页的创建代码块，用 `this.buildWelcomeScreen(this.messageArea)` 替换。

- [ ] **Step 4：编译 + 验证**

```bash
npx tsc -p src/tsconfig.json --noEmit 2>&1 | tail -20
./scripts/code.sh
```

- [ ] **Step 5：提交**

```bash
git add src/vs/workbench/contrib/maxian/browser/maxianView.ts
git commit -m "feat(chat): 欢迎页重设计——快捷问题卡片+最近对话历史"
```

---

## Chunk 4：聊天面板 - 消息气泡、代码块、工具卡片（P2 后半）

### Task 8：用户/AI 消息气泡

**Files:**
- 修改：`src/vs/workbench/contrib/maxian/browser/maxianView.ts`

- [ ] **Step 1：找到现有用户消息渲染逻辑**

搜索 `user_message` 或 `role === 'user'`，定位用户消息的 DOM 构建代码。

- [ ] **Step 2：修改用户消息为右对齐气泡**

找到用户消息容器的 style 设置，改为：
```typescript
// 用户消息外层容器——右对齐
msgContainer.style.cssText = `
  display: flex;
  justify-content: flex-end;
  margin: 8px 0;
  padding: 0 12px;
`;

// 气泡本体
const bubble = append(msgContainer, $('div.mx-user-bubble'));
bubble.style.cssText = `
  max-width: 85%;
  background: var(--mx-accent);
  color: #FFFFFF;
  padding: 10px 14px;
  border-radius: var(--mx-radius-lg) var(--mx-radius-lg) var(--mx-radius-sm) var(--mx-radius-lg);
  font-size: 13.5px;
  line-height: 1.5;
  word-break: break-word;
`;
```

- [ ] **Step 3：修改 AI 消息为左对齐卡片**

找到 AI 消息容器的 style 设置，改为：
```typescript
// AI 消息外层容器——左对齐
msgContainer.style.cssText = `
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 8px 0;
  padding: 0 12px;
`;

// 小头像
const avatar = append(msgContainer, $('img.mx-ai-avatar')) as HTMLImageElement;
avatar.src = FileAccess.asBrowserUri(
  'vs/workbench/contrib/maxian/browser/media/icons/maxian-avatar.png'
).toString(true);
avatar.style.cssText = `
  width: 20px; height: 20px;
  border-radius: 4px;
  flex-shrink: 0;
  margin-top: 2px;
`;

// 消息卡片
const card = append(msgContainer, $('div.mx-ai-card'));
card.style.cssText = `
  flex: 1;
  background: var(--mx-bg-tertiary);
  border-radius: var(--mx-radius-sm) var(--mx-radius-lg) var(--mx-radius-lg) var(--mx-radius-lg);
  padding: 10px 14px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--mx-text-primary);
  word-break: break-word;
`;
```

- [ ] **Step 4：编译检查**

```bash
npx tsc -p src/tsconfig.json --noEmit 2>&1 | tail -20
```

- [ ] **Step 5：启动，验证消息气泡布局**

```bash
./scripts/code.sh
```

- [ ] **Step 6：提交**

```bash
git add src/vs/workbench/contrib/maxian/browser/maxianView.ts
git commit -m "feat(chat): 用户消息右对齐气泡 + AI 消息左对齐卡片"
```

---

### Task 9：代码块 Header + 折叠

**Files:**
- 修改：`src/vs/workbench/contrib/maxian/browser/uiUtils.ts`（或 maxianView.ts 中的代码块渲染）

- [ ] **Step 1：找到代码块的渲染位置**

搜索 `code` + `pre` 或 `createCodeBlock` 或 Markdown 渲染后处理代码块的逻辑。代码块通常在 `MarkdownRendererDom` 渲染后由 `maxianView.ts` 加工（添加复制按钮等）。

- [ ] **Step 2：新增 enhanceCodeBlock 函数（在 uiUtils.ts 中）**

```typescript
/**
 * 增强代码块：添加文件名 header、折叠超长代码
 */
export function enhanceCodeBlock(
  codeEl: HTMLElement,
  filename?: string,
  language?: string
): void {
  const pre = codeEl.tagName === 'PRE' ? codeEl : codeEl.closest('pre') as HTMLElement;
  if (!pre) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'mx-code-block';
  wrapper.style.cssText = `
    border-radius: var(--mx-radius-md);
    overflow: hidden;
    border: 1px solid var(--mx-border);
    margin: 8px 0;
    background: var(--mx-bg-deepest);
  `;

  // Header
  const header = document.createElement('div');
  header.className = 'mx-code-header';
  header.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: var(--mx-bg-tertiary);
    border-bottom: 1px solid var(--mx-border);
    font-size: 12px;
  `;

  const fileInfo = document.createElement('span');
  fileInfo.style.color = 'var(--mx-text-secondary)';
  fileInfo.textContent = filename || '';

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;align-items:center;';

  if (language) {
    const langTag = document.createElement('span');
    langTag.textContent = language;
    langTag.style.cssText = `
      font-size: 11px;
      color: var(--mx-text-muted);
      background: var(--mx-bg-secondary);
      padding: 2px 6px;
      border-radius: 4px;
    `;
    actions.appendChild(langTag);
  }

  // 复制按钮（复用原有逻辑）
  const copyBtn = document.createElement('button');
  copyBtn.textContent = '复制';
  copyBtn.style.cssText = `
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid var(--mx-border);
    background: transparent;
    color: var(--mx-text-secondary);
    cursor: pointer;
    transition: background 0.15s;
  `;
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(codeEl.textContent || '');
    copyBtn.textContent = '已复制 ✓';
    setTimeout(() => { copyBtn.textContent = '复制'; }, 1500);
  });
  actions.appendChild(copyBtn);

  header.appendChild(fileInfo);
  header.appendChild(actions);

  // Code area（设置样式）
  pre.style.cssText = `
    margin: 0;
    padding: 12px;
    overflow-x: auto;
    font-family: var(--mx-font-mono, monospace);
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--mx-text-primary);
    background: var(--mx-bg-deepest);
  `;

  // 折叠超过 20 行的代码
  const lineCount = (codeEl.textContent || '').split('\n').length;
  const FOLD_THRESHOLD = 20;
  if (lineCount > FOLD_THRESHOLD) {
    pre.style.maxHeight = `${FOLD_THRESHOLD * 20}px`;
    pre.style.overflow = 'hidden';
    pre.dataset.folded = 'true';

    const foldBtn = document.createElement('div');
    foldBtn.className = 'mx-code-fold-btn';
    foldBtn.style.cssText = `
      text-align: center;
      padding: 8px;
      font-size: 12px;
      color: var(--mx-accent);
      cursor: pointer;
      background: var(--mx-bg-deepest);
      border-top: 1px solid var(--mx-border);
    `;
    foldBtn.textContent = `▼ 展开全部 (${lineCount} 行)`;
    foldBtn.addEventListener('click', () => {
      if (pre.dataset.folded === 'true') {
        pre.style.maxHeight = '';
        pre.style.overflow = 'auto';
        pre.dataset.folded = 'false';
        foldBtn.textContent = '▲ 收起';
      } else {
        pre.style.maxHeight = `${FOLD_THRESHOLD * 20}px`;
        pre.style.overflow = 'hidden';
        pre.dataset.folded = 'true';
        foldBtn.textContent = `▼ 展开全部 (${lineCount} 行)`;
      }
    });

    pre.parentNode!.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
    wrapper.appendChild(foldBtn);
  } else {
    pre.parentNode!.insertBefore(wrapper, pre);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);
  }
}
```

- [ ] **Step 3：在 AI 消息渲染完成后，遍历所有 pre 标签调用 enhanceCodeBlock**

在 maxianView.ts 中，找到 Markdown 渲染完成（`onComplete` 或消息 `complete` 状态）后的处理位置：
```typescript
// 增强代码块
card.querySelectorAll('pre').forEach((pre: HTMLElement) => {
  const code = pre.querySelector('code');
  const langClass = code?.className.match(/language-(\w+)/)?.[1];
  enhanceCodeBlock(pre, undefined, langClass);
});
```

- [ ] **Step 4：编译 + 验证**

```bash
npx tsc -p src/tsconfig.json --noEmit 2>&1 | tail -20
./scripts/code.sh
```
检查：代码块是否出现 header，超过 20 行是否折叠。

- [ ] **Step 5：提交**

```bash
git add src/vs/workbench/contrib/maxian/browser/uiUtils.ts \
        src/vs/workbench/contrib/maxian/browser/maxianView.ts
git commit -m "feat(chat): 代码块添加 header（文件名+语言标签）和超长折叠"
```

---

### Task 10：工具执行折叠卡片

**Files:**
- 修改：`src/vs/workbench/contrib/maxian/browser/uiUtils.ts`
- 修改：`src/vs/workbench/contrib/maxian/browser/maxianView.ts`

- [ ] **Step 1：找到现有工具状态渲染逻辑**

搜索 `toolStatusElements` 或 `TOOL_STATUS_TEXT`，定位工具卡片的创建和更新代码（在 maxianView.ts 的 `handleClineMessage` 或 `handleToolCompleted` 中）。

- [ ] **Step 2：新增 createToolCard 函数（在 uiUtils.ts）**

```typescript
export interface ToolCardOptions {
  toolId: string;
  toolName: string;
  icon: string;
  filePath?: string;
  status: ToolStatus;
  diffStats?: DiffStats;
}

export function createToolCard(opts: ToolCardOptions): HTMLElement {
  const card = document.createElement('div');
  card.className = 'mx-tool-card';
  card.dataset.toolId = opts.toolId;
  card.style.cssText = `
    background: var(--mx-bg-secondary);
    border: 1px solid var(--mx-border);
    border-radius: var(--mx-radius-md);
    margin: 4px 0;
    overflow: hidden;
    transition: border-color 0.15s;
  `;

  // 头部行（点击折叠/展开）
  const header = document.createElement('div');
  header.className = 'mx-tool-card-header';
  header.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    cursor: pointer;
    user-select: none;
    font-size: 12.5px;
  `;

  const toggle = document.createElement('span');
  toggle.className = 'mx-tool-toggle';
  toggle.textContent = '▶';
  toggle.style.cssText = `
    font-size: 10px;
    color: var(--mx-text-muted);
    transition: transform 0.15s;
    width: 12px;
  `;

  const iconEl = document.createElement('span');
  iconEl.textContent = opts.icon;
  iconEl.style.fontSize = '14px';

  const nameEl = document.createElement('span');
  nameEl.style.cssText = 'color:var(--mx-text-secondary);font-weight:500;';
  nameEl.textContent = opts.toolName;

  const fileEl = document.createElement('span');
  fileEl.style.cssText = 'color:var(--mx-text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  fileEl.textContent = opts.filePath || '';

  const statusEl = document.createElement('span');
  statusEl.className = 'mx-tool-status';
  updateToolCardStatus(statusEl, opts.status, opts.diffStats);

  header.appendChild(toggle);
  header.appendChild(iconEl);
  header.appendChild(nameEl);
  header.appendChild(fileEl);
  header.appendChild(statusEl);

  // 详情区（默认折叠）
  const detail = document.createElement('div');
  detail.className = 'mx-tool-detail';
  detail.style.cssText = `
    display: none;
    padding: 0 12px 10px 12px;
    font-size: 12px;
    color: var(--mx-text-muted);
    border-top: 1px solid var(--mx-border);
  `;

  let isOpen = false;
  header.addEventListener('click', () => {
    isOpen = !isOpen;
    detail.style.display = isOpen ? 'block' : 'none';
    toggle.style.transform = isOpen ? 'rotate(90deg)' : '';
  });

  card.appendChild(header);
  card.appendChild(detail);

  return card;
}

export function updateToolCardStatus(
  statusEl: HTMLElement,
  status: ToolStatus,
  diffStats?: DiffStats
): void {
  const configs: Record<ToolStatus, { text: string; color: string }> = {
    loading:  { text: '⏳ 执行中...', color: 'var(--mx-text-muted)' },
    pending:  { text: '⏸ 等待中',    color: 'var(--mx-text-muted)' },
    success:  { text: '✅ 成功',      color: 'var(--mx-success)' },
    error:    { text: '❌ 失败',      color: 'var(--mx-error)' },
    info:     { text: 'ℹ️ 信息',      color: 'var(--mx-text-secondary)' },
  };
  const cfg = configs[status] || configs.info;
  statusEl.style.color = cfg.color;
  statusEl.style.fontSize = '12px';
  statusEl.style.flexShrink = '0';

  if (status === 'success' && diffStats && (diffStats.added > 0 || diffStats.removed > 0)) {
    statusEl.innerHTML = `✅ <span style="color:var(--mx-success)">+${diffStats.added}</span> <span style="color:var(--mx-error)">-${diffStats.removed}</span>`;
  } else {
    statusEl.textContent = cfg.text;
  }
}
```

- [ ] **Step 3：在 maxianView.ts 的工具状态处理中使用新卡片**

找到 `toolStatusElements` 的创建（`handleToolCompleted` / `handleClineMessage` 中工具状态部分），用 `createToolCard` 替换现有的行内文字实现。

工具卡片放入 AI 消息卡片底部（在消息文本内容之后）。

- [ ] **Step 4：编译 + 验证**

```bash
npx tsc -p src/tsconfig.json --noEmit 2>&1 | tail -20
./scripts/code.sh
```
检查：工具卡片是否折叠显示，点击是否展开，状态图标是否正确。

- [ ] **Step 5：提交**

```bash
git add src/vs/workbench/contrib/maxian/browser/uiUtils.ts \
        src/vs/workbench/contrib/maxian/browser/maxianView.ts
git commit -m "feat(chat): 工具执行状态改为折叠卡片（默认收起，点击展开）"
```

---

## Chunk 5：输入区域重设计（P2 输入）

### Task 11：输入区三段式布局

**Files:**
- 修改：`src/vs/workbench/contrib/maxian/browser/maxianView.ts`

- [ ] **Step 1：找到现有输入区创建代码**

搜索 `maxian-input-container` 或 `inputContainer`，定位输入区 DOM 构建（大约在第 367 行附近）。

- [ ] **Step 2：重建三段式布局**

在输入容器内部，改为三段结构：
1. **Context 行**（@ 上下文，有 chip 才显示）
2. **文本输入区**（contenteditable）
3. **底部操作行**（知识库 + 连续对话 + 停止 + 发送）

```typescript
// 外层容器样式
inputContainer.style.cssText = `
  background: var(--mx-bg-secondary);
  border-radius: var(--mx-radius-lg);
  border: 1px solid var(--mx-border);
  margin: 8px 10px;
  padding: 0;
  transition: border-color 0.15s;
  flex-shrink: 0;
`;
inputContainer.addEventListener('focusin', () => {
  inputContainer.style.borderColor = 'var(--mx-accent)';
});
inputContainer.addEventListener('focusout', () => {
  inputContainer.style.borderColor = 'var(--mx-border)';
});

// Context 行（@ 上下文）
const contextRow = append(inputContainer, $('div.mx-context-row'));
contextRow.style.cssText = `
  display: none;  /* chip 存在时显示 */
  padding: 8px 12px 0;
  gap: 6px;
  flex-wrap: wrap;
`;

// @ 按钮（始终显示在 context 行）
const atBtn = append(contextRow, $('button.mx-at-btn')) as HTMLButtonElement;
atBtn.textContent = '@ 添加上下文';
atBtn.style.cssText = `
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px dashed var(--mx-border);
  background: transparent;
  color: var(--mx-text-muted);
  cursor: pointer;
  transition: all 0.15s;
`;
atBtn.addEventListener('click', () => {
  // 在输入框触发 @ 输入
  if (this.inputBox) {
    this.inputBox.focus();
    document.execCommand('insertText', false, '@');
    this.inputBox.dispatchEvent(new Event('input'));
  }
});
contextRow.style.display = 'flex';

// 文本输入区（保持 contenteditable）
// this.inputBox 样式更新
this.inputBox.style.cssText = `
  padding: 10px 12px;
  min-height: 68px;
  max-height: 300px;
  overflow-y: auto;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--mx-text-primary);
  background: transparent;
  outline: none;
  word-break: break-word;
`;

// 底部操作行
const actionRow = append(inputContainer, $('div.mx-action-row'));
actionRow.style.cssText = `
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border-top: 1px solid var(--mx-border);
  gap: 6px;
`;
```

- [ ] **Step 3：将知识库选择器和连续对话复选框移入 actionRow**

找到 `knowledgeBaseSelectorWrapper` 和 `continuousConversationWrapper` 的 append 调用，将其 parent 改为 `actionRow`。

在 actionRow 末尾（`flex: 1` spacer 后）放停止按钮和发送按钮：
```typescript
const spacer = append(actionRow, $('div'));
spacer.style.flex = '1';

// 停止按钮（已有 this.cancelButton，修改样式）
this.cancelButton.style.cssText = `
  display: none;
  padding: 5px 12px;
  border-radius: var(--mx-radius-sm);
  border: 1px solid var(--mx-border);
  background: transparent;
  color: var(--mx-text-secondary);
  font-size: 12px;
  cursor: pointer;
`;

// 发送按钮（已有 this.sendButton，修改样式）
this.sendButton.style.cssText = `
  padding: 5px 14px;
  border-radius: var(--mx-radius-sm);
  border: none;
  background: var(--mx-accent);
  color: #FFFFFF;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
`;
this.sendButton.addEventListener('mouseenter', () => {
  this.sendButton.style.background = 'var(--mx-accent-hover)';
});
this.sendButton.addEventListener('mouseleave', () => {
  this.sendButton.style.background = 'var(--mx-accent)';
});
```

- [ ] **Step 4：编译 + 验证**

```bash
npx tsc -p src/tsconfig.json --noEmit 2>&1 | tail -20
./scripts/code.sh
```

- [ ] **Step 5：提交**

```bash
git add src/vs/workbench/contrib/maxian/browser/maxianView.ts
git commit -m "feat(chat): 输入区三段式布局——context 行/文本区/操作行"
```

---

## Chunk 6：对话历史面板（P3）

### Task 12：历史存储 + 历史侧拉抽屉

**Files:**
- 修改：`src/vs/workbench/contrib/maxian/browser/maxianView.ts`

- [ ] **Step 1：在 clearConversation / 切换对话时保存历史**

找到 `handleConversationCleared`，在清空前保存当前对话：
```typescript
private saveCurrentConversationToHistory(): void {
  // 只保存有实质内容的对话
  const messages = this.getAllRenderedMessages();
  if (messages.length < 2) return;

  const firstUserMsg = messages.find(m => m.type === 'say' && m.say === 'user_feedback');
  const summary = firstUserMsg?.text?.slice(0, 50) || '（无摘要）';

  const key = `mx-history-${Date.now()}`;
  const entry = { summary, time: Date.now(), messages };
  localStorage.setItem(key, JSON.stringify(entry));

  // 最多保留 50 条，超出删最旧的
  const keys = this.getRecentHistoryKeys();
  if (keys.length > 50) {
    keys.slice(50).forEach(k => localStorage.removeItem(k));
  }
}
```

在 `handleConversationCleared` 开头调用 `this.saveCurrentConversationToHistory()`。

- [ ] **Step 2：新增 toggleHistoryPanel 方法（侧拉抽屉）**

```typescript
private historyDrawer: HTMLElement | null = null;

private toggleHistoryPanel(): void {
  if (this.historyDrawer && document.body.contains(this.historyDrawer)) {
    this.historyDrawer.remove();
    this.historyDrawer = null;
    return;
  }

  const drawer = document.createElement('div');
  drawer.className = 'mx-history-drawer';
  this.historyDrawer = drawer;

  const panel = this.container.closest('.monaco-pane-view, .split-view-view') as HTMLElement
    || this.container;
  const rect = this.container.getBoundingClientRect();

  drawer.style.cssText = `
    position: fixed;
    top: ${rect.top}px;
    right: ${window.innerWidth - rect.right}px;
    width: 280px;
    height: ${rect.height}px;
    background: var(--mx-bg-secondary);
    border-left: 1px solid var(--mx-border);
    z-index: 500;
    display: flex;
    flex-direction: column;
    box-shadow: -4px 0 16px rgba(0,0,0,0.3);
    overflow: hidden;
  `;

  // 标题栏
  const drawerHeader = document.createElement('div');
  drawerHeader.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-bottom: 1px solid var(--mx-border);
    flex-shrink: 0;
  `;
  const drawerTitle = document.createElement('span');
  drawerTitle.textContent = '历史对话';
  drawerTitle.style.cssText = 'font-size:13px;font-weight:600;color:var(--mx-text-primary);';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = `
    background:transparent;border:none;
    color:var(--mx-text-muted);cursor:pointer;font-size:14px;
    padding:2px 6px;border-radius:4px;
  `;
  closeBtn.addEventListener('click', () => {
    drawer.remove();
    this.historyDrawer = null;
  });
  drawerHeader.appendChild(drawerTitle);
  drawerHeader.appendChild(closeBtn);

  // 搜索框
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = '🔍 搜索历史...';
  searchInput.style.cssText = `
    margin: 8px 10px;
    padding: 6px 10px;
    background: var(--mx-bg-tertiary);
    border: 1px solid var(--mx-border);
    border-radius: var(--mx-radius-sm);
    color: var(--mx-text-primary);
    font-size: 12.5px;
    outline: none;
    flex-shrink: 0;
  `;

  // 列表区
  const listArea = document.createElement('div');
  listArea.style.cssText = 'flex:1;overflow-y:auto;padding:4px 0;';

  const renderHistoryList = (filter = '') => {
    listArea.innerHTML = '';
    const keys = this.getRecentHistoryKeys();

    // 按日期分组
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const groups: Record<string, string[]> = {};

    keys.forEach(key => {
      try {
        const entry = JSON.parse(localStorage.getItem(key) || '{}');
        if (filter && !entry.summary?.includes(filter)) return;
        const d = new Date(entry.time || 0).toDateString();
        const label = d === today ? '今天' : d === yesterday ? '昨天' : d;
        if (!groups[label]) groups[label] = [];
        groups[label].push(key);
      } catch { /* ignore */ }
    });

    Object.entries(groups).forEach(([label, gKeys]) => {
      const groupLabel = document.createElement('div');
      groupLabel.textContent = label;
      groupLabel.style.cssText = `
        padding: 8px 14px 4px;
        font-size: 11px;
        font-weight: 700;
        color: var(--mx-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      `;
      listArea.appendChild(groupLabel);

      gKeys.forEach(key => {
        try {
          const entry = JSON.parse(localStorage.getItem(key) || '{}');
          const item = document.createElement('div');
          item.style.cssText = `
            padding: 8px 14px;
            cursor: pointer;
            font-size: 12.5px;
            color: var(--mx-text-secondary);
            border-radius: 6px;
            margin: 1px 6px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            transition: background 0.12s;
          `;
          item.title = entry.summary || '';
          item.textContent = entry.summary?.slice(0, 38) || '（无摘要）';
          item.addEventListener('mouseenter', () => { item.style.background = 'var(--mx-bg-tertiary)'; });
          item.addEventListener('mouseleave', () => { item.style.background = ''; });
          item.addEventListener('click', () => {
            this.restoreHistory(key);
            drawer.remove();
            this.historyDrawer = null;
          });
          listArea.appendChild(item);
        } catch { /* ignore */ }
      });
    });

    if (listArea.innerHTML === '') {
      const empty = document.createElement('div');
      empty.textContent = '暂无历史对话';
      empty.style.cssText = 'text-align:center;color:var(--mx-text-muted);font-size:12px;padding:32px;';
      listArea.appendChild(empty);
    }
  };

  searchInput.addEventListener('input', () => renderHistoryList(searchInput.value));
  renderHistoryList();

  drawer.appendChild(drawerHeader);
  drawer.appendChild(searchInput);
  drawer.appendChild(listArea);
  document.body.appendChild(drawer);
}
```

- [ ] **Step 3：编译检查**

```bash
npx tsc -p src/tsconfig.json --noEmit 2>&1 | tail -20
```

- [ ] **Step 4：启动，测试历史保存和恢复**

```bash
./scripts/code.sh
```
测试：发送几条消息 → 清空 → 点击历史按钮 → 是否显示历史 → 点击是否恢复。

- [ ] **Step 5：提交**

```bash
git add src/vs/workbench/contrib/maxian/browser/maxianView.ts
git commit -m "feat(history): 对话历史保存到 localStorage + 侧拉抽屉恢复"
```

---

## Chunk 7：文件变更面板（P3）

### Task 13：Session Changes Panel

**Files:**
- 修改：`src/vs/workbench/contrib/maxian/browser/maxianView.ts`

- [ ] **Step 1：在 maxianView.ts 中跟踪工具写操作的文件变更**

在类中新增字段：
```typescript
private sessionChanges: Map<string, { type: 'edit' | 'write' | 'delete'; diffStats?: DiffStats }> = new Map();
private changesPanel: HTMLElement | null = null;
```

在 `handleToolCompleted` 中，当工具为 `edit`/`write_to_file`/`delete_file` 时记录：
```typescript
if (['edit', 'multiedit', 'write_to_file', 'delete_file'].includes(toolName)) {
  const filePath = extractFilePathFromToolResult(result);
  if (filePath) {
    this.sessionChanges.set(filePath, {
      type: toolName === 'delete_file' ? 'delete' : 'edit',
      diffStats: diffStats
    });
    this.updateChangesPanel();
  }
}
```

- [ ] **Step 2：新增 createChangesPanel / updateChangesPanel 方法**

```typescript
private createChangesPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'mx-changes-panel';
  panel.style.cssText = `
    background: var(--mx-bg-secondary);
    border-top: 1px solid var(--mx-border);
    padding: 8px 12px;
    flex-shrink: 0;
    max-height: 180px;
    overflow-y: auto;
  `;
  return panel;
}

private updateChangesPanel(): void {
  if (this.sessionChanges.size === 0) {
    if (this.changesPanel) {
      this.changesPanel.style.display = 'none';
    }
    return;
  }

  if (!this.changesPanel) {
    // 插入在 inputContainer 之前
    const inputContainer = this.container.querySelector('.maxian-input-container');
    this.changesPanel = this.createChangesPanel();
    if (inputContainer) {
      this.container.insertBefore(this.changesPanel, inputContainer);
    } else {
      this.container.appendChild(this.changesPanel);
    }
  }

  this.changesPanel.style.display = 'block';
  clearNode(this.changesPanel);

  // 标题行
  const headerRow = append(this.changesPanel, $('div'));
  headerRow.style.cssText = `
    display:flex;align-items:center;justify-content:space-between;
    margin-bottom:6px;
  `;
  const headerLabel = append(headerRow, $('span'));
  headerLabel.style.cssText = 'font-size:11px;font-weight:700;color:var(--mx-text-muted);text-transform:uppercase;letter-spacing:0.06em;';
  headerLabel.textContent = `本次变更（${this.sessionChanges.size} 个文件）`;

  const acceptAllBtn = append(headerRow, $('button')) as HTMLButtonElement;
  acceptAllBtn.textContent = '全部接受';
  acceptAllBtn.style.cssText = `
    font-size:11px;padding:2px 8px;
    border-radius:4px;border:1px solid var(--mx-accent);
    background:transparent;color:var(--mx-accent);cursor:pointer;
  `;
  acceptAllBtn.addEventListener('click', () => {
    this.sessionChanges.clear();
    this.updateChangesPanel();
  });

  // 文件列表
  this.sessionChanges.forEach((info, filePath) => {
    const row = append(this.changesPanel!, $('div'));
    row.style.cssText = `
      display:flex;align-items:center;gap:8px;
      padding:4px 0;font-size:12px;color:var(--mx-text-secondary);
    `;

    const typeIcon = info.type === 'delete' ? '🗑️' : '✏️';
    append(row, $('span')).textContent = typeIcon;

    const pathEl = append(row, $('span'));
    pathEl.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;color:var(--mx-accent);';
    pathEl.textContent = filePath;
    pathEl.title = filePath;
    pathEl.addEventListener('click', () => {
      // 打开 diff 查看器（复用现有逻辑）
      this.maxianService.openDiffForFile?.(filePath);
    });

    if (info.diffStats) {
      const statsEl = append(row, $('span'));
      statsEl.style.cssText = 'font-size:11px;flex-shrink:0;';
      statsEl.innerHTML = `<span style="color:var(--mx-success)">+${info.diffStats.added}</span> <span style="color:var(--mx-error)">-${info.diffStats.removed}</span>`;
    }

    const revertBtn = append(row, $('button')) as HTMLButtonElement;
    revertBtn.textContent = '恢复';
    revertBtn.style.cssText = `
      font-size:11px;padding:1px 6px;
      border-radius:3px;border:1px solid var(--mx-border);
      background:transparent;color:var(--mx-text-muted);cursor:pointer;
    `;
    revertBtn.addEventListener('click', async () => {
      // git checkout 回滚
      await this.maxianService.revertFile?.(filePath);
      this.sessionChanges.delete(filePath);
      this.updateChangesPanel();
    });
  });
}
```

- [ ] **Step 3：在 clearConversation 时清空 sessionChanges**

```typescript
this.sessionChanges.clear();
this.updateChangesPanel();
```

- [ ] **Step 4：编译检查**

```bash
npx tsc -p src/tsconfig.json --noEmit 2>&1 | tail -20
```

- [ ] **Step 5：提交**

```bash
git add src/vs/workbench/contrib/maxian/browser/maxianView.ts
git commit -m "feat(changes): 文件变更面板——追踪 session 中的文件改动"
```

---

## Chunk 8：Cmd+K 内联编辑（P4）

### Task 14：注册 Cmd+K 命令和内联 UI

**Files:**
- 新建：`src/vs/workbench/contrib/maxian/browser/inlineEdit.ts`
- 修改：`src/vs/workbench/contrib/maxian/browser/maxian.contribution.ts`

- [ ] **Step 1：新建 inlineEdit.ts**

```typescript
/*---------------------------------------------------------------------------------------------
 *  Cmd+K 内联 AI 编辑
 *  流程：选中代码 → Cmd+K → 弹出输入浮层 → 发送 → 渲染 inline diff → Accept/Reject
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IMaxianService } from './maxianService.js';
import { $, append } from '../../../../base/browser/dom.js';

export class InlineEditController {
  private floatEl: HTMLElement | null = null;

  constructor(
    @ICodeEditorService private readonly codeEditorService: ICodeEditorService,
    @IMaxianService private readonly maxianService: IMaxianService,
  ) {}

  async trigger(): Promise<void> {
    const editor = this.codeEditorService.getFocusedCodeEditor();
    if (!editor) return;

    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) return;

    const selectedText = editor.getModel()?.getValueInRange(selection) || '';
    if (!selectedText.trim()) return;

    // 显示输入浮层
    this.showFloatInput(editor, selection, selectedText);
  }

  private showFloatInput(editor: any, selection: any, selectedText: string): void {
    // 移除已有浮层
    if (this.floatEl) {
      this.floatEl.remove();
      this.floatEl = null;
    }

    const float = document.createElement('div');
    float.className = 'mx-inline-edit-float';
    this.floatEl = float;

    float.style.cssText = `
      position: fixed;
      z-index: 9999;
      background: var(--mx-bg-secondary, #30343F);
      border: 1px solid var(--mx-border, #2D3139);
      border-radius: 8px;
      padding: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      display: flex;
      gap: 6px;
      align-items: center;
      min-width: 320px;
    `;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '🤖 描述修改意图...';
    input.style.cssText = `
      flex: 1;
      background: var(--mx-bg-tertiary, #24262B);
      border: 1px solid var(--mx-border, #2D3139);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 13px;
      color: var(--mx-text-primary, #fff);
      outline: none;
    `;

    const sendBtn = document.createElement('button');
    sendBtn.textContent = '发送 ↵';
    sendBtn.style.cssText = `
      padding: 6px 12px;
      border-radius: 6px;
      border: none;
      background: var(--mx-accent, #4C9BE8);
      color: #fff;
      font-size: 12px;
      cursor: pointer;
    `;

    float.appendChild(input);
    float.appendChild(sendBtn);
    document.body.appendChild(float);

    // 定位在选区下方
    const coords = editor.getScrolledVisiblePosition(selection.getStartPosition());
    if (coords) {
      const editorDom = editor.getDomNode() as HTMLElement;
      const editorRect = editorDom.getBoundingClientRect();
      float.style.left = `${editorRect.left + coords.left}px`;
      float.style.top = `${editorRect.top + coords.top + coords.height + 4}px`;
    }

    input.focus();

    const submit = async () => {
      const intent = input.value.trim();
      if (!intent) return;
      float.remove();
      this.floatEl = null;

      // 构造 prompt 并发送给 AI（code 模式）
      const prompt = `请修改以下代码，要求：${intent}\n\n\`\`\`\n${selectedText}\n\`\`\`\n\n只输出修改后的代码，不要解释。`;
      const result = await this.maxianService.sendInlineEditRequest(prompt);

      if (result) {
        this.applyInlineDiff(editor, selection, selectedText, result);
      }
    };

    sendBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { float.remove(); this.floatEl = null; }
    });

    // 点击外部关闭
    const close = (e: MouseEvent) => {
      if (!float.contains(e.target as Node)) {
        float.remove();
        this.floatEl = null;
        document.removeEventListener('click', close, true);
      }
    };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  }

  private applyInlineDiff(
    editor: any,
    selection: any,
    originalText: string,
    newText: string
  ): void {
    // 清理代码块标记
    const cleaned = newText.replace(/^```[\w]*\n?/m, '').replace(/\n?```$/m, '').trim();

    // 替换选区内容
    editor.executeEdits('mx-inline-edit', [{
      range: selection,
      text: cleaned,
      forceMoveMarkers: true,
    }]);

    // 选中新插入的内容
    const model = editor.getModel();
    if (model) {
      const startPos = selection.getStartPosition();
      const lines = cleaned.split('\n');
      const endLine = startPos.lineNumber + lines.length - 1;
      const endCol = lines.length === 1
        ? startPos.column + cleaned.length
        : lines[lines.length - 1].length + 1;

      const newSelection = {
        startLineNumber: startPos.lineNumber,
        startColumn: startPos.column,
        endLineNumber: endLine,
        endColumn: endCol,
      };
      editor.setSelection(newSelection);
    }
  }
}
```

- [ ] **Step 2：在 maxian.contribution.ts 中注册 Cmd+K 命令**

找到现有 command 注册的地方，添加：
```typescript
import { InlineEditController } from './inlineEdit.js';
import { KeyMod, KeyCode } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';

// 注册命令
CommandsRegistry.registerCommand('maxian.inlineEdit', (accessor) => {
  const controller = accessor.get(IInstantiationService)
    .createInstance(InlineEditController);
  controller.trigger();
});

// 注册快捷键
KeybindingsRegistry.registerKeybindingRule({
  id: 'maxian.inlineEdit',
  weight: KeybindingWeight.WorkbenchContrib,
  when: EditorContextKeys.editorTextFocus,
  primary: KeyMod.CtrlCmd | KeyCode.KeyK,
});
```

- [ ] **Step 3：在 IMaxianService 接口中添加 sendInlineEditRequest 方法签名**

```typescript
// 在 maxianService.ts 的 IMaxianService 接口中添加：
sendInlineEditRequest(prompt: string): Promise<string | null>;
```

在 `MaxianService` 实现中，实现这个方法（复用现有的 API 调用逻辑，不走流式，直接返回完整结果）。

- [ ] **Step 4：编译检查**

```bash
npx tsc -p src/tsconfig.json --noEmit 2>&1 | tail -20
```

- [ ] **Step 5：启动验证 Cmd+K**

```bash
./scripts/code.sh
```
测试：在编辑器选中代码 → 按 Cmd+K → 输入意图 → 发送 → 代码是否更新。

- [ ] **Step 6：提交**

```bash
git add src/vs/workbench/contrib/maxian/browser/inlineEdit.ts \
        src/vs/workbench/contrib/maxian/browser/maxian.contribution.ts \
        src/vs/workbench/contrib/maxian/browser/maxianService.ts
git commit -m "feat(inline-edit): Cmd+K 触发内联 AI 编辑，浮层输入 + 直接替换选区"
```

---

## Chunk 9：整体整合、细节打磨（P4）

### Task 15：滚动条、动效、暗色适配

**Files:**
- 修改：`src/vs/workbench/contrib/maxian/browser/media/themes.css`（或新建 `maxian.css`）

- [ ] **Step 1：统一滚动条样式（themes.css）**

```css
/* 消息区滚动条 */
.mx-welcome::-webkit-scrollbar,
.mx-history-drawer::-webkit-scrollbar,
[data-mx-theme] ::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
[data-mx-theme] ::-webkit-scrollbar-track { background: transparent; }
[data-mx-theme] ::-webkit-scrollbar-thumb {
  background: var(--mx-scrollbar);
  border-radius: 2px;
}
[data-mx-theme] ::-webkit-scrollbar-thumb:hover {
  background: var(--mx-text-muted);
}
```

- [ ] **Step 2：消息入场动效**

```css
@keyframes mx-msg-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.mx-user-bubble, .mx-ai-card {
  animation: mx-msg-in 0.15s ease forwards;
}
```

- [ ] **Step 3：最终编译检查**

```bash
npx tsc -p src/tsconfig.json --noEmit 2>&1 | tail -20
```

- [ ] **Step 4：完整功能回归测试**

启动 IDE，逐项检查：
- [ ] 3 套主题切换正常，颜色正确应用
- [ ] Activity Bar hover/active 圆角背景
- [ ] 模式 Tab 显示，点击切换正常
- [ ] 欢迎页快捷问题卡片可点击
- [ ] 用户消息右对齐气泡，AI 消息左对齐卡片
- [ ] 代码块有 header，超长折叠
- [ ] 工具卡片折叠，点击展开
- [ ] 输入区三段式布局，焦点时蓝色边框
- [ ] 历史按钮 → 侧拉抽屉显示历史 → 点击恢复
- [ ] 文件变更面板在 agent 修改文件后出现
- [ ] Cmd+K 触发浮层，输入意图后代码更新

- [ ] **Step 5：最终提交**

```bash
git add -A
git commit -m "feat(trae-ui): P4 细节打磨——滚动条/动效/暗色主题适配完成"
```

---

## 执行顺序总结

| Chunk | 内容 | 预计提交数 |
|-------|------|-----------|
| Chunk 1 | 分支创建 + Design Token | 2 |
| Chunk 2 | VS Code 壳子主题 | 2 |
| Chunk 3 | 模式 Tab + 欢迎页 + 顶部按钮 | 3 |
| Chunk 4 | 消息气泡 + 代码块 + 工具卡片 | 3 |
| Chunk 5 | 输入区重设计 | 1 |
| Chunk 6 | 对话历史 | 1 |
| Chunk 7 | 文件变更面板 | 1 |
| Chunk 8 | Cmd+K 内联编辑 | 1 |
| Chunk 9 | 细节打磨 + 回归测试 | 1 |
