# 监控统计分析功能设计规范

**目标：** 在现有管理端 UI 中新增「监控分析」子模块，为系统管理员和团队负责人提供实时监控、使用统计、成本分析、效率分析四个维度的数据看板。

**架构：** 在现有 Vue3 + Element Plus 管理端的 `/monitor/` 路由下新增 3 个子页面，后端新增 1 个 Controller + 2 个 Service + 2 张聚合表 + 1 个定时任务。

**技术栈：** Vue3 + Element Plus + ECharts（前端）；Spring Boot + MyBatis-Plus + MySQL + Elasticsearch（后端）

---

## 零、AI 功能使用类型体系（新增核心维度）

### 0.1 featureType 枚举定义

现有 `mode`（ask/code/architect/debug）只描述了 Agent 的工作模式，无法区分用户的具体使用意图。需在 `AICallLogData` 中新增 `featureType` 字段，记录用户使用的具体 AI 功能。

**枚举值定义：**

| featureType | 中文名 | 触发场景 |
|-------------|-------|---------|
| `knowledge_qa` | 知识库问答 | ask 模式 + 选择了知识库 |
| `code_generation` | 代码生成 | code 模式，生成新代码 |
| `code_debug` | 代码调试 | debug 模式 |
| `architecture_design` | 架构设计 | architect 模式 |
| `code_explain` | 代码解释 | ask 模式，无知识库，问题包含代码 |
| `code_refactor` | 代码重构 | code 模式，涉及 edit/multiedit 工具 |
| `test_generation` | 测试用例生成 | code 模式，生成 test/spec 文件 |
| `commit_message` | 提交信息生成 | operation=commit |
| `code_review` | 代码审查 | 来自 CodeReviewService（独立记录） |
| `general_chat` | 通用对话 | 其余情况的 ask 模式 |

### 0.2 IDE 侧识别逻辑（aiLog.ts 新增字段）

```typescript
// AICallLogData 新增字段
featureType?: string;     // AI功能类型，见上表枚举

// 识别规则（在 maxianService/TaskService 发送日志时赋值）
function resolveFeatureType(mode: string, operation: string,
                             hasKnowledgeBase: boolean,
                             toolsUsed: string[]): string {
  if (operation === 'commit') return 'commit_message';
  if (mode === 'debug') return 'code_debug';
  if (mode === 'architect') return 'architecture_design';
  if (mode === 'ask' && hasKnowledgeBase) return 'knowledge_qa';
  if (mode === 'code') {
    if (toolsUsed.some(t => t.includes('test') || t.includes('spec')))
      return 'test_generation';
    if (toolsUsed.includes('edit') || toolsUsed.includes('multiedit'))
      return 'code_refactor';
    return 'code_generation';
  }
  if (mode === 'ask') return 'general_chat';
  return 'general_chat';
}
```

### 0.3 后端存储扩展

**`ai_call_log` 表新增字段：**
```sql
ALTER TABLE ai_call_log ADD COLUMN feature_type VARCHAR(30) COMMENT 'AI功能类型';
```

**`statistics_daily` / `statistics_hourly` 新增字段：**
```sql
ALTER TABLE statistics_daily ADD COLUMN feature_type VARCHAR(30) COMMENT 'AI功能类型';
ALTER TABLE statistics_hourly ADD COLUMN feature_type VARCHAR(30) COMMENT 'AI功能类型';
```

聚合时按 `(date, user_email, team_id, model, mode, feature_type, knowledge_base_id)` 分组。

---

## 一、整体架构

### 1.1 前端模块结构

```
/monitor/                          （现有一级菜单）
├── dashboard      实时监控看板      【新增】
├── statistics     使用统计报表      【新增】
├── cost           成本分析          【新增】
├── efficiency     效率分析          【新增】
├── xxljob         定时任务          （保留）
└── online         在线用户          （保留）
```

### 1.2 后端新增结构

```
boyo-knowledge/
└── src/main/java/com/boyo/knowledge/
    ├── controller/
    │   └── AiStatisticsController.java       新增
    ├── service/
    │   ├── IAiStatisticsService.java          新增
    │   ├── impl/AiStatisticsServiceImpl.java  新增
    │   ├── IAiCostAnalysisService.java        新增
    │   └── impl/AiCostAnalysisServiceImpl.java 新增
    ├── domain/
    │   ├── StatisticsDaily.java               新增（日粒度聚合表）
    │   └── StatisticsHourly.java              新增（小时粒度聚合表）
    └── mapper/
        ├── StatisticsDailyMapper.java         新增
        └── StatisticsHourlyMapper.java        新增

定时任务：
└── AiStatisticsAggregateJob.java
    ├── 每小时整点：聚合上一小时数据 → statistics_hourly
    └── 每日凌晨1点：聚合前一天数据 → statistics_daily
```

