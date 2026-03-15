# 用户行为分析功能设计规范

**日期**：2026-03-15
**状态**：已确认
**范围**：后端 API + 管理端 UI + IDE 插件埋点

---

## 一、目标与背景

在现有监控体系（用户在线状态、AI查询记录、代码审查统计、代码提交统计）基础上，新增**用户行为分析**模块，覆盖：

- **企业管理员视角**：了解团队成员 IDE 使用情况（活跃度、在线时长、任务完成率）
- **产品运营视角**：了解功能使用热度、用户路径，指导产品迭代

**不需要**：数据导出、告警功能（只需可视化看板）。

---

## 二、整体架构

```
IDE 插件（maxian）
  BehaviorReporter（新增）
  ├── SESSION_START / SESSION_END
  ├── TASK_START / TASK_END
  ├── TOOL_USE
  ├── FEATURE_VIEW / FEATURE_LEAVE
  └── AI_CALL
        │ 实时 POST /behavior/event
        ▼
后端 API（boyo-knowledge）
  BehaviorEventController  → 写入原始事件表
  t_user_behavior_event    → 原始事件存储
        │
  @Scheduled 每小时聚合   → t_user_behavior_stats（小时聚合）
  @Scheduled 每日聚合     → t_user_behavior_daily（日汇总）
  @Scheduled 每小时同步   → 从 user_online_status 同步在线时长
        │
  BehaviorStatsController  → 管理端查询接口
        │
管理端 UI（Vue + Element Plus）
  /knowledge/behaviorStats          用户行为分析看板
  /knowledge/behaviorStats/user     用户行为详情页
```

---

## 三、数据库表设计

### 3.1 原始事件表 `t_user_behavior_event`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint PK | 自增主键 |
| user_id | bigint | 用户ID |
| user_name | varchar(64) | 用户名 |
| dept_id | bigint | 部门ID |
| client_id | varchar(64) | 客户端唯一标识（复用现有） |
| session_id | varchar(64) | 会话ID（IDE启动到关闭为一次会话） |
| event_type | varchar(32) | 事件类型 |
| feature_code | varchar(64) | 功能模块编码 |
| extra_data | json | 事件附加数据 |
| client_ts | bigint | 客户端事件时间戳（毫秒） |
| create_time | datetime | 服务端接收时间 |

**event_type 枚举：**

| 值 | 说明 |
|---|---|
| SESSION_START | 会话开始（IDE激活/登录） |
| SESSION_END | 会话结束（IDE关闭/失活） |
| TASK_START | 任务创建 |
| TASK_END | 任务结束（extra_data含status: success/failed/aborted） |
| TOOL_USE | 工具调用（extra_data含工具名） |
| FEATURE_VIEW | 功能模块进入 |
| FEATURE_LEAVE | 功能模块离开（用于计算停留时长） |
| AI_CALL | AI模型调用（extra_data含model, tokens, cost, latency, success） |

**featureCode 编码规范：**

| 值 | 说明 |
|---|---|
| chat | 对话功能 |
| codeReview | 代码审查 |
| commitStats | 提交统计 |
| knowledge | 知识库 |
| projectBoard | 项目看板 |
| settings | 设置页 |

---

### 3.2 小时聚合表 `t_user_behavior_stats`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint PK | |
| stat_date | date | 统计日期 |
| stat_hour | tinyint | 统计小时（0-23） |
| user_id | bigint | 用户ID |
| dept_id | bigint | 部门ID |
| session_count | int | 会话次数 |
| session_duration | bigint | 会话总时长（秒） |
| online_duration | bigint | 在线时长（秒，从心跳推算） |
| task_count | int | 任务创建数 |
| task_success_count | int | 任务成功数 |
| task_failed_count | int | 任务失败数 |
| tool_use_count | int | 工具调用总次数 |
| ai_call_count | int | AI调用次数 |
| ai_tokens_in | bigint | 输入Token总量 |
| ai_tokens_out | bigint | 输出Token总量 |
| ai_cost | decimal(10,4) | AI调用成本（元） |
| ai_success_count | int | AI调用成功次数 |
| feature_stats | json | 各功能模块使用次数和停留时长 |
| create_time | datetime | |

---

