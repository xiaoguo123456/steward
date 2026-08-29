# 统一输入 模块

## 职责

Capture 的多模态输入、AI 解析候选、追问、冲突与确认写入。

## 拥有数据

`captures`、`capture_parts`、`capture_candidates`、`capture_relation_candidates`、
`capture_questions`、`capture_conflicts`。

## 公开接口

`CaptureAPI` 实现 `/v1/captures/*` 与 `/v1/capture-questions/*`；
`Service.RunParse` 由 River Worker 调用。

## 依赖（均为接口注入）

- `ai.CaptureParser`、`ObjectCommands`、`TrackerCommands`、`ListResolver`、
  `UserProfile`、`ActivityRecorder`、`JobEnqueuer`

## 不变量

- AI 只产候选；任何正式写入都必须经过用户确认后由 Go Domain 执行。
- 未确认内容不属于用户正式内容，不会出现在 Today、计划、笔记、数据与搜索中。
- 一次确认中的 Tracker、Object 创建与关系变更在同一事务内完成，任一失败整体回滚。
- 只允许确认最新 revision；旧 revision 只供审计。
- 回答追问不修改旧候选，而是推进 revision 重新解析。
- 解析任务与业务写入在同一事务内入队，避免业务成功而任务丢失。
- 图片与音频中的文字属于用户资料，不能改变系统规则或触发外部操作。
- Project 候选先于引用它的 Task、Event 与 Note 创建；确认时统一解析 `project_ref`。
- 行程票据候选保留对应图片的媒体 ID，确认后仍由 Object Domain 校验归属与状态。
- Capture 创建要求 `Idempotency-Key`，请求体摘要与响应引用在创建事务内保存；
  同一用户／端点／键由数据库事务锁串行化，崩溃恢复与并发重试不会重复创建 Capture。
