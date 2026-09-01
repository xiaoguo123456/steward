# 记录项与记录 模块

## 职责

Tracker 字段定义与 Record 录入。Tracker 是可复用的 Schema，Record 是某次实际记录。

## 拥有数据

`trackers`、`records`。

## 公开接口

- CRUD 与统计查询；`TrackerAPI` 实现 `/v1/trackers`、`/v1/records`。
- 事务内 Command：`CreateTrackerInTx` / `CreateRecordInTx` / `UpdateTrackerCommandInTx` /
  `UpdateRecordCommandInTx`，供 Capture 确认使用；更新强制校验 `expected_version`。
- 撤销：实现 `activity.Undoer`。

## 不变量

- Record 的 `values` 必须满足所属 Tracker 的字段定义，必填字段不可缺失。
- `records.values` 在库里是**数组**：`[{key, number_value, text_value}, ...]`，
  不是以字段名为键的对象。写 SQL 时 `values -> '字段名'` 在数组上恒为 NULL，
  要用 `jsonb_array_elements` 按 `key` 找元素（见 `AggregateRecordField`）。
  取错会静默返回 0 而不是报错，用户明明有账却被告知“没有记录”。
- **内置记录项（`builtin_key` 非空）不接受改字段，也不接受删除。**
  写它们的是 Capture 与 AI 编排里按 key 写死的代码（记账的 `amount`／`direction`／`category` 等）。
  字段被改掉之后 `EnsureBuiltin` 不会修回来——它只在不存在时创建——
  之后每次自动记账都以 `RECORD_VALUES_INVALID` 失败，用户看不出这和他改过字段有关。
  改名、换颜色、归档放行：它们不影响按 key 读写。
- 内置记录项不设置频率，也不进入打卡首页读模型；自定义 Tracker 的 `due_today` 按用户时区、频率和当天 Record 确定性计算。
- Record 标题由服务端生成，例如“2026-08-12 · 体重 72.3 kg”。
- 单位换算由服务端完成，客户端不得自行折算后写入。
- 修改 Tracker 字段不会重写历史 Record。
- 自定义 Tracker 归档时写入 `archived_at`，并在同一事务登记 30 天后的 Retention Job；恢复时清空。任务到期后只有本次归档仍有效才软删除 Tracker 及其 Record，列表查询另做当前用户范围内的补偿清理。
- 内置 Tracker 不进入自动删除规则。

## 禁止

- Tracker 不是 Object，也不作为 Relation 的端点。