### 3.3 每日汇总表 `t_user_behavior_daily`

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint PK | |
| stat_date | date | 统计日期 |
| dau | int | 日活跃用户数 |
| new_user_count | int | 新增用户数 |
| avg_session_duration | bigint | 平均会话时长（秒） |
| total_online_duration | bigint | 全平台在线总时长（秒） |
| avg_online_duration | bigint | 人均在线时长（秒） |
| total_task_count | int | 全平台任务总数 |
| task_success_rate | decimal(5,2) | 任务成功率 |
| total_ai_calls | int | 全平台AI调用总次数 |
| total_ai_tokens | bigint | 全平台Token总消耗 |
| total_ai_cost | decimal(12,4) | 全平台AI总成本 |
| ai_success_rate | decimal(5,2) | AI调用成功率 |
| feature_heat | json | 功能热度排行（{feature, uv, pv, avg_duration}） |
| model_stats | json | 按模型分类的调用量统计 |
| create_time | datetime | |

---

## 四、后端接口设计

### 4.1 数据上报接口（IDE插件调用）

**POST `/behavior/event`**

请求体：
```json
{
  "sessionId": "sess_xxx",
  "eventType": "AI_CALL",
  "featureCode": "chat",
  "clientTs": 1710000000000,
  "extraData": {
    "model": "claude-sonnet-4-6",
    "tokensIn": 1200,
    "tokensOut": 800,
    "cost": 0.0032,
    "latencyMs": 1850,
    "success": true
  }
}
```

---

### 4.2 管理端查询接口

| 方法 | 路径 | 说明 | 主要参数 |
|------|------|------|------|
| GET | `/behavior/stats/overview` | 看板KPI总览 | startDate, endDate, deptId |
| GET | `/behavior/stats/trend` | 趋势图数据 | startDate, endDate, granularity(day/hour) |
| GET | `/behavior/stats/feature-heat` | 功能使用热度排行 | startDate, endDate, deptId |
| GET | `/behavior/stats/user-list` | 用户活跃度明细（分页） | startDate, endDate, deptId, pageNum, pageSize |
| GET | `/behavior/stats/user-detail` | 单用户行为详情 | userId, startDate, endDate |
| GET | `/behavior/stats/ai-summary` | AI调用量汇总 | startDate, endDate, groupBy(model/day) |
| GET | `/behavior/stats/online-duration` | 在线时长统计 | startDate, endDate, groupBy(dept/user) |

**`/overview` 响应示例：**
```json
{
  "dau": 128,
  "dauGrowth": 12.5,
  "avgOnlineDuration": 7200,
  "avgOnlineDurationGrowth": 8.3,
  "totalAiCalls": 3420,
  "aiCallsGrowth": 9.2,
  "aiCost": 12.86,
  "aiCostGrowth": 7.1,
  "taskSuccessRate": 94.3,
  "activeUserCount7d": 356,
  "activeUserCount30d": 892,
  "newUserToday": 5
}
```

**`/trend` 响应示例：**
```json
{
  "dates": ["2026-03-09", "2026-03-10", "2026-03-11"],
  "dau": [102, 118, 128],
  "onlineDuration": [720000, 850000, 920000],
  "aiCalls": [2800, 3100, 3420],
  "aiCost": [9.8, 11.2, 12.86]
}
```

---

### 4.3 定时聚合任务

| 任务名 | 触发时间 | 操作 |
|------|------|------|
| `hourlyAggregate` | 每小时05分 | 聚合上一小时原始事件 → `t_user_behavior_stats` |
| `dailyAggregate` | 每天00:10 | 聚合昨日小时数据 → `t_user_behavior_daily` |
| `onlineDurationSync` | 每小时10分 | 从 `user_online_status` 心跳同步在线时长 |

---

## 五、管理端看板 UI 设计

### 5.1 路由

```
/knowledge/behaviorStats          用户行为分析看板
/knowledge/behaviorStats/user     用户行为详情页
```

### 5.2 主看板布局

**筛选栏**：时间范围、部门、用户 三个筛选条件

**KPI 卡片区（8个）**：

| 卡片 | 指标 | 含环比增长率 |
|------|------|------|
| 日活用户 | DAU | ✓ |
| 人均在线时长 | avg_online_duration | ✓ |
| AI调用总量 | total_ai_calls | ✓ |
| AI总成本 | total_ai_cost | ✓ |
| 任务成功率 | task_success_rate | - |
| 周活用户 | WAU | - |
| 月活用户 | MAU | - |
| 今日新增用户 | new_user_today | - |

