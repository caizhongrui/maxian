# 用户行为分析功能实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现完整的用户行为分析功能，包含后端数据采集/聚合/查询、管理端看板、IDE插件埋点三层。

**Architecture:** IDE插件通过 BehaviorReporter 实时上报行为事件到后端，后端原始事件表按小时/天定时聚合为统计表，管理端从聚合表查询展示看板。

**Tech Stack:** 后端：Spring Boot + MyBatis Plus + Sa-Token + MySQL；前端：Vue 3 + Element Plus + ECharts；IDE插件：TypeScript + VS Code API

**Spec:** `docs/superpowers/specs/2026-03-15-user-behavior-analytics-design.md`

---

## Chunk 1: 后端 - 数据库建表 + 实体类

### Task 1: 创建数据库表

**Files:**
- Create: `boyo-knowledge/src/main/resources/db/behavior_tables.sql`（路径：`/Users/caizhongrui/Documents/workspace/qdport/ai/qdport-ai-api/boyo-knowledge/src/main/resources/db/behavior_tables.sql`）

- [ ] **Step 1: 创建 SQL 文件**

```sql
-- 原始事件表
CREATE TABLE IF NOT EXISTS `t_user_behavior_event` (
  `id`           bigint(20) NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id`      bigint(20) DEFAULT NULL COMMENT '用户ID',
  `user_name`    varchar(64) DEFAULT NULL COMMENT '用户名',
  `dept_id`      bigint(20) DEFAULT NULL COMMENT '部门ID',
  `client_id`    varchar(64) DEFAULT NULL COMMENT '客户端唯一标识',
  `session_id`   varchar(64) DEFAULT NULL COMMENT '会话ID',
  `event_type`   varchar(32) NOT NULL COMMENT '事件类型(SESSION_START/SESSION_END/TASK_START/TASK_END/TOOL_USE/FEATURE_VIEW/FEATURE_LEAVE/AI_CALL)',
  `feature_code` varchar(64) DEFAULT NULL COMMENT '功能模块编码(chat/codeReview/commitStats/knowledge/projectBoard/settings)',
  `extra_data`   json DEFAULT NULL COMMENT '事件附加数据',
  `client_ts`    bigint(20) DEFAULT NULL COMMENT '客户端事件时间戳(毫秒)',
  `create_time`  datetime DEFAULT CURRENT_TIMESTAMP COMMENT '服务端接收时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_session_id` (`session_id`),
  KEY `idx_event_type` (`event_type`),
  KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户行为原始事件表';

