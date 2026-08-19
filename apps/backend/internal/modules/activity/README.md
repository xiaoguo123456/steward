# 变更历史与撤销 模块

## 职责

记录用户可见的变更批次，并在撤销窗口内还原。

## 拥有数据

`activity_batches`、`activity_entries`、`async_operations`（读取）。

## 公开接口

- `Service.Record`：在调用方事务内写入批次，必须与业务写入同事务。
- `Service.Undo`：按批次逆序还原。
- `ActivityAPI` 实现 `/v1/activities`、`/v1/activities/{batch_id}/undo`、`/v1/operations/{id}`。

## 不变量

- 撤销回到拥有资源的模块执行（`Undoer` 接口），Activity 自己不修改其他模块的表。
- 目标在本批次之后再次变化时返回 `VERSION_CONFLICT`，不覆盖用户后来的修改。
- 超过撤销窗口（`UndoWindow`）后批次仍可查看但不能撤销。
- 条目只保存本次变更影响的最小前后快照，不复制整个实体，也不保存媒体正文。
