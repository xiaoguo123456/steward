# 记录项与记录 模块

## 职责

Tracker 字段定义与 Record 录入。Tracker 是可复用的 Schema，Record 是某次实际记录。

## 拥有数据

`trackers`、`records`。

## 公开接口

- CRUD 与统计查询；`TrackerAPI` 实现 `/v1/trackers`、`/v1/records`。
- 事务内 Command：`CreateTrackerInTx` / `CreateRecordInTx`，供 Capture 确认使用。
- 撤销：实现 `activity.Undoer`。

## 不变量

- Record 的 `values` 必须满足所属 Tracker 的字段定义，必填字段不可缺失。
- Record 标题由服务端生成，例如“2026-08-12 · 体重 72.3 kg”。
- 单位换算由服务端完成，客户端不得自行折算后写入。
- 修改 Tracker 字段不会重写历史 Record。

## 禁止

- Tracker 不是 Object，也不作为 Relation 的端点。