-- 小时聚合表
CREATE TABLE IF NOT EXISTS `t_user_behavior_stats` (
  `id`                  bigint(20) NOT NULL AUTO_INCREMENT,
  `stat_date`           date NOT NULL COMMENT '统计日期',
  `stat_hour`           tinyint(4) NOT NULL COMMENT '统计小时(0-23)',
  `user_id`             bigint(20) NOT NULL COMMENT '用户ID',
  `dept_id`             bigint(20) DEFAULT NULL COMMENT '部门ID',
  `session_count`       int(11) DEFAULT 0 COMMENT '会话次数',
  `session_duration`    bigint(20) DEFAULT 0 COMMENT '会话总时长(秒)',
  `online_duration`     bigint(20) DEFAULT 0 COMMENT '在线时长(秒)',
  `task_count`          int(11) DEFAULT 0 COMMENT '任务创建数',
  `task_success_count`  int(11) DEFAULT 0 COMMENT '任务成功数',
  `task_failed_count`   int(11) DEFAULT 0 COMMENT '任务失败数',
  `tool_use_count`      int(11) DEFAULT 0 COMMENT '工具调用总次数',
  `ai_call_count`       int(11) DEFAULT 0 COMMENT 'AI调用次数',
  `ai_tokens_in`        bigint(20) DEFAULT 0 COMMENT '输入Token总量',
  `ai_tokens_out`       bigint(20) DEFAULT 0 COMMENT '输出Token总量',
  `ai_cost`             decimal(10,4) DEFAULT 0.0000 COMMENT 'AI调用成本(元)',
  `ai_success_count`    int(11) DEFAULT 0 COMMENT 'AI调用成功次数',
  `feature_stats`       json DEFAULT NULL COMMENT '各功能模块使用次数和停留时长',
  `create_time`         datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_date_hour_user` (`stat_date`, `stat_hour`, `user_id`),
  KEY `idx_stat_date` (`stat_date`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_dept_id` (`dept_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户行为小时聚合表';

-- 每日汇总表
CREATE TABLE IF NOT EXISTS `t_user_behavior_daily` (
  `id`                   bigint(20) NOT NULL AUTO_INCREMENT,
  `stat_date`            date NOT NULL COMMENT '统计日期',
  `dau`                  int(11) DEFAULT 0 COMMENT '日活跃用户数',
  `new_user_count`       int(11) DEFAULT 0 COMMENT '新增用户数',
  `avg_session_duration` bigint(20) DEFAULT 0 COMMENT '平均会话时长(秒)',
  `total_online_duration` bigint(20) DEFAULT 0 COMMENT '全平台在线总时长(秒)',
  `avg_online_duration`  bigint(20) DEFAULT 0 COMMENT '人均在线时长(秒)',
  `total_task_count`     int(11) DEFAULT 0 COMMENT '全平台任务总数',
  `task_success_rate`    decimal(5,2) DEFAULT 0.00 COMMENT '任务成功率',
  `total_ai_calls`       int(11) DEFAULT 0 COMMENT '全平台AI调用总次数',
  `total_ai_tokens`      bigint(20) DEFAULT 0 COMMENT '全平台Token总消耗',
  `total_ai_cost`        decimal(12,4) DEFAULT 0.0000 COMMENT '全平台AI总成本',
  `ai_success_rate`      decimal(5,2) DEFAULT 0.00 COMMENT 'AI调用成功率',
  `feature_heat`         json DEFAULT NULL COMMENT '功能热度排行({feature,uv,pv,avg_duration})',
  `model_stats`          json DEFAULT NULL COMMENT '按模型分类的调用量统计',
  `create_time`          datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_stat_date` (`stat_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户行为每日汇总表';
```

- [ ] **Step 2: 在数据库中执行 SQL**

```bash
mysql -u root -p your_db_name < behavior_tables.sql
```

- [ ] **Step 3: 验证表创建成功**

```sql
SHOW TABLES LIKE 't_user_behavior%';
-- 应返回3张表
```

---

### Task 2: 创建实体类

**Files:**
- Create: `boyo-knowledge/src/main/java/com/boyo/knowledge/domain/UserBehaviorEvent.java`
- Create: `boyo-knowledge/src/main/java/com/boyo/knowledge/domain/UserBehaviorStats.java`
- Create: `boyo-knowledge/src/main/java/com/boyo/knowledge/domain/UserBehaviorDaily.java`

路径前缀：`/Users/caizhongrui/Documents/workspace/qdport/ai/qdport-ai-api/boyo-knowledge/src/main/java/com/boyo/knowledge/`

- [ ] **Step 1: 创建 UserBehaviorEvent.java**

```java
package com.boyo.knowledge.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import com.baomidou.mybatisplus.annotation.TableField;
import lombok.Data;
import java.time.LocalDateTime;
import java.util.Map;

@Data
@TableName(value = "t_user_behavior_event", autoResultMap = true)
public class UserBehaviorEvent {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long userId;
    private String userName;
    private Long deptId;
    private String clientId;
    private String sessionId;
    private String eventType;
    private String featureCode;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> extraData;

    private Long clientTs;
    private LocalDateTime createTime;
}
```

- [ ] **Step 2: 创建 UserBehaviorStats.java**

```java
package com.boyo.knowledge.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Map;

@Data
@TableName(value = "t_user_behavior_stats", autoResultMap = true)
public class UserBehaviorStats {

    @TableId(type = IdType.AUTO)
    private Long id;

    private LocalDate statDate;
    private Integer statHour;
    private Long userId;
    private Long deptId;

    private Integer sessionCount;
    private Long sessionDuration;
    private Long onlineDuration;
    private Integer taskCount;
    private Integer taskSuccessCount;
    private Integer taskFailedCount;
    private Integer toolUseCount;
    private Integer aiCallCount;
    private Long aiTokensIn;
    private Long aiTokensOut;
    private BigDecimal aiCost;
    private Integer aiSuccessCount;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private Map<String, Object> featureStats;

    private LocalDateTime createTime;
}
```

- [ ] **Step 3: 创建 UserBehaviorDaily.java**

```java
package com.boyo.knowledge.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler;
import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Data
@TableName(value = "t_user_behavior_daily", autoResultMap = true)
public class UserBehaviorDaily {

    @TableId(type = IdType.AUTO)
    private Long id;

    private LocalDate statDate;
    private Integer dau;
    private Integer newUserCount;
    private Long avgSessionDuration;
    private Long totalOnlineDuration;
    private Long avgOnlineDuration;
    private Integer totalTaskCount;
    private BigDecimal taskSuccessRate;
    private Integer totalAiCalls;
    private Long totalAiTokens;
    private BigDecimal totalAiCost;
    private BigDecimal aiSuccessRate;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<Map<String, Object>> featureHeat;

    @TableField(typeHandler = JacksonTypeHandler.class)
    private List<Map<String, Object>> modelStats;

    private LocalDateTime createTime;
}
```

- [ ] **Step 4: 提交**

```bash
git add .
git commit -m "feat: 添加用户行为分析实体类(Event/Stats/Daily)"
```

---

## Chunk 2: 后端 - Mapper + 事件上报接口

### Task 3: 创建 Mapper

**Files:**
- Create: `domain/mapper/UserBehaviorEventMapper.java`
- Create: `domain/mapper/UserBehaviorStatsMapper.java`
- Create: `domain/mapper/UserBehaviorDailyMapper.java`
- Create: `resources/mapper/UserBehaviorStatsMapper.xml`
- Create: `resources/mapper/UserBehaviorDailyMapper.xml`

路径前缀：`/Users/caizhongrui/Documents/workspace/qdport/ai/qdport-ai-api/boyo-knowledge/src/main/java/com/boyo/knowledge/mapper/`

- [ ] **Step 1: 创建 UserBehaviorEventMapper.java**

```java
package com.boyo.knowledge.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.boyo.knowledge.domain.UserBehaviorEvent;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface UserBehaviorEventMapper extends BaseMapper<UserBehaviorEvent> {

    /**
     * 查询指定时间范围内的原始事件（供聚合任务使用）
     */
    List<UserBehaviorEvent> selectByTimeRange(
        @Param("startTime") LocalDateTime startTime,
        @Param("endTime") LocalDateTime endTime
    );
}
```

- [ ] **Step 2: 创建 UserBehaviorStatsMapper.java**

```java
package com.boyo.knowledge.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.boyo.knowledge.domain.UserBehaviorStats;
import com.boyo.knowledge.domain.vo.BehaviorUserListVo;
import com.boyo.knowledge.domain.vo.BehaviorOnlineDurationVo;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.time.LocalDate;
import java.util.List;

@Mapper
public interface UserBehaviorStatsMapper extends BaseMapper<UserBehaviorStats> {

    /** 用户活跃度明细列表（分页用，带部门筛选） */
    List<BehaviorUserListVo> selectUserList(
        @Param("startDate") LocalDate startDate,
        @Param("endDate") LocalDate endDate,
        @Param("deptId") Long deptId,
        @Param("userId") Long userId
    );

    /** 单用户统计汇总（用于详情页KPI） */
    BehaviorUserListVo selectUserSummary(
        @Param("userId") Long userId,
        @Param("startDate") LocalDate startDate,
        @Param("endDate") LocalDate endDate
    );

    /** 在线时长统计（按部门分组） */
    List<BehaviorOnlineDurationVo> selectOnlineDurationByDept(
        @Param("startDate") LocalDate startDate,
        @Param("endDate") LocalDate endDate
    );

    /** 在线时长统计（按用户分组） */
    List<BehaviorOnlineDurationVo> selectOnlineDurationByUser(
        @Param("startDate") LocalDate startDate,
        @Param("endDate") LocalDate endDate,
        @Param("deptId") Long deptId
    );

    /** 功能热度统计 */
    List<java.util.Map<String, Object>> selectFeatureHeat(
        @Param("startDate") LocalDate startDate,
        @Param("endDate") LocalDate endDate,
        @Param("deptId") Long deptId
    );

    /** AI调用汇总（按模型） */
    List<java.util.Map<String, Object>> selectAiSummaryByModel(
        @Param("startDate") LocalDate startDate,
        @Param("endDate") LocalDate endDate
    );

    /** AI调用汇总（按天） */
    List<java.util.Map<String, Object>> selectAiSummaryByDay(
        @Param("startDate") LocalDate startDate,
        @Param("endDate") LocalDate endDate
    );
}
```

- [ ] **Step 3: 创建 UserBehaviorDailyMapper.java**

```java
package com.boyo.knowledge.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.boyo.knowledge.domain.UserBehaviorDaily;
import com.boyo.knowledge.domain.vo.BehaviorTrendVo;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.time.LocalDate;
import java.util.List;

@Mapper
public interface UserBehaviorDailyMapper extends BaseMapper<UserBehaviorDaily> {

    /** 趋势数据（多天） */
    List<BehaviorTrendVo> selectTrend(
        @Param("startDate") LocalDate startDate,
        @Param("endDate") LocalDate endDate
    );
}
```

- [ ] **Step 4: 创建 VO 类**

路径：`/Users/caizhongrui/Documents/workspace/qdport/ai/qdport-ai-api/boyo-knowledge/src/main/java/com/boyo/knowledge/domain/vo/`

**BehaviorOverviewVo.java**：
```java
package com.boyo.knowledge.domain.vo;

import lombok.Data;

@Data
public class BehaviorOverviewVo {
    private Integer dau;
    private Double dauGrowth;
    private Long avgOnlineDuration;
    private Double avgOnlineDurationGrowth;
    private Integer totalAiCalls;
    private Double aiCallsGrowth;
    private java.math.BigDecimal aiCost;
    private Double aiCostGrowth;
    private java.math.BigDecimal taskSuccessRate;
    private Integer activeUserCount7d;
    private Integer activeUserCount30d;
    private Integer newUserToday;
}
```

**BehaviorTrendVo.java**：
```java
package com.boyo.knowledge.domain.vo;

import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDate;

@Data
public class BehaviorTrendVo {
    private LocalDate statDate;
    private Integer dau;
    private Long totalOnlineDuration;
    private Integer totalAiCalls;
    private BigDecimal totalAiCost;
    private Integer totalTaskCount;
    private BigDecimal taskSuccessRate;
}
```

**BehaviorUserListVo.java**：
```java
package com.boyo.knowledge.domain.vo;

import lombok.Data;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
public class BehaviorUserListVo {
    private Long userId;
    private String userName;
    private Long deptId;
    private String deptName;
    private Long onlineDuration;       // 在线时长（秒）
    private Integer taskCount;
    private Integer taskSuccessCount;
    private BigDecimal taskSuccessRate;
    private Integer aiCallCount;
    private LocalDateTime lastActiveTime;
}
```

**BehaviorOnlineDurationVo.java**：
```java
package com.boyo.knowledge.domain.vo;

import lombok.Data;

@Data
public class BehaviorOnlineDurationVo {
    private Long userId;
    private String userName;
    private Long deptId;
    private String deptName;
    private Long totalOnlineDuration;  // 秒
    private Integer activeDays;
}
```

- [ ] **Step 5: 创建 UserBehaviorStatsMapper.xml**

路径：`/Users/caizhongrui/Documents/workspace/qdport/ai/qdport-ai-api/boyo-knowledge/src/main/resources/mapper/UserBehaviorStatsMapper.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.boyo.knowledge.mapper.UserBehaviorStatsMapper">

    <resultMap id="UserListVoMap" type="com.boyo.knowledge.domain.vo.BehaviorUserListVo">
        <result column="user_id" property="userId"/>
        <result column="user_name" property="userName"/>
        <result column="dept_id" property="deptId"/>
        <result column="dept_name" property="deptName"/>
        <result column="online_duration" property="onlineDuration"/>
        <result column="task_count" property="taskCount"/>
        <result column="task_success_count" property="taskSuccessCount"/>
        <result column="task_success_rate" property="taskSuccessRate"/>
        <result column="ai_call_count" property="aiCallCount"/>
        <result column="last_active_time" property="lastActiveTime"/>
    </resultMap>

    <select id="selectUserList" resultMap="UserListVoMap">
        SELECT
            s.user_id,
            s.user_name,
            s.dept_id,
            d.dept_name,
            SUM(s.online_duration) AS online_duration,
            SUM(s.task_count) AS task_count,
            SUM(s.task_success_count) AS task_success_count,
            CASE WHEN SUM(s.task_count) > 0
                THEN ROUND(SUM(s.task_success_count) * 100.0 / SUM(s.task_count), 2)
                ELSE 0 END AS task_success_rate,
            SUM(s.ai_call_count) AS ai_call_count,
            MAX(e.create_time) AS last_active_time
        FROM t_user_behavior_stats s
        LEFT JOIN sys_dept d ON d.dept_id = s.dept_id
        LEFT JOIN (
            SELECT user_id, MAX(create_time) AS create_time
            FROM t_user_behavior_event
            GROUP BY user_id
        ) e ON e.user_id = s.user_id
        WHERE s.stat_date BETWEEN #{startDate} AND #{endDate}
        <if test="deptId != null">
            AND s.dept_id = #{deptId}
        </if>
        <if test="userId != null">
            AND s.user_id = #{userId}
        </if>
        GROUP BY s.user_id, s.user_name, s.dept_id, d.dept_name
        ORDER BY online_duration DESC
    </select>

    <select id="selectUserSummary" resultMap="UserListVoMap">
        SELECT
            s.user_id,
            s.user_name,
            s.dept_id,
            SUM(s.online_duration) AS online_duration,
            SUM(s.task_count) AS task_count,
            SUM(s.task_success_count) AS task_success_count,
            CASE WHEN SUM(s.task_count) > 0
                THEN ROUND(SUM(s.task_success_count) * 100.0 / SUM(s.task_count), 2)
                ELSE 0 END AS task_success_rate,
            SUM(s.ai_call_count) AS ai_call_count
        FROM t_user_behavior_stats s
        WHERE s.user_id = #{userId}
          AND s.stat_date BETWEEN #{startDate} AND #{endDate}
        GROUP BY s.user_id, s.user_name, s.dept_id
    </select>

    <select id="selectOnlineDurationByDept" resultType="com.boyo.knowledge.domain.vo.BehaviorOnlineDurationVo">
        SELECT
            s.dept_id,
            d.dept_name,
            SUM(s.online_duration) AS totalOnlineDuration,
            COUNT(DISTINCT s.user_id) AS activeDays
        FROM t_user_behavior_stats s
        LEFT JOIN sys_dept d ON d.dept_id = s.dept_id
        WHERE s.stat_date BETWEEN #{startDate} AND #{endDate}
        GROUP BY s.dept_id, d.dept_name
        ORDER BY totalOnlineDuration DESC
    </select>

    <select id="selectOnlineDurationByUser" resultType="com.boyo.knowledge.domain.vo.BehaviorOnlineDurationVo">
        SELECT
            s.user_id,
            s.user_name,
            s.dept_id,
            SUM(s.online_duration) AS totalOnlineDuration,
            COUNT(DISTINCT s.stat_date) AS activeDays
        FROM t_user_behavior_stats s
        WHERE s.stat_date BETWEEN #{startDate} AND #{endDate}
        <if test="deptId != null">
            AND s.dept_id = #{deptId}
        </if>
        GROUP BY s.user_id, s.user_name, s.dept_id
        ORDER BY totalOnlineDuration DESC
    </select>

    <select id="selectFeatureHeat" resultType="java.util.Map">
        SELECT
            JSON_UNQUOTE(JSON_EXTRACT(feature_stats_item.value, '$.featureCode')) AS feature,
            COUNT(DISTINCT s.user_id) AS uv,
            SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(feature_stats_item.value, '$.viewCount')) AS UNSIGNED)) AS pv,
            AVG(CAST(JSON_UNQUOTE(JSON_EXTRACT(feature_stats_item.value, '$.avgDuration')) AS UNSIGNED)) AS avg_duration
        FROM t_user_behavior_stats s,
             JSON_TABLE(s.feature_stats, '$[*]' COLUMNS (value JSON PATH '$')) AS feature_stats_item
        WHERE s.stat_date BETWEEN #{startDate} AND #{endDate}
        <if test="deptId != null">
            AND s.dept_id = #{deptId}
        </if>
        GROUP BY feature
        ORDER BY pv DESC
    </select>

    <select id="selectAiSummaryByModel" resultType="java.util.Map">
        SELECT
            JSON_UNQUOTE(JSON_EXTRACT(e.extra_data, '$.model')) AS model,
            COUNT(*) AS callCount,
            SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(e.extra_data, '$.tokensIn')) AS UNSIGNED)) AS tokensIn,
            SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(e.extra_data, '$.tokensOut')) AS UNSIGNED)) AS tokensOut,
            SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(e.extra_data, '$.cost')) AS DECIMAL(10,4))) AS cost
        FROM t_user_behavior_event e
        WHERE e.event_type = 'AI_CALL'
          AND DATE(e.create_time) BETWEEN #{startDate} AND #{endDate}
        GROUP BY model
        ORDER BY callCount DESC
    </select>

    <select id="selectAiSummaryByDay" resultType="java.util.Map">
        SELECT
            DATE(e.create_time) AS statDate,
            COUNT(*) AS callCount,
            SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(e.extra_data, '$.tokensIn')) AS UNSIGNED)) AS tokensIn,
            SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(e.extra_data, '$.tokensOut')) AS UNSIGNED)) AS tokensOut,
            SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(e.extra_data, '$.cost')) AS DECIMAL(10,4))) AS cost
        FROM t_user_behavior_event e
        WHERE e.event_type = 'AI_CALL'
          AND DATE(e.create_time) BETWEEN #{startDate} AND #{endDate}
        GROUP BY DATE(e.create_time)
        ORDER BY statDate
    </select>

</mapper>
```

- [ ] **Step 6: 创建 UserBehaviorDailyMapper.xml**

路径：`/Users/caizhongrui/Documents/workspace/qdport/ai/qdport-ai-api/boyo-knowledge/src/main/resources/mapper/UserBehaviorDailyMapper.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.boyo.knowledge.mapper.UserBehaviorDailyMapper">

    <select id="selectTrend" resultType="com.boyo.knowledge.domain.vo.BehaviorTrendVo">
        SELECT
            stat_date AS statDate,
            dau,
            total_online_duration AS totalOnlineDuration,
            total_ai_calls AS totalAiCalls,
            total_ai_cost AS totalAiCost,
            total_task_count AS totalTaskCount,
            task_success_rate AS taskSuccessRate
        FROM t_user_behavior_daily
        WHERE stat_date BETWEEN #{startDate} AND #{endDate}
        ORDER BY stat_date
    </select>

</mapper>
```

- [ ] **Step 7: 创建 UserBehaviorEventMapper.xml**（简单查询）

路径：`/Users/caizhongrui/Documents/workspace/qdport/ai/qdport-ai-api/boyo-knowledge/src/main/resources/mapper/UserBehaviorEventMapper.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<mapper namespace="com.boyo.knowledge.mapper.UserBehaviorEventMapper">

    <select id="selectByTimeRange" resultType="com.boyo.knowledge.domain.UserBehaviorEvent">
        SELECT * FROM t_user_behavior_event
        WHERE create_time >= #{startTime}
          AND create_time &lt; #{endTime}
        ORDER BY create_time
    </select>

</mapper>
```

- [ ] **Step 8: 提交**

```bash
git add .
git commit -m "feat: 添加用户行为分析Mapper及VO类"
```

---

### Task 4: 事件上报 Service + Controller

**Files:**
- Create: `service/IBehaviorEventService.java`
- Create: `service/impl/BehaviorEventServiceImpl.java`
- Create: `controller/BehaviorEventController.java`
- Create: `domain/bo/BehaviorEventBo.java`

- [ ] **Step 1: 创建 BehaviorEventBo.java**

路径：`/Users/caizhongrui/Documents/workspace/qdport/ai/qdport-ai-api/boyo-knowledge/src/main/java/com/boyo/knowledge/domain/bo/BehaviorEventBo.java`

```java
package com.boyo.knowledge.domain.bo;

import lombok.Data;
import javax.validation.constraints.NotBlank;
import java.util.Map;

@Data
public class BehaviorEventBo {

    @NotBlank(message = "sessionId不能为空")
    private String sessionId;

    @NotBlank(message = "eventType不能为空")
    private String eventType;

    private String featureCode;

    private Long clientTs;

    private Map<String, Object> extraData;
}
```

- [ ] **Step 2: 创建 IBehaviorEventService.java**

路径：`/Users/caizhongrui/Documents/workspace/qdport/ai/qdport-ai-api/boyo-knowledge/src/main/java/com/boyo/knowledge/service/IBehaviorEventService.java`

```java
package com.boyo.knowledge.service;

import com.boyo.knowledge.domain.bo.BehaviorEventBo;

public interface IBehaviorEventService {

    /**
     * 上报用户行为事件
     */
    void reportEvent(BehaviorEventBo bo);
}
```

- [ ] **Step 3: 创建 BehaviorEventServiceImpl.java**

路径：`/Users/caizhongrui/Documents/workspace/qdport/ai/qdport-ai-api/boyo-knowledge/src/main/java/com/boyo/knowledge/service/impl/BehaviorEventServiceImpl.java`

```java
package com.boyo.knowledge.service.impl;

import cn.dev33.satoken.stp.StpUtil;
import com.boyo.knowledge.domain.UserBehaviorEvent;
import com.boyo.knowledge.domain.bo.BehaviorEventBo;
import com.boyo.knowledge.mapper.UserBehaviorEventMapper;
import com.boyo.knowledge.service.IBehaviorEventService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.dromara.common.core.utils.bean.BeanUtils;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Slf4j
@Service
@RequiredArgsConstructor
public class BehaviorEventServiceImpl implements IBehaviorEventService {

    private final UserBehaviorEventMapper behaviorEventMapper;

    @Override
    public void reportEvent(BehaviorEventBo bo) {
        UserBehaviorEvent event = new UserBehaviorEvent();
        // 从 Sa-Token 当前登录用户获取 userId/userName/deptId
        try {
            Object loginId = StpUtil.getLoginId();
            // 根据项目实际的用户信息获取方式填充，参考 UserOnlineServiceImpl
            event.setUserId(Long.valueOf(loginId.toString()));
        } catch (Exception e) {
            log.warn("获取当前用户信息失败，使用匿名上报: {}", e.getMessage());
        }
        event.setSessionId(bo.getSessionId());
        event.setEventType(bo.getEventType());
        event.setFeatureCode(bo.getFeatureCode());
        event.setExtraData(bo.getExtraData());
        event.setClientTs(bo.getClientTs());
        event.setCreateTime(LocalDateTime.now());
        behaviorEventMapper.insert(event);
    }
}
```

> **注意**：userId/userName/deptId 的获取方式需参考同目录下 `UserOnlineServiceImpl.java` 中的心跳上报实现，与项目中已有的用户信息获取保持一致。

- [ ] **Step 4: 创建 BehaviorEventController.java**

路径：`/Users/caizhongrui/Documents/workspace/qdport/ai/qdport-ai-api/boyo-knowledge/src/main/java/com/boyo/knowledge/controller/BehaviorEventController.java`

```java
package com.boyo.knowledge.controller;

import com.boyo.knowledge.domain.bo.BehaviorEventBo;
import com.boyo.knowledge.service.IBehaviorEventService;
import lombok.RequiredArgsConstructor;
import org.dromara.common.core.domain.R;
import org.dromara.common.web.core.BaseController;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/behavior")
@RequiredArgsConstructor
public class BehaviorEventController extends BaseController {

    private final IBehaviorEventService behaviorEventService;

    /**
     * IDE插件上报用户行为事件
     */
    @PostMapping("/event")
    public R<Void> reportEvent(@Validated @RequestBody BehaviorEventBo bo) {
        behaviorEventService.reportEvent(bo);
        return R.ok();
    }
}
```

- [ ] **Step 5: 启动后端，验证接口可访问**

```bash
# 发送测试请求
curl -X POST http://localhost:8080/behavior/event \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "sessionId": "test-session-001",
    "eventType": "SESSION_START",
    "featureCode": "chat",
    "clientTs": 1710000000000
  }'
# 期望返回: {"code":200,"msg":"操作成功"}
# 验证数据库: SELECT * FROM t_user_behavior_event LIMIT 5;
```

- [ ] **Step 6: 提交**

```bash
git add .
git commit -m "feat: 添加用户行为事件上报接口 POST /behavior/event"
```

---

## Chunk 3: 后端 - 统计查询接口

### Task 5: 统计查询 Service + Controller

**Files:**
- Create: `service/IBehaviorStatsService.java`
- Create: `service/impl/BehaviorStatsServiceImpl.java`
- Create: `controller/BehaviorStatsController.java`

- [ ] **Step 1: 创建 IBehaviorStatsService.java**

路径：`/Users/caizhongrui/Documents/workspace/qdport/ai/qdport-ai-api/boyo-knowledge/src/main/java/com/boyo/knowledge/service/IBehaviorStatsService.java`

```java
package com.boyo.knowledge.service;

import com.boyo.knowledge.domain.vo.*;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

public interface IBehaviorStatsService {

    /** 看板KPI总览 */
    BehaviorOverviewVo getOverview(LocalDate startDate, LocalDate endDate, Long deptId);

    /** 趋势图数据 */
    List<BehaviorTrendVo> getTrend(LocalDate startDate, LocalDate endDate);

    /** 功能使用热度排行 */
    List<Map<String, Object>> getFeatureHeat(LocalDate startDate, LocalDate endDate, Long deptId);

    /** 用户活跃度明细列表 */
    List<BehaviorUserListVo> getUserList(LocalDate startDate, LocalDate endDate, Long deptId, Long userId);

    /** 单用户行为详情 */
    BehaviorUserListVo getUserDetail(Long userId, LocalDate startDate, LocalDate endDate);

    /** AI调用量汇总 */
    List<Map<String, Object>> getAiSummary(LocalDate startDate, LocalDate endDate, String groupBy);

    /** 在线时长统计 */
    List<BehaviorOnlineDurationVo> getOnlineDuration(LocalDate startDate, LocalDate endDate, String groupBy, Long deptId);
}
```

- [ ] **Step 2: 创建 BehaviorStatsServiceImpl.java**

路径：`/Users/caizhongrui/Documents/workspace/qdport/ai/qdport-ai-api/boyo-knowledge/src/main/java/com/boyo/knowledge/service/impl/BehaviorStatsServiceImpl.java`

```java
package com.boyo.knowledge.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.boyo.knowledge.domain.UserBehaviorDaily;
import com.boyo.knowledge.domain.UserBehaviorStats;
import com.boyo.knowledge.domain.vo.*;
import com.boyo.knowledge.mapper.UserBehaviorDailyMapper;
import com.boyo.knowledge.mapper.UserBehaviorStatsMapper;
import com.boyo.knowledge.service.IBehaviorStatsService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class BehaviorStatsServiceImpl implements IBehaviorStatsService {

    private final UserBehaviorStatsMapper statsMapper;
    private final UserBehaviorDailyMapper dailyMapper;

    @Override
    public BehaviorOverviewVo getOverview(LocalDate startDate, LocalDate endDate, Long deptId) {
        BehaviorOverviewVo vo = new BehaviorOverviewVo();

        // 当期数据：今日 DAU
        LocalDate today = LocalDate.now();
        UserBehaviorDaily todayDaily = dailyMapper.selectOne(
            new LambdaQueryWrapper<UserBehaviorDaily>().eq(UserBehaviorDaily::getStatDate, today)
        );
        if (todayDaily != null) {
            vo.setDau(todayDaily.getDau());
            vo.setNewUserToday(todayDaily.getNewUserCount());
        }

        // 7日活跃、30日活跃（distinct user_id from stats）
        LocalDate day7Ago = today.minusDays(7);
        LocalDate day30Ago = today.minusDays(30);

        List<BehaviorUserListVo> users7d = statsMapper.selectUserList(day7Ago, today, deptId, null);
        vo.setActiveUserCount7d(users7d.size());

        List<BehaviorUserListVo> users30d = statsMapper.selectUserList(day30Ago, today, deptId, null);
        vo.setActiveUserCount30d(users30d.size());

        // 区间内人均在线时长、AI调用量、成本
        List<BehaviorUserListVo> rangeUsers = statsMapper.selectUserList(startDate, endDate, deptId, null);
        if (!rangeUsers.isEmpty()) {
            long totalOnline = rangeUsers.stream().mapToLong(u -> u.getOnlineDuration() != null ? u.getOnlineDuration() : 0).sum();
            vo.setAvgOnlineDuration(totalOnline / rangeUsers.size());

            int totalAi = rangeUsers.stream().mapToInt(u -> u.getAiCallCount() != null ? u.getAiCallCount() : 0).sum();
            vo.setTotalAiCalls(totalAi);
        }

        // 从 daily 表聚合 AI 成本
        List<BehaviorTrendVo> trend = dailyMapper.selectTrend(startDate, endDate);
        BigDecimal totalCost = trend.stream()
            .map(t -> t.getTotalAiCost() != null ? t.getTotalAiCost() : BigDecimal.ZERO)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        vo.setAiCost(totalCost);

        // 任务成功率（区间内汇总）
        long totalTask = rangeUsers.stream().mapToLong(u -> u.getTaskCount() != null ? u.getTaskCount() : 0).sum();
        long successTask = rangeUsers.stream().mapToLong(u -> u.getTaskSuccessCount() != null ? u.getTaskSuccessCount() : 0).sum();
        if (totalTask > 0) {
            vo.setTaskSuccessRate(BigDecimal.valueOf(successTask * 100.0 / totalTask).setScale(2, RoundingMode.HALF_UP));
        }

        // 环比增长：对比上一个同等长度区间（简化：与昨日或上周同期对比）
        // 此处预留，实际可根据需求实现
        vo.setDauGrowth(0.0);
        vo.setAvgOnlineDurationGrowth(0.0);
        vo.setAiCallsGrowth(0.0);
        vo.setAiCostGrowth(0.0);

        return vo;
    }

    @Override
    public List<BehaviorTrendVo> getTrend(LocalDate startDate, LocalDate endDate) {
        return dailyMapper.selectTrend(startDate, endDate);
    }

    @Override
    public List<Map<String, Object>> getFeatureHeat(LocalDate startDate, LocalDate endDate, Long deptId) {
        return statsMapper.selectFeatureHeat(startDate, endDate, deptId);
    }

    @Override
    public List<BehaviorUserListVo> getUserList(LocalDate startDate, LocalDate endDate, Long deptId, Long userId) {
        return statsMapper.selectUserList(startDate, endDate, deptId, userId);
    }

    @Override
    public BehaviorUserListVo getUserDetail(Long userId, LocalDate startDate, LocalDate endDate) {
        return statsMapper.selectUserSummary(userId, startDate, endDate);
    }

    @Override
    public List<Map<String, Object>> getAiSummary(LocalDate startDate, LocalDate endDate, String groupBy) {
        if ("model".equals(groupBy)) {
            return statsMapper.selectAiSummaryByModel(startDate, endDate);
        }
        return statsMapper.selectAiSummaryByDay(startDate, endDate);
    }

    @Override
    public List<BehaviorOnlineDurationVo> getOnlineDuration(LocalDate startDate, LocalDate endDate, String groupBy, Long deptId) {
        if ("dept".equals(groupBy)) {
            return statsMapper.selectOnlineDurationByDept(startDate, endDate);
        }
        return statsMapper.selectOnlineDurationByUser(startDate, endDate, deptId);
    }
}
```

- [ ] **Step 3: 创建 BehaviorStatsController.java**

路径：`/Users/caizhongrui/Documents/workspace/qdport/ai/qdport-ai-api/boyo-knowledge/src/main/java/com/boyo/knowledge/controller/BehaviorStatsController.java`

```java
package com.boyo.knowledge.controller;

import cn.dev33.satoken.annotation.SaCheckPermission;
import com.boyo.knowledge.domain.vo.*;
import com.boyo.knowledge.service.IBehaviorStatsService;
import lombok.RequiredArgsConstructor;
import org.dromara.common.core.domain.R;
import org.dromara.common.web.core.BaseController;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/behavior/stats")
@RequiredArgsConstructor
public class BehaviorStatsController extends BaseController {

    private final IBehaviorStatsService behaviorStatsService;

    /** 看板KPI总览 */
    @SaCheckPermission("knowledge:behaviorStats:query")
    @GetMapping("/overview")
    public R<BehaviorOverviewVo> getOverview(
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate startDate,
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate endDate,
        @RequestParam(required = false) Long deptId
    ) {
        return R.ok(behaviorStatsService.getOverview(startDate, endDate, deptId));
    }

    /** 趋势图数据 */
    @SaCheckPermission("knowledge:behaviorStats:query")
    @GetMapping("/trend")
    public R<List<BehaviorTrendVo>> getTrend(
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate startDate,
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate endDate
    ) {
        return R.ok(behaviorStatsService.getTrend(startDate, endDate));
    }

    /** 功能使用热度排行 */
    @SaCheckPermission("knowledge:behaviorStats:query")
    @GetMapping("/feature-heat")
    public R<List<Map<String, Object>>> getFeatureHeat(
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate startDate,
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate endDate,
        @RequestParam(required = false) Long deptId
    ) {
        return R.ok(behaviorStatsService.getFeatureHeat(startDate, endDate, deptId));
    }

    /** 用户活跃度明细列表（分页） */
    @SaCheckPermission("knowledge:behaviorStats:query")
    @GetMapping("/user-list")
    public R<List<BehaviorUserListVo>> getUserList(
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate startDate,
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate endDate,
        @RequestParam(required = false) Long deptId,
        @RequestParam(required = false) Long userId
    ) {
        return R.ok(behaviorStatsService.getUserList(startDate, endDate, deptId, userId));
    }

    /** 单用户行为详情 */
    @SaCheckPermission("knowledge:behaviorStats:query")
    @GetMapping("/user-detail")
    public R<BehaviorUserListVo> getUserDetail(
        @RequestParam Long userId,
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate startDate,
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate endDate
    ) {
        return R.ok(behaviorStatsService.getUserDetail(userId, startDate, endDate));
    }

    /** AI调用量汇总（groupBy: model / day） */
    @SaCheckPermission("knowledge:behaviorStats:query")
    @GetMapping("/ai-summary")
    public R<List<Map<String, Object>>> getAiSummary(
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate startDate,
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate endDate,
        @RequestParam(defaultValue = "day") String groupBy
    ) {
        return R.ok(behaviorStatsService.getAiSummary(startDate, endDate, groupBy));
    }

    /** 在线时长统计（groupBy: dept / user） */
    @SaCheckPermission("knowledge:behaviorStats:query")
    @GetMapping("/online-duration")
    public R<List<BehaviorOnlineDurationVo>> getOnlineDuration(
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate startDate,
        @RequestParam @DateTimeFormat(pattern = "yyyy-MM-dd") LocalDate endDate,
        @RequestParam(defaultValue = "dept") String groupBy,
        @RequestParam(required = false) Long deptId
    ) {
        return R.ok(behaviorStatsService.getOnlineDuration(startDate, endDate, groupBy, deptId));
    }
}
```

- [ ] **Step 4: 提交**

```bash
git add .
git commit -m "feat: 添加用户行为统计查询接口(overview/trend/feature-heat/user-list/ai-summary)"
```

---

## Chunk 4: 后端 - 定时聚合任务

### Task 6: BehaviorAggregateTask 定时任务

**Files:**
- Create: `task/BehaviorAggregateTask.java`

路径：`/Users/caizhongrui/Documents/workspace/qdport/ai/qdport-ai-api/boyo-knowledge/src/main/java/com/boyo/knowledge/task/BehaviorAggregateTask.java`

- [ ] **Step 1: 创建定时聚合任务**

```java
package com.boyo.knowledge.task;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.boyo.knowledge.domain.UserBehaviorDaily;
import com.boyo.knowledge.domain.UserBehaviorEvent;
import com.boyo.knowledge.domain.UserBehaviorStats;
import com.boyo.knowledge.domain.UserOnlineStatus;
import com.boyo.knowledge.mapper.UserBehaviorDailyMapper;
import com.boyo.knowledge.mapper.UserBehaviorEventMapper;
import com.boyo.knowledge.mapper.UserBehaviorStatsMapper;
import com.boyo.knowledge.mapper.UserOnlineStatusMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Component
@RequiredArgsConstructor
public class BehaviorAggregateTask {

    private final UserBehaviorEventMapper eventMapper;
    private final UserBehaviorStatsMapper statsMapper;
    private final UserBehaviorDailyMapper dailyMapper;
    private final UserOnlineStatusMapper onlineStatusMapper;

    /**
     * 每小时05分聚合上一小时原始事件 → t_user_behavior_stats
     */
    @Scheduled(cron = "0 5 * * * ?")
    public void hourlyAggregate() {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime startTime = now.minusHours(1).withMinute(0).withSecond(0).withNano(0);
        LocalDateTime endTime = startTime.plusHours(1);
        int hour = startTime.getHour();
        LocalDate date = startTime.toLocalDate();

        log.info("开始聚合用户行为数据: {} {}时", date, hour);

        List<UserBehaviorEvent> events = eventMapper.selectByTimeRange(startTime, endTime);
        if (events.isEmpty()) {
            log.info("该小时无事件数据，跳过聚合");
            return;
        }

        // 按 user_id 分组
        Map<Long, List<UserBehaviorEvent>> byUser = events.stream()
            .filter(e -> e.getUserId() != null)
            .collect(Collectors.groupingBy(UserBehaviorEvent::getUserId));

        for (Map.Entry<Long, List<UserBehaviorEvent>> entry : byUser.entrySet()) {
            Long userId = entry.getKey();
            List<UserBehaviorEvent> userEvents = entry.getValue();

            UserBehaviorStats stats = buildHourlyStats(userId, date, hour, userEvents);

            // 存在则更新，不存在则插入
            UserBehaviorStats existing = statsMapper.selectOne(
                new LambdaQueryWrapper<UserBehaviorStats>()
                    .eq(UserBehaviorStats::getStatDate, date)
                    .eq(UserBehaviorStats::getStatHour, hour)
                    .eq(UserBehaviorStats::getUserId, userId)
            );
            if (existing != null) {
                stats.setId(existing.getId());
                statsMapper.updateById(stats);
            } else {
                statsMapper.insert(stats);
            }
        }

        log.info("小时聚合完成: {} {}时，处理用户数: {}", date, hour, byUser.size());
    }

    private UserBehaviorStats buildHourlyStats(Long userId, LocalDate date, int hour, List<UserBehaviorEvent> events) {
        UserBehaviorStats stats = new UserBehaviorStats();
        stats.setStatDate(date);
        stats.setStatHour(hour);
        stats.setUserId(userId);

        // 从第一个事件取部门ID
        events.stream().filter(e -> e.getDeptId() != null).findFirst()
            .ifPresent(e -> stats.setDeptId(e.getDeptId()));

        // 会话次数/时长
        long sessionStart = events.stream()
            .filter(e -> "SESSION_START".equals(e.getEventType())).count();
        stats.setSessionCount((int) sessionStart);

        // 任务统计
        long taskStart = events.stream().filter(e -> "TASK_START".equals(e.getEventType())).count();
        long taskSuccess = events.stream().filter(e -> "TASK_END".equals(e.getEventType())
            && e.getExtraData() != null && "success".equals(e.getExtraData().get("status"))).count();
        long taskFailed = events.stream().filter(e -> "TASK_END".equals(e.getEventType())
            && e.getExtraData() != null && "failed".equals(e.getExtraData().get("status"))).count();
        stats.setTaskCount((int) taskStart);
        stats.setTaskSuccessCount((int) taskSuccess);
        stats.setTaskFailedCount((int) taskFailed);

        // 工具调用次数
        long toolUse = events.stream().filter(e -> "TOOL_USE".equals(e.getEventType())).count();
        stats.setToolUseCount((int) toolUse);

        // AI 调用统计
        List<UserBehaviorEvent> aiCalls = events.stream()
            .filter(e -> "AI_CALL".equals(e.getEventType()) && e.getExtraData() != null)
            .collect(Collectors.toList());
        stats.setAiCallCount(aiCalls.size());
        stats.setAiTokensIn(aiCalls.stream()
            .mapToLong(e -> toLong(e.getExtraData().get("tokensIn"))).sum());
        stats.setAiTokensOut(aiCalls.stream()
            .mapToLong(e -> toLong(e.getExtraData().get("tokensOut"))).sum());
        stats.setAiCost(aiCalls.stream()
            .map(e -> toBigDecimal(e.getExtraData().get("cost")))
            .reduce(BigDecimal.ZERO, BigDecimal::add));
        stats.setAiSuccessCount((int) aiCalls.stream()
            .filter(e -> Boolean.TRUE.equals(e.getExtraData().get("success"))).count());

        // 功能模块统计（viewCount + avgDuration 简化计算）
        Map<String, Long> viewCount = events.stream()
            .filter(e -> "FEATURE_VIEW".equals(e.getEventType()) && e.getFeatureCode() != null)
            .collect(Collectors.groupingBy(UserBehaviorEvent::getFeatureCode, Collectors.counting()));
        List<Map<String, Object>> featureStats = viewCount.entrySet().stream()
            .map(e -> {
                Map<String, Object> m = new HashMap<>();
                m.put("featureCode", e.getKey());
                m.put("viewCount", e.getValue());
                m.put("avgDuration", 0);
                return m;
            }).collect(Collectors.toList());
        stats.setFeatureStats(featureStats.isEmpty() ? null : (Map<String, Object>) (Object) featureStats);

        stats.setCreateTime(LocalDateTime.now());
        return stats;
    }

    /**
     * 每天00:10聚合昨日数据 → t_user_behavior_daily
     */
    @Scheduled(cron = "0 10 0 * * ?")
    public void dailyAggregate() {
        LocalDate yesterday = LocalDate.now().minusDays(1);
        log.info("开始聚合每日汇总数据: {}", yesterday);

        // 从小时聚合表汇总
        List<UserBehaviorStats> hourlyList = statsMapper.selectList(
            new LambdaQueryWrapper<UserBehaviorStats>()
                .eq(UserBehaviorStats::getStatDate, yesterday)
        );

        if (hourlyList.isEmpty()) {
            log.info("昨日无聚合数据，跳过每日汇总");
            return;
        }

        UserBehaviorDaily daily = new UserBehaviorDaily();
        daily.setStatDate(yesterday);

        // DAU
        long dau = hourlyList.stream().map(UserBehaviorStats::getUserId).distinct().count();
        daily.setDau((int) dau);

        // 总在线时长/人均
        long totalOnline = hourlyList.stream().mapToLong(s -> s.getOnlineDuration() != null ? s.getOnlineDuration() : 0).sum();
        daily.setTotalOnlineDuration(totalOnline);
        daily.setAvgOnlineDuration(dau > 0 ? totalOnline / dau : 0);

        // 任务统计
        long totalTask = hourlyList.stream().mapToLong(s -> s.getTaskCount() != null ? s.getTaskCount() : 0).sum();
        long successTask = hourlyList.stream().mapToLong(s -> s.getTaskSuccessCount() != null ? s.getTaskSuccessCount() : 0).sum();
        daily.setTotalTaskCount((int) totalTask);
        daily.setTaskSuccessRate(totalTask > 0
            ? BigDecimal.valueOf(successTask * 100.0 / totalTask).setScale(2, RoundingMode.HALF_UP)
            : BigDecimal.ZERO);

        // AI 统计
        int totalAi = hourlyList.stream().mapToInt(s -> s.getAiCallCount() != null ? s.getAiCallCount() : 0).sum();
        long totalTokens = hourlyList.stream().mapToLong(s -> s.getAiTokensIn() != null ? s.getAiTokensIn() + (s.getAiTokensOut() != null ? s.getAiTokensOut() : 0) : 0).sum();
        BigDecimal totalCost = hourlyList.stream()
            .map(s -> s.getAiCost() != null ? s.getAiCost() : BigDecimal.ZERO)
            .reduce(BigDecimal.ZERO, BigDecimal::add);
        int aiSuccess = hourlyList.stream().mapToInt(s -> s.getAiSuccessCount() != null ? s.getAiSuccessCount() : 0).sum();
        daily.setTotalAiCalls(totalAi);
        daily.setTotalAiTokens(totalTokens);
        daily.setTotalAiCost(totalCost);
        daily.setAiSuccessRate(totalAi > 0
            ? BigDecimal.valueOf(aiSuccess * 100.0 / totalAi).setScale(2, RoundingMode.HALF_UP)
            : BigDecimal.ZERO);

        daily.setCreateTime(LocalDateTime.now());

        // 插入或更新
        UserBehaviorDaily existing = dailyMapper.selectOne(
            new LambdaQueryWrapper<UserBehaviorDaily>().eq(UserBehaviorDaily::getStatDate, yesterday)
        );
        if (existing != null) {
            daily.setId(existing.getId());
            dailyMapper.updateById(daily);
        } else {
            dailyMapper.insert(daily);
        }

        log.info("每日聚合完成: {}，DAU={}", yesterday, dau);
    }

    /**
     * 每小时10分从 user_online_status 心跳同步在线时长
     * 逻辑：活跃心跳间隔 <= 5分钟，则计入在线时长
     */
    @Scheduled(cron = "0 10 * * * ?")
    public void onlineDurationSync() {
        LocalDate today = LocalDate.now();
        int currentHour = LocalDateTime.now().getHour();
        // 简化：将当前在线的用户的在线时长累加到当前小时的 stats 记录
        // 实际可根据 user_online_status.lastHeartbeatTime 与 firstOnlineTime 差值计算
        log.info("同步在线时长: {} {}时", today, currentHour);
        // 查询当前在线用户
        List<UserOnlineStatus> onlineUsers = onlineStatusMapper.selectList(
            new LambdaQueryWrapper<UserOnlineStatus>().eq(UserOnlineStatus::getStatus, "online")
        );
        for (UserOnlineStatus user : onlineUsers) {
            if (user.getUserId() == null) continue;
            // 更新当前小时的 online_duration（+3600秒，即累加1小时在线）
            statsMapper.update(null,
                new LambdaUpdateWrapper<UserBehaviorStats>()
                    .eq(UserBehaviorStats::getStatDate, today)
                    .eq(UserBehaviorStats::getStatHour, currentHour)
                    .eq(UserBehaviorStats::getUserId, user.getUserId())
                    .setSql("online_duration = online_duration + 3600")
            );
        }
    }

    // 工具方法
    private long toLong(Object val) {
        if (val == null) return 0;
        if (val instanceof Number) return ((Number) val).longValue();
        try { return Long.parseLong(val.toString()); } catch (Exception e) { return 0; }
    }

    private BigDecimal toBigDecimal(Object val) {
        if (val == null) return BigDecimal.ZERO;
        if (val instanceof BigDecimal) return (BigDecimal) val;
        try { return new BigDecimal(val.toString()); } catch (Exception e) { return BigDecimal.ZERO; }
    }
}
```

> **注意**：`UserOnlineStatus.status` 字段的在线值（"online"/"1" 等）需与项目现有代码对齐，参考 `UserOnlineTask.java` 中的写法。

- [ ] **Step 2: 确认启动类已有 @EnableScheduling（或在任务类上标注）**

检查 `boyo-admin` 模块启动类，若无 `@EnableScheduling` 则添加，或检查现有 `UserOnlineTask.java` 所在配置是否已全局开启。

- [ ] **Step 3: 提交**

```bash
git add .
git commit -m "feat: 添加用户行为小时/每日定时聚合任务及在线时长同步"
```

---

## Chunk 5: 管理端 - 用户行为看板页面

### Task 7: 管理端路由 + API 模块

**Files:**
- Modify: `/Users/caizhongrui/Documents/workspace/qdport/ai/ui/src/router/index.js`（或 router 配置文件，添加路由）
- Create: `/Users/caizhongrui/Documents/workspace/qdport/ai/ui/src/api/knowledge/behaviorStats.js`

- [ ] **Step 1: 创建 API 模块**

路径：`/Users/caizhongrui/Documents/workspace/qdport/ai/ui/src/api/knowledge/behaviorStats.js`

```javascript
import request from '@/utils/request'

/** 看板KPI总览 */
export function getBehaviorOverview(params) {
  return request({
    url: '/behavior/stats/overview',
    method: 'get',
    params
  })
}

/** 趋势图数据 */
export function getBehaviorTrend(params) {
  return request({
    url: '/behavior/stats/trend',
    method: 'get',
    params
  })
}

/** 功能使用热度排行 */
export function getFeatureHeat(params) {
  return request({
    url: '/behavior/stats/feature-heat',
    method: 'get',
    params
  })
}

/** 用户活跃度明细列表 */
export function getUserBehaviorList(params) {
  return request({
    url: '/behavior/stats/user-list',
    method: 'get',
    params
  })
}

/** 单用户行为详情 */
export function getUserBehaviorDetail(params) {
  return request({
    url: '/behavior/stats/user-detail',
    method: 'get',
    params
  })
}

/** AI调用量汇总 */
export function getAiSummary(params) {
  return request({
    url: '/behavior/stats/ai-summary',
    method: 'get',
    params
  })
}

/** 在线时长统计 */
export function getOnlineDuration(params) {
  return request({
    url: '/behavior/stats/online-duration',
    method: 'get',
    params
  })
}

/** 上报用户行为事件（IDE插件使用，此处供测试） */
export function reportBehaviorEvent(data) {
  return request({
    url: '/behavior/event',
    method: 'post',
    data
  })
}
```

- [ ] **Step 2: 在路由配置中添加路由**

找到路由配置文件（参考现有 `commitStatistics` 路由的写法），在 `dynamicRoutes` 中添加：

```javascript
{
  path: '/knowledge/behaviorStats',
  component: () => import('@/views/knowledge/behaviorStats/index.vue'),
  name: 'BehaviorStats',
  meta: { title: '用户行为分析', icon: 'chart', noCache: false }
},
{
  path: '/knowledge/behaviorStats/user',
  component: () => import('@/views/knowledge/behaviorStats/userDetail.vue'),
  name: 'BehaviorStatsUser',
  meta: { title: '用户行为详情', activeMenu: '/knowledge/behaviorStats', hidden: true }
}
```

- [ ] **Step 3: 提交**

```bash
git add .
git commit -m "feat: 添加用户行为分析路由和API模块"
```

---

### Task 8: 主看板页面 index.vue

**Files:**
- Create: `/Users/caizhongrui/Documents/workspace/qdport/ai/ui/src/views/knowledge/behaviorStats/index.vue`

- [ ] **Step 1: 创建 index.vue**

参考 `commitStatistics/index.vue` 的整体结构，完整实现以下布局：

```vue
<template>
  <div class="behavior-stats-container">
    <!-- 筛选栏 -->
    <el-card class="filter-card">
      <el-form :inline="true" :model="queryParams">
        <el-form-item label="时间范围">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            :shortcuts="dateShortcuts"
          />
        </el-form-item>
        <el-form-item label="部门">
          <el-tree-select
            v-model="queryParams.deptId"
            :data="deptOptions"
            placeholder="全部部门"
            clearable
            check-strictly
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleQuery">查询</el-button>
          <el-button @click="handleReset">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- KPI 卡片区 -->
    <el-row :gutter="16" class="kpi-row">
      <el-col :span="6" v-for="item in kpiCards" :key="item.key">
        <el-card class="kpi-card">
          <div class="kpi-title">{{ item.label }}</div>
          <div class="kpi-value">{{ item.value }}</div>
          <div class="kpi-growth" :class="item.growth >= 0 ? 'up' : 'down'" v-if="item.growth !== undefined">
            {{ item.growth >= 0 ? '↑' : '↓' }} {{ Math.abs(item.growth) }}%
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 图表区第一行 -->
    <el-row :gutter="16" class="chart-row">
      <el-col :span="14">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>活跃趋势</span>
              <el-radio-group v-model="trendType" size="small" @change="renderTrendChart">
                <el-radio-button value="dau">日活</el-radio-button>
                <el-radio-button value="aiCalls">AI调用</el-radio-button>
                <el-radio-button value="onlineDuration">在线时长</el-radio-button>
              </el-radio-group>
            </div>
          </template>
          <div ref="trendChartRef" style="height: 280px;"></div>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card>
          <template #header><span>功能使用热度</span></template>
          <div ref="featureHeatChartRef" style="height: 280px;"></div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 图表区第二行 -->
    <el-row :gutter="16" class="chart-row">
      <el-col :span="12">
        <el-card>
          <template #header><span>AI调用量分析（按模型）</span></template>
          <div ref="aiChartRef" style="height: 280px;"></div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <template #header><span>在线时长分布（按部门）</span></template>
          <div ref="onlineChartRef" style="height: 280px;"></div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 用户明细表格 -->
    <el-card class="table-card">
      <template #header><span>用户活跃度明细</span></template>
      <el-table :data="userList" stripe border v-loading="tableLoading">
        <el-table-column prop="userName" label="用户名" width="120">
          <template #default="{ row }">
            <el-link type="primary" @click="goUserDetail(row)">{{ row.userName }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="deptName" label="部门" width="120" />
        <el-table-column label="在线时长" width="120">
          <template #default="{ row }">{{ formatDuration(row.onlineDuration) }}</template>
        </el-table-column>
        <el-table-column prop="taskCount" label="任务数" width="100" />
        <el-table-column label="任务成功率" width="110">
          <template #default="{ row }">
            <el-progress :percentage="Number(row.taskSuccessRate || 0)" :stroke-width="6" />
          </template>
        </el-table-column>
        <el-table-column prop="aiCallCount" label="AI调用" width="100" />
        <el-table-column label="最后活跃" min-width="140">
          <template #default="{ row }">{{ formatRelativeTime(row.lastActiveTime) }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts'
import {
  getBehaviorOverview, getBehaviorTrend, getFeatureHeat,
  getUserBehaviorList, getAiSummary, getOnlineDuration
} from '@/api/knowledge/behaviorStats'
import { listDept } from '@/api/system/dept'

const router = useRouter()

// 筛选参数
const dateRange = ref([
  new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10),
  new Date().toISOString().slice(0, 10)
])
const queryParams = reactive({ deptId: undefined })
const deptOptions = ref([])
const trendType = ref('dau')
const tableLoading = ref(false)

// 日期快捷选项
const dateShortcuts = [
  { text: '本周', value: () => { const d = new Date(); return [new Date(d - (d.getDay() || 7) * 86400000 + 86400000), d] } },
  { text: '近7天', value: () => [new Date(Date.now() - 6 * 86400000), new Date()] },
  { text: '近30天', value: () => [new Date(Date.now() - 29 * 86400000), new Date()] },
  { text: '本月', value: () => { const d = new Date(); return [new Date(d.getFullYear(), d.getMonth(), 1), d] } }
]

// KPI 卡片
const kpiCards = ref([
  { key: 'dau', label: '日活用户', value: '-', growth: undefined },
  { key: 'avgOnlineDuration', label: '人均在线时长', value: '-', growth: undefined },
  { key: 'totalAiCalls', label: 'AI调用总量', value: '-', growth: undefined },
  { key: 'aiCost', label: 'AI总成本', value: '-', growth: undefined },
  { key: 'taskSuccessRate', label: '任务成功率', value: '-', growth: undefined },
  { key: 'activeUserCount7d', label: '周活用户', value: '-', growth: undefined },
  { key: 'activeUserCount30d', label: '月活用户', value: '-', growth: undefined },
  { key: 'newUserToday', label: '今日新增', value: '-', growth: undefined }
])

const userList = ref([])

// 图表 refs
const trendChartRef = ref(null)
const featureHeatChartRef = ref(null)
const aiChartRef = ref(null)
const onlineChartRef = ref(null)

let trendChart, featureHeatChart, aiChart, onlineChart

onMounted(async () => {
  await loadDeptOptions()
  await fetchAll()
  initCharts()
})

async function loadDeptOptions() {
  const res = await listDept({})
  // 参考 commitStatistics 中的部门树构建方式
  deptOptions.value = buildDeptTree(res.data || [])
}

function buildDeptTree(list) {
  // 复用项目中已有的树形构建工具，或简单递归实现
  const map = {}
  const roots = []
  list.forEach(d => { map[d.deptId] = { ...d, label: d.deptName, value: d.deptId, children: [] } })
  list.forEach(d => {
    if (d.parentId && map[d.parentId]) map[d.parentId].children.push(map[d.deptId])
    else roots.push(map[d.deptId])
  })
  return roots
}

async function fetchAll() {
  const [start, end] = dateRange.value
  const params = { startDate: start, endDate: end, deptId: queryParams.deptId }

  // 并行请求
  const [overviewRes, trendRes, featureRes, userRes, aiRes, onlineRes] = await Promise.all([
    getBehaviorOverview(params),
    getBehaviorTrend({ startDate: start, endDate: end }),
    getFeatureHeat(params),
    getUserBehaviorList(params),
    getAiSummary({ startDate: start, endDate: end, groupBy: 'model' }),
    getOnlineDuration({ startDate: start, endDate: end, groupBy: 'dept' })
  ])

  // 填充KPI
  const ov = overviewRes.data || {}
  kpiCards.value[0].value = ov.dau ?? '-'
  kpiCards.value[0].growth = ov.dauGrowth
  kpiCards.value[1].value = formatDuration(ov.avgOnlineDuration)
  kpiCards.value[1].growth = ov.avgOnlineDurationGrowth
  kpiCards.value[2].value = (ov.totalAiCalls ?? '-').toLocaleString?.() ?? ov.totalAiCalls
  kpiCards.value[2].growth = ov.aiCallsGrowth
  kpiCards.value[3].value = ov.aiCost != null ? '¥' + Number(ov.aiCost).toFixed(2) : '-'
  kpiCards.value[3].growth = ov.aiCostGrowth
  kpiCards.value[4].value = ov.taskSuccessRate != null ? ov.taskSuccessRate + '%' : '-'
  kpiCards.value[5].value = ov.activeUserCount7d ?? '-'
  kpiCards.value[6].value = ov.activeUserCount30d ?? '-'
  kpiCards.value[7].value = ov.newUserToday ?? '-'

  userList.value = userRes.data || []

  // 图表数据存储，等待 DOM
  window._trendData = trendRes.data || []
  window._featureData = featureRes.data || []
  window._aiData = aiRes.data || []
  window._onlineData = onlineRes.data || []
}

function initCharts() {
  nextTick(() => {
    trendChart = echarts.init(trendChartRef.value)
    featureHeatChart = echarts.init(featureHeatChartRef.value)
    aiChart = echarts.init(aiChartRef.value)
    onlineChart = echarts.init(onlineChartRef.value)
    renderTrendChart()
    renderFeatureHeatChart()
    renderAiChart()
    renderOnlineChart()
  })
}

function renderTrendChart() {
  const data = window._trendData || []
  const dates = data.map(d => d.statDate)
  const valueKey = trendType.value === 'dau' ? 'dau'
    : trendType.value === 'aiCalls' ? 'totalAiCalls' : 'totalOnlineDuration'
  const label = trendType.value === 'dau' ? '日活用户数'
    : trendType.value === 'aiCalls' ? 'AI调用次数' : '在线时长(秒)'
  trendChart?.setOption({
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: dates },
    yAxis: { type: 'value' },
    series: [{ name: label, type: 'line', smooth: true, data: data.map(d => d[valueKey] || 0), areaStyle: {} }]
  })
}

function renderFeatureHeatChart() {
  const data = (window._featureData || []).slice(0, 8)
  featureHeatChart?.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '4%', containLabel: true },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: data.map(d => d.feature || d.featureCode).reverse() },
    series: [{ name: '使用次数(PV)', type: 'bar', data: data.map(d => d.pv || 0).reverse() }]
  })
}

function renderAiChart() {
  const data = window._aiData || []
  aiChart?.setOption({
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', left: 'left' },
    series: [{
      type: 'pie', radius: '60%',
      data: data.map(d => ({ name: d.model || d.MODEL, value: d.callCount || d.CALLCOUNT || 0 }))
    }]
  })
}

function renderOnlineChart() {
  const data = (window._onlineData || []).slice(0, 10)
  onlineChart?.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '4%', containLabel: true },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: data.map(d => d.deptName || '-').reverse() },
    series: [{ name: '在线时长(小时)', type: 'bar',
      data: data.map(d => Math.round((d.totalOnlineDuration || 0) / 3600)).reverse() }]
  })
}

function handleQuery() {
  tableLoading.value = true
  fetchAll().finally(() => { tableLoading.value = false; initCharts() })
}

function handleReset() {
  dateRange.value = [
    new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    new Date().toISOString().slice(0, 10)
  ]
  queryParams.deptId = undefined
  handleQuery()
}

function goUserDetail(row) {
  router.push({ path: '/knowledge/behaviorStats/user', query: { userId: row.userId, userName: row.userName } })
}

function formatDuration(seconds) {
  if (!seconds) return '0分钟'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}min` : `${m}分钟`
}

function formatRelativeTime(time) {
  if (!time) return '-'
  const diff = Date.now() - new Date(time).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}
</script>

<style scoped>
.behavior-stats-container { padding: 16px; }
.filter-card { margin-bottom: 16px; }
.kpi-row { margin-bottom: 16px; }
.kpi-card { text-align: center; padding: 8px 0; }
.kpi-title { font-size: 13px; color: #909399; margin-bottom: 8px; }
.kpi-value { font-size: 26px; font-weight: bold; color: #303133; }
.kpi-growth { font-size: 12px; margin-top: 4px; }
.kpi-growth.up { color: #67c23a; }
.kpi-growth.down { color: #f56c6c; }
.chart-row { margin-bottom: 16px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.table-card { margin-bottom: 16px; }
</style>
```

- [ ] **Step 2: 提交**

```bash
git add .
git commit -m "feat: 添加用户行为分析主看板页面"
```

---

### Task 9: 用户行为详情页 userDetail.vue

**Files:**
- Create: `/Users/caizhongrui/Documents/workspace/qdport/ai/ui/src/views/knowledge/behaviorStats/userDetail.vue`

- [ ] **Step 1: 创建 userDetail.vue**

```vue
<template>
  <div class="user-detail-container">
    <!-- 头部 -->
    <el-card class="header-card">
      <el-page-header @back="$router.back()">
        <template #content>
          <span class="user-title">{{ userName }}（{{ deptName }}）</span>
          <span class="last-active">最后活跃：{{ formatRelativeTime(overview.lastActiveTime) }}</span>
        </template>
      </el-page-header>
    </el-card>

    <!-- KPI 卡片 -->
    <el-row :gutter="16" class="kpi-row">
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="kpi-title">累计在线时长</div>
          <div class="kpi-value">{{ formatDuration(overview.onlineDuration) }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="kpi-title">累计任务数</div>
          <div class="kpi-value">{{ overview.taskCount ?? '-' }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="kpi-title">任务成功率</div>
          <div class="kpi-value">{{ overview.taskSuccessRate != null ? overview.taskSuccessRate + '%' : '-' }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="kpi-card">
          <div class="kpi-title">累计AI调用</div>
          <div class="kpi-value">{{ overview.aiCallCount ?? '-' }} 次</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 每日在线时长趋势 -->
    <el-card class="chart-card">
      <template #header><span>每日在线时长趋势（近30天）</span></template>
      <div ref="trendChartRef" style="height: 260px;"></div>
    </el-card>

    <!-- 功能使用 + 任务状态 -->
    <el-row :gutter="16" class="chart-row">
      <el-col :span="12">
        <el-card>
          <template #header><span>功能使用频次</span></template>
          <div ref="featureChartRef" style="height: 260px;"></div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <template #header><span>任务状态分布</span></template>
          <div ref="taskChartRef" style="height: 260px;"></div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import * as echarts from 'echarts'
import { getUserBehaviorDetail, getBehaviorTrend } from '@/api/knowledge/behaviorStats'

const route = useRoute()
const userId = route.query.userId
const userName = route.query.userName
const deptName = ref('-')

const overview = ref({})

const trendChartRef = ref(null)
const featureChartRef = ref(null)
const taskChartRef = ref(null)

onMounted(async () => {
  const endDate = new Date().toISOString().slice(0, 10)
  const startDate = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)

  const [detailRes, trendRes] = await Promise.all([
    getUserBehaviorDetail({ userId, startDate, endDate }),
    getBehaviorTrend({ startDate, endDate })
  ])

  overview.value = detailRes.data || {}
  deptName.value = overview.value.deptName || '-'

  const trendData = trendRes.data || []

  nextTick(() => {
    // 每日在线时长趋势
    const trendChart = echarts.init(trendChartRef.value)
    trendChart.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: trendData.map(d => d.statDate) },
      yAxis: { type: 'value', name: '小时' },
      series: [{ name: '在线时长', type: 'line', smooth: true,
        data: trendData.map(d => Math.round((d.totalOnlineDuration || 0) / 3600)), areaStyle: {} }]
    })

    // 功能使用频次（饼图）- 从 overview 中取 featureStats
    const featureChart = echarts.init(featureChartRef.value)
    const featureData = Array.isArray(overview.value.featureStats)
      ? overview.value.featureStats
      : []
    featureChart.setOption({
      tooltip: { trigger: 'item' },
      legend: { orient: 'vertical', left: 'left' },
      series: [{
        type: 'pie', radius: '60%',
        data: featureData.map(f => ({ name: f.featureCode, value: f.viewCount || 0 }))
      }]
    })

    // 任务状态分布（饼图）
    const taskChart = echarts.init(taskChartRef.value)
    const ov = overview.value
    const success = ov.taskSuccessCount || 0
    const failed = ov.taskFailedCount || 0
    const aborted = (ov.taskCount || 0) - success - failed
    taskChart.setOption({
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie', radius: '60%',
        data: [
          { name: '成功', value: success },
          { name: '失败', value: failed },
          { name: '中断', value: Math.max(0, aborted) }
        ]
      }]
    })
  })
})

function formatDuration(seconds) {
  if (!seconds) return '0分钟'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}min` : `${m}分钟`
}

function formatRelativeTime(time) {
  if (!time) return '-'
  const diff = Date.now() - new Date(time).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}
</script>

<style scoped>
.user-detail-container { padding: 16px; }
.header-card { margin-bottom: 16px; }
.user-title { font-size: 16px; font-weight: bold; margin-right: 16px; }
.last-active { font-size: 13px; color: #909399; }
.kpi-row { margin-bottom: 16px; }
.kpi-card { text-align: center; padding: 8px 0; }
.kpi-title { font-size: 13px; color: #909399; margin-bottom: 8px; }
.kpi-value { font-size: 26px; font-weight: bold; color: #303133; }
.chart-card { margin-bottom: 16px; }
.chart-row { margin-bottom: 16px; }
</style>
```

- [ ] **Step 2: 提交**

```bash
git add .
git commit -m "feat: 添加用户行为详情页"
```

---

## Chunk 6: IDE 插件 - BehaviorReporter 埋点

### Task 10: 创建 BehaviorReporter

**Files:**
- Create: `src/vs/workbench/contrib/maxian/browser/behaviorReporter.ts`

路径：`/Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/tianhe-zhikai-ide/src/vs/workbench/contrib/maxian/browser/behaviorReporter.ts`

- [ ] **Step 1: 创建 BehaviorReporter 类**

```typescript
import { IMaxianConfig } from '../common/config/maxianConfig'

export const enum BehaviorEventType {
  SESSION_START = 'SESSION_START',
  SESSION_END   = 'SESSION_END',
  TASK_START    = 'TASK_START',
  TASK_END      = 'TASK_END',
  TOOL_USE      = 'TOOL_USE',
  FEATURE_VIEW  = 'FEATURE_VIEW',
  FEATURE_LEAVE = 'FEATURE_LEAVE',
  AI_CALL       = 'AI_CALL',
}

export interface BehaviorEventPayload {
  sessionId: string
  eventType: BehaviorEventType
  featureCode?: string
  clientTs: number
  extraData?: Record<string, unknown>
}

export class BehaviorReporter {
  private sessionId: string
  private featureViewTsMap: Map<string, number> = new Map()
  private baseUrl: string
  private token: string | undefined

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
    // session ID：每次 IDE 激活时生成，关闭时清除
    this.sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  setToken(token: string): void {
    this.token = token
  }

  private report(eventType: BehaviorEventType, featureCode?: string, extraData?: Record<string, unknown>): void {
    const payload: BehaviorEventPayload = {
      sessionId: this.sessionId,
      eventType,
      featureCode,
      clientTs: Date.now(),
      extraData,
    }
    // 异步上报，不阻塞主流程，失败静默处理
    this.postEvent(payload).catch(() => {/* 静默失败 */})
  }

  private async postEvent(payload: BehaviorEventPayload): Promise<void> {
    if (!this.token) return // 未登录不上报
    await fetch(`${this.baseUrl}/behavior/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify(payload),
    })
  }

  reportSessionStart(): void {
    this.report(BehaviorEventType.SESSION_START)
  }

  reportSessionEnd(): void {
    this.report(BehaviorEventType.SESSION_END)
  }

  reportTaskStart(taskId: string): void {
    this.report(BehaviorEventType.TASK_START, undefined, { taskId })
  }

  reportTaskEnd(taskId: string, status: 'success' | 'failed' | 'aborted'): void {
    this.report(BehaviorEventType.TASK_END, undefined, { taskId, status })
  }

  reportToolUse(toolName: string): void {
    this.report(BehaviorEventType.TOOL_USE, undefined, { toolName })
  }

  reportFeatureView(featureCode: string): void {
    this.featureViewTsMap.set(featureCode, Date.now())
    this.report(BehaviorEventType.FEATURE_VIEW, featureCode)
  }

  reportFeatureLeave(featureCode: string): void {
    const enterTs = this.featureViewTsMap.get(featureCode)
    const duration = enterTs ? Math.round((Date.now() - enterTs) / 1000) : undefined
    this.featureViewTsMap.delete(featureCode)
    this.report(BehaviorEventType.FEATURE_LEAVE, featureCode, { duration })
  }

  reportAiCall(
    model: string,
    tokensIn: number,
    tokensOut: number,
    cost: number,
    latencyMs: number,
    success: boolean
  ): void {
    this.report(BehaviorEventType.AI_CALL, undefined, {
      model, tokensIn, tokensOut, cost, latencyMs, success
    })
  }
}
```

- [ ] **Step 2: 在 maxianService.ts 中初始化并注入 BehaviorReporter**

在 `maxianService.ts` 中：

1. 在 `initialize()` 方法中实例化 `BehaviorReporter`，传入后端 baseUrl（从现有的 `serverUrl` 配置中取）
2. 登录成功后调用 `reporter.setToken(token)`
3. `initialize()` 完成后调用 `reporter.reportSessionStart()`
4. `dispose()` 中调用 `reporter.reportSessionEnd()`
5. 将 `reporter` 实例暴露（如 `this.behaviorReporter`），供 `TaskService` 和 `toolExecutorImpl` 使用

> 参考现有 `maxianService.ts` 中 `setSubAgentRunner` 的注入模式

- [ ] **Step 3: 在 TaskService.ts 中挂载 TASK_START / TASK_END / AI_CALL 埋点**

在 `TaskService.ts` 中：
- 接收 `behaviorReporter?: BehaviorReporter` 参数（通过构造函数或 setter 注入）
- 在 `startTask()` 开始时：`this.behaviorReporter?.reportTaskStart(this.taskId)`
- 在任务完成时（attempt_completion）：`this.behaviorReporter?.reportTaskEnd(this.taskId, 'success')`
- 在任务中断时：`this.behaviorReporter?.reportTaskEnd(this.taskId, 'aborted')`
- 在 Claude API 调用返回后记录耗时和 token：`this.behaviorReporter?.reportAiCall(model, tokensIn, tokensOut, cost, latencyMs, success)`

> `TaskService` 已有 `onTokenUsageUpdated` 事件和 `totalCost` 字段，直接复用

- [ ] **Step 4: 在 toolExecutorImpl.ts 中挂载 TOOL_USE 埋点**

在 `toolExecutorImpl.ts` 的 switch/case 分发入口处（每个 case 最开始），调用：
```typescript
context.behaviorReporter?.reportToolUse(toolName)
```

> `ToolExecutionContext` 需新增 `behaviorReporter?: BehaviorReporter` 字段（在 `toolExecutor.ts` 中）

- [ ] **Step 5: 在 maxianView.ts 中挂载 FEATURE_VIEW / FEATURE_LEAVE 埋点**

在 `maxianView.ts` 的 Tab 切换逻辑处：
- 进入 Tab 时：`this.behaviorReporter?.reportFeatureView(featureCode)`
- 离开 Tab 时：`this.behaviorReporter?.reportFeatureLeave(featureCode)`

`featureCode` 映射：
```
chat功能 → 'chat'
代码审查 → 'codeReview'
提交统计 → 'commitStats'
知识库   → 'knowledge'
```

- [ ] **Step 6: TypeScript 编译验证**

```bash
cd /Users/caizhongrui/Documents/workspace/boyo/plugin/ide/src/tianhe-zhikai-ide
npx tsc -p src/tsconfig.json --noEmit 2>&1 | grep -v "web-tree-sitter"
# 期望：0 errors（排除 web-tree-sitter 已知问题）
```

- [ ] **Step 7: 提交**

```bash
git add .
git commit -m "feat: 添加BehaviorReporter埋点模块及挂载点(IDE插件端)"
```

---

## 验收测试

- [ ] **后端验收**：调用 `/behavior/event` 上报一条 `SESSION_START` 事件，查 `t_user_behavior_event` 表可见数据
- [ ] **聚合验收**：手动触发 `BehaviorAggregateTask.hourlyAggregate()`，查 `t_user_behavior_stats` 可见聚合数据
- [ ] **接口验收**：访问 `/behavior/stats/overview?startDate=2026-03-01&endDate=2026-03-15`，返回正确 JSON
- [ ] **前端验收**：进入 `/knowledge/behaviorStats`，看板正常展示 KPI 卡片和4个图表
- [ ] **IDE埋点验收**：启动 IDE，观察 `t_user_behavior_event` 表中出现 `SESSION_START` 事件