### 1.3 数据流

```
IDE 插件
  └─ logAICall() ──→ POST /aiCallLog/create ──→ MySQL(ai_call_log) + ES(AiCallLogDoc)
                                                        │
                                        定时任务每小时聚合 ↓
                                   statistics_hourly / statistics_daily
                                                        │
                              实时指标直接查 Redis ←─────┘
                              UserOnlineRealtimeCount（已有）
                                                        │
                              前端轮询（5s） ←── AiStatisticsController
```

### 1.4 权限控制

| 角色 | 可见范围 |
|------|---------|
| 系统管理员（admin） | 全部用户、全部团队所有数据 |
| 团队负责人 | 仅本团队成员数据（后端 Service 层按 currentUser 角色过滤） |
| 普通用户 | 无权访问统计模块，菜单不显示 |

复用现有 `WorkspacePermission` + 角色体系，无需新增权限表。

---

## 二、数据库设计

### 2.1 statistics_hourly（小时粒度聚合）

```sql
CREATE TABLE statistics_hourly (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    stat_date       DATE        NOT NULL COMMENT '统计日期',
    stat_hour       TINYINT     NOT NULL COMMENT '统计小时(0-23)',
    user_email      VARCHAR(100) COMMENT '用户邮箱（NULL表示全局汇总）',
    team_id         BIGINT       COMMENT '团队ID（NULL表示全局汇总）',
    model           VARCHAR(50)  COMMENT '模型名称（NULL表示全模型汇总）',
    mode            VARCHAR(20)  COMMENT '调用模式 ask/code/architect/debug',
    total_calls     INT DEFAULT 0 COMMENT '总调用次数',
    success_calls   INT DEFAULT 0 COMMENT '成功次数',
    failed_calls    INT DEFAULT 0 COMMENT '失败次数',
    input_tokens    BIGINT DEFAULT 0 COMMENT '输入Token总量',
    output_tokens   BIGINT DEFAULT 0 COMMENT '输出Token总量',
    total_duration  BIGINT DEFAULT 0 COMMENT '总耗时(ms)',
    tool_calls      INT DEFAULT 0 COMMENT '包含工具调用的次数',
    created_time    DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_stat (stat_date, stat_hour, user_email, team_id, model, mode)
);
```

### 2.2 statistics_daily（日粒度聚合）

```sql
CREATE TABLE statistics_daily (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    stat_date       DATE        NOT NULL COMMENT '统计日期',
    user_email      VARCHAR(100) COMMENT '用户邮箱',
    team_id         BIGINT       COMMENT '团队ID',
    model           VARCHAR(50)  COMMENT '模型名称',
    mode            VARCHAR(20)  COMMENT '调用模式',
    knowledge_base_id VARCHAR(100) COMMENT '知识库ID',
    total_calls     INT DEFAULT 0,
    success_calls   INT DEFAULT 0,
    failed_calls    INT DEFAULT 0,
    input_tokens    BIGINT DEFAULT 0,
    output_tokens   BIGINT DEFAULT 0,
    total_cost      DECIMAL(10,4) DEFAULT 0 COMMENT '费用(元)',
    total_duration  BIGINT DEFAULT 0,
    avg_duration    INT DEFAULT 0 COMMENT '平均耗时(ms)',
    p95_duration    INT DEFAULT 0 COMMENT 'P95耗时(ms)',
    tool_calls      INT DEFAULT 0,
    completion_calls INT DEFAULT 0 COMMENT 'attempt_completion次数',
    created_time    DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_stat (stat_date, user_email, team_id, model, mode, knowledge_base_id)
);
```

### 2.3 model_rate_config（模型费率配置）

```sql
CREATE TABLE model_rate_config (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    model_name      VARCHAR(50) NOT NULL COMMENT '模型名称',
    input_rate      DECIMAL(10,6) NOT NULL COMMENT '输入Token单价(元/千token)',
    output_rate     DECIMAL(10,6) NOT NULL COMMENT '输出Token单价(元/千token)',
    currency        VARCHAR(10) DEFAULT 'CNY',
    enabled         TINYINT DEFAULT 1,
    updated_time    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_model (model_name)
);
```

---

## 三、后端 API 设计

### 3.1 AiStatisticsController — 基础路径 `/knowledge/statistics`

