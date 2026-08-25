# 聚合读模型 模块

## 职责

Today、日历、周复盘与搜索四个只读聚合。本模块不拥有任何数据。

## 公开接口

`ViewAPI` 实现 `/v1/today`、`/v1/calendar`、`/v1/reviews/weekly`、`/v1/search`。

## 不变量

- Today 的收录与排序完全由 `db/queries/tasks.sql` 的 `ListTodayTasks` 决定，
  规则来自功能规格 8.3 与 8.4，客户端不得重排。
- 分组顺序固定为已逾期、今天截止、今天有计划时间、手动加入今天；
  一个 Task 只进入顺序最靠前的分组。
- 复盘指标由 SQL 确定性计算：Provider 不可用时 `narrative` 为空，指标与来源仍完整可用。
- 周复盘 AI 只返回短标题、摘要、最多两条指标重点和带来源建议；原始 JSON 必须通过版本化 Schema。
- 指标与环比变化都为空时不调用模型，客户端直接展示空周状态。
- 搜索只返回已确认的正式内容，处理中或待确认的 Capture 候选不会出现。

## 特别说明

中文检索使用 `pg_trgm` 三元组索引配合 `ILIKE`。
Postgres 默认分词器不切分中文，`to_tsvector` 会把整句当成一个词，无法命中子串。
