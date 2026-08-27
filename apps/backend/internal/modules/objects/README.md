# Task、Event、Project 与 Note 模块

## 职责

四类核心 Object 的状态机、时间语义与校验。它们共享通用字段（来源、软删除、版本），因此放在同一模块。

## 拥有数据

`tasks`、`events`、`projects`、`notes`、`relations`。

## 公开接口

- 查询与 CRUD：`ListTasks` / `CreateTask` / `UpdateTask` / `DeleteTask`，Event、Project、Note 同理。
- Note 草稿润色：`PolishNoteDraft` 只生成待检查草稿，不直接写 Note；用户保存时校验并记录 AI Action 来源。
- 事务内 Command：`CreateTaskInTx` / `CreateEventInTx` / `CreateNoteInTx` / `CreateProjectInTx`，
  供 Capture 确认在同一事务中写入。
- 撤销：实现 `activity.Undoer`。
- 映射：`MapTask` / `MapEvent` / `MapProject` / `MapNote` / `ProjectYearlyEvents`。

## 依赖（均为接口注入）

- `ListResolver`（lists）、`UserProfile`（users）、`ActivityRecorder`（activity）、`MediaResolver`（media）、`ChatProvider` 与 `aiaudit.Recorder`（可选润色增强）

## 不变量

- `due_date` 与 `due_at` 互斥；设置任一者都必须保存所属时区。
- `due_date` 表示“某日截止”，不补成当天 23:59；越过该时区的日期边界才算逾期。
- 定时 Event 与全天 Event 的字段两组互斥。
- `itinerary_details` 只能用于 `project_kind=trip` 的 Event；交通和住宿必须有完整起止时间，票据只能引用当前用户已上传的图片。
- 只有 `important_date` 可以按年重复；2 月 29 日在非闰年投影到 2 月 28 日，
  但 `original_month_day` 保留原值。
- Task 状态只能按 `todo/doing → done/cancelled`、`done/cancelled → todo` 流转。
- Project 的 `progress` 由 Task 计数实时计算，不落库；没有有效 Task 时为 null。
- `list_kind=shopping` 的 Task 只进入购物读模型，不进入计划、Today、日历、搜索和复盘任务统计。

## 禁止

- 不直接访问 `task_lists`、`users`、`activity_*` 表，一律通过注入的接口。