#### 实时监控数据
```
GET /realtime
Response: {
  onlineCount: number,            // 当前在线人数
  todayCalls: number,             // 今日总调用
  todaySuccessCalls: number,      // 今日成功
  todayTokens: { input, output }, // 今日Token
  todayErrorRate: number,         // 今日错误率(0~1)
  onlinePeak: { count, time },    // 今日在线峰值
  hourlyTrend: [{hour, success, failed}], // 今日各小时
  modeDistribution: [{mode, count}],
  modelDistribution: [{model, count}],
  featureTypeDistribution: [{featureType, name, count}], // AI功能分布（核心）
  recentCalls: [{time, userEmail, featureType, mode, model, tokens, durationMs, status}] // 最近50条
}
```

#### 使用统计报表
```
GET /usage?startDate=&endDate=&teamId=&userEmail=&featureType=
Response: {
  summary: { totalCalls, successRate, dau, totalTokens },
  callTrend: [{date, success, failed}],          // 日粒度趋势
  dauTrend: [{date, count}],                     // DAU趋势
  modeStackTrend: [{date, ask, code, architect, debug}],
  featureTypeDistribution: [                     // AI功能使用分布
    {featureType, name, count, ratio}
  ],
  featureTypeTrend: [{date, knowledge_qa, code_generation, ...}], // 各功能趋势
  toolRanking: [{toolName, count}],              // 工具调用Top10
  userRanking: [{userEmail, calls, tokens, lastActive, topFeature}],
  teamRanking: [{teamName, memberCount, calls, avgCalls, topFeature}]
}
```

#### 成本分析
```
GET /cost?startDate=&endDate=&dimension=model|user|team|kb
Response: {
  totalCost: number,
  monthOverMonth: number,          // 环比(正数涨/负数降)
  items: [{name, inputTokens, outputTokens, cost, ratio, trend}],
  costTrend: [{date, cost, byModel: {}}]
}
```

#### 效率分析
```
GET /efficiency?startDate=&endDate=&teamId=
Response: {
  avgTurns: number,               // 平均对话轮次
  toolCallRate: number,           // 工具调用率
  avgDuration: number,            // 平均响应时长(ms)
  p95Duration: number,
  completionRate: number,         // 任务完成率
  codeReview: {
    totalTasks, totalIssues,
    severityDist: [{level, count}],
    fixRate: number
  },
  commitTrend: [{date, avgCommits}]
}
```

#### 费率配置
```
GET  /config/rate                 查询所有模型费率
PUT  /config/rate                 保存费率（管理员专属）
Body: [{modelName, inputRate, outputRate}]
```

---

## 四、前端页面详细设计

### 4.1 实时监控看板（`/monitor/dashboard`）

**刷新策略：** 前端每 5 秒轮询 `/statistics/realtime`，使用 setInterval + 页面离开时 clearInterval。

**布局（从上到下）：**

```
┌─────────┬─────────┬─────────┬─────────┐
│当前在线  │今日调用  │今日Token │今日错误率│  ← 4个指标卡
└─────────┴─────────┴─────────┴─────────┘
┌─────────────────┬──────────┬──────────┐
│今日调用量趋势折线 │AI功能分布 │模型分布  │  ← 中部图表
│(按小时，双线)    │环形图     │饼图      │
│                 │(featureType)│        │
└─────────────────┴──────────┴──────────┘
┌────────────────────────────────────────┐
│ 实时调用流水表（最近50条）                │  ← 底部表格
│ 时间/用户/AI功能/模式/模型/Token/耗时/状态│
└────────────────────────────────────────┘
┌─────────────────┐
│ 在线峰值侧边信息  │  ← 右侧浮动卡片
│ 今日峰/当前/昨日  │
└─────────────────┘
```

**交互：** 点击流水表任意行 → 右侧抽屉弹出，展示该 traceId 的完整调用链路详情（含 featureType）。

---

### 4.2 使用统计报表（`/monitor/statistics`）

**顶部筛选栏：**
- 时间范围选择器：今日 / 本周 / 本月 / 自定义（日期范围）
- 团队下拉（管理员可见，团队负责人锁定为本团队）
- 用户搜索框（可选）
- **AI 功能类型** 下拉过滤（全部 / knowledge_qa / code_generation / code_debug / ...）

**布局（从上到下）：**

