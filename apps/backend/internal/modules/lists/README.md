# 清单 模块

## 职责

TaskList 的增删改查。TaskList 是 Task 的轻量分类，不承担 Project 的目标、进度与风险能力。

## 拥有数据

`task_lists`。

## 公开接口

- `Service.EnsureDefaultList`：保证用户恰好有一个默认清单。
- `Service.EnsureShoppingList`：按需返回或创建用户唯一的活动购物清单。
- `Service.ResolveListID`：校验清单归属并在未指定时回退到默认清单，供 Task 创建与 Capture 确认复用。
- `Service.RunArchiveCleanup`：到期后迁移任务并软删除归档清单，重复任务与恢复后的旧任务幂等空跑。
- `ListAPI` 实现 `/v1/task-lists`。

## 不变量

- 每个用户恰好一个默认清单（数据库部分唯一索引保证）。
- 同一用户下未归档清单不可重名。
- 每个用户最多一个未归档、未删除的购物清单。
- 内部默认清单不形成产品特殊项；归档它时必须在同一事务把默认落点转给另一个活动任务清单。
- 至少保留一个活动任务清单。
- 归档时在同一事务登记 Retention Job；可恢复期由 `STEWARD_TASK_LIST_ARCHIVE_RETENTION` 配置，默认 `72h`。
- 到期清理先把 Task 迁入届时的默认清单，再软删除原清单；列表读取对当前用户执行补偿清理。
- 用户提前删除已归档任务清单时，服务端同样自动迁移 Task 并软删除，客户端不负责选择迁移目标。