**图表区（4个）**：

| 图表 | 类型 | 数据来源 |
|------|------|------|
| 活跃趋势 | 折线图（DAU/AI调用/在线时长三条线，日/周/月切换） | `/trend` |
| 功能使用热度 | 横向柱状图（按PV排序） | `/feature-heat` |
| AI调用量分析 | 堆叠柱状图（按模型分色） | `/ai-summary` |
| 在线时长分布 | 柱状图（按部门排序） | `/online-duration` |

**明细表格**：

| 列 | 说明 |
|---|---|
| 用户名 | 可点击进入详情页 |
| 部门 | |
| 在线时长 | 格式化为 Xh Xmin |
| 任务数 | |
| 任务成功率 | |
| AI调用次数 | |
| 最后活跃时间 | 相对时间（X分钟前） |

---

### 5.3 用户详情页布局

**头部**：返回按钮 + 用户名/部门 + 最后活跃时间

**KPI 卡片**：累计在线时长、累计任务数、成功率、累计AI调用/成本

**图表区**：
- 每日在线时长趋势（折线图，近30天）
- 功能使用频次（饼图）
- 任务状态分布（饼图：成功/失败/中断）

**操作时间线**：按天折叠，展示当天事件序列（SESSION_START → FEATURE_VIEW → TASK_START/END → AI_CALL）

---

## 六、IDE 插件端埋点设计

### 6.1 新增模块

**文件**：`src/vs/workbench/contrib/maxian/browser/behaviorReporter.ts`

**接口定义**：
```typescript
enum BehaviorEventType {
  SESSION_START = 'SESSION_START',
  SESSION_END   = 'SESSION_END',
  TASK_START    = 'TASK_START',
  TASK_END      = 'TASK_END',
  TOOL_USE      = 'TOOL_USE',
  FEATURE_VIEW  = 'FEATURE_VIEW',
  FEATURE_LEAVE = 'FEATURE_LEAVE',
  AI_CALL       = 'AI_CALL',
}

class BehaviorReporter {
  private sessionId: string;
  private featureEnterTs: number;

  report(eventType: BehaviorEventType, featureCode?: string, extraData?: object): void
  reportSessionStart(): void
  reportSessionEnd(): void
  reportTaskStart(taskId: string): void
  reportTaskEnd(taskId: string, status: 'success' | 'failed' | 'aborted'): void
  reportToolUse(toolName: string): void
  reportFeatureView(featureCode: string): void
  reportFeatureLeave(featureCode: string): void
  reportAiCall(model: string, tokensIn: number, tokensOut: number, cost: number, latencyMs: number, success: boolean): void
}
```

### 6.2 埋点挂载位置

| 埋点 | 文件 | 挂载位置 |
|------|------|------|
| SESSION_START | `maxianService.ts` | `initialize()` 完成后 |
| SESSION_END | `maxianService.ts` | `dispose()` 时 |
| TASK_START | `TaskService.ts` | `startTask()` 主循环开始前 |
| TASK_END | `TaskService.ts` | `finishTask()` 完成/中断时 |
| TOOL_USE | `toolExecutorImpl.ts` | 各 case 入口处 |
| AI_CALL | `TaskService.ts` | Claude API 响应返回后 |
| FEATURE_VIEW | `maxianView.ts` | Tab 切换时（进入） |
| FEATURE_LEAVE | `maxianView.ts` | Tab 切换时（离开） |

---

## 七、后端代码结构规划

```
boyo-knowledge/src/main/java/com/boyo/knowledge/
├── domain/
│   ├── UserBehaviorEvent.java        原始事件实体
│   ├── UserBehaviorStats.java        小时聚合实体
│   └── UserBehaviorDaily.java        日汇总实体
├── controller/
│   ├── BehaviorEventController.java  上报接口
│   └── BehaviorStatsController.java  查询接口
├── service/
│   ├── IBehaviorEventService.java
│   ├── IBehaviorStatsService.java
│   └── impl/
│       ├── BehaviorEventServiceImpl.java
│       └── BehaviorStatsServiceImpl.java
├── mapper/
│   ├── UserBehaviorEventMapper.java
│   ├── UserBehaviorStatsMapper.java
│   └── UserBehaviorDailyMapper.java
└── task/
    └── BehaviorAggregateTask.java    定时聚合任务
```