```
┌────────────────────────────────────────────────────┐
│ 汇总指标：总调用 / 成功率 / DAU / Token               │
└────────────────────────────────────────────────────┘
┌──────────────────────┬─────────────────────────────┐
│ 调用量趋势折线图       │ DAU 趋势折线图               │
└──────────────────────┴─────────────────────────────┘
┌──────────────────────┬─────────────────────────────┐
│ AI功能使用分布（环形图）│ AI功能趋势（堆叠面积图，按天）│
│ 各featureType占比     │ 识别功能增长/衰退趋势         │
└──────────────────────┴─────────────────────────────┘
┌──────────────────────┬─────────────────────────────┐
│ 模式堆叠柱状图         │ 工具调用 Top10 横向图         │
│ (ask/code/...)        │                             │
└──────────────────────┴─────────────────────────────┘
┌──────────────────────┬─────────────────────────────┐
│ 用户使用排行榜         │ 团队使用排行榜               │
│ 含「最常用功能」列     │ 含「最常用功能」列            │
│ 可点击展开用户详情     │ 可下钻到团队成员             │
└──────────────────────┴─────────────────────────────┘
```

**用户详情弹窗（点击用户行展开）：**
```
用户: zhang@company.com   本周调用: 128次   Token: 45,200
┌─────────────────────────────────────┐
│ 该用户功能使用分布饼图               │
│ 代码生成35% / 知识库问答28% / ...    │
└─────────────────────────────────────┘
最近10条问答摘要列表（requestSummary）
```

---

### 4.3 成本分析（`/monitor/cost`）

**顶部：** 本月总费用大字显示 + 环比箭头，超预算标红（预算阈值可配置）

**维度 Tab（model / user / team / knowledge_base）：**
每个 Tab 展示：名称 / 输入Token / 输出Token / 费用 / 占比进度条 / 趋势箭头

**底部：** 各模型费用叠加面积趋势图（按选定时间粒度）

**费率配置入口：** 右上角「费率配置」按钮 → 弹出 Dialog，表格编辑各模型的输入/输出单价。

---

### 4.4 效率分析（`/monitor/efficiency`）

**布局（三块）：**

```
┌──────────────────────────────────────┐
│ AI 使用深度指标                        │
│ 平均轮次 / 工具调用率 / 平均响应 / 完成率│
└──────────────────────────────────────┘
┌──────────────────┬───────────────────┐
│ 代码审查统计       │ 响应时长分布        │
│ 任务/问题/修复率   │ 均值/P95 折线趋势   │
└──────────────────┴───────────────────┘
┌──────────────────────────────────────┐
│ 日均提交次数趋势（人均，接入AI前后对比） │
└──────────────────────────────────────┘
```

---

## 五、关键实现细节

### 5.1 成本计算
```java
// 费用 = (inputTokens / 1000) × inputRate + (outputTokens / 1000) × outputRate
BigDecimal cost = inputTokens.divide(BigDecimal.valueOf(1000))
    .multiply(rate.getInputRate())
    .add(outputTokens.divide(BigDecimal.valueOf(1000))
    .multiply(rate.getOutputRate()));
```
费率从 `model_rate_config` 表读取，查询时 join 计算，写入 `statistics_daily.total_cost`。

### 5.2 定时任务（AiStatisticsAggregateJob）

```
每小时任务（cron: 0 5 * * * ?）：
  SELECT date, hour, user_email, team_id, model, mode,
         COUNT(*) as calls, SUM(input_tokens), ...
  FROM ai_call_log
  WHERE create_time BETWEEN [上一小时开始, 上一小时结束]
  GROUP BY date, hour, user_email, model, mode
  → INSERT OR UPDATE statistics_hourly

每日任务（cron: 0 0 1 * * ?）：
  汇总前一日 statistics_hourly → statistics_daily
  同时计算 avg_duration / p95_duration / total_cost
```

### 5.3 实时数据策略
- 在线人数：直接读 Redis 的 `UserOnlineRealtimeCount`（已有）
- 今日汇总：读 `statistics_hourly` 的今日累计
- 最近50条调用流水：直接查 MySQL `ai_call_log` 按时间倒序 LIMIT 50
- 前端轮询间隔 5 秒，页面隐藏时暂停轮询（Page Visibility API）

### 5.4 团队负责人数据隔离
```java
// Service 层统一过滤
if (!currentUser.isAdmin()) {
    List<String> teamMemberEmails = workspacePermissionService
        .getTeamMemberEmails(currentUser.getTeamId());
    queryWrapper.in("user_email", teamMemberEmails);
}
```

---

## 六、API 文件结构（前端）

```
ui/src/api/monitor/
├── statistics.js    实时监控 + 使用统计
├── cost.js          成本分析 + 费率配置
└── efficiency.js    效率分析

ui/src/views/monitor/
├── dashboard/
│   └── index.vue    实时监控看板
├── statistics/
│   └── index.vue    使用统计报表
├── cost/
│   └── index.vue    成本分析
└── efficiency/
    └── index.vue    效率分析
```
