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

## 当前限制

媒体上传通道尚未接入：契约要求非文字输入提供 `media_id`，但还没有上传接口，
因此移动端目前只提交文字输入。
