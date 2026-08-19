# 清单 模块

## 职责

TaskList 的增删改查。TaskList 是 Task 的轻量分类，不承担 Project 的目标、进度与风险能力。

## 拥有数据

`task_lists`。

## 公开接口

- `Service.EnsureDefaultList`：保证用户恰好有一个默认清单。
- `Service.ResolveListID`：校验清单归属并在未指定时回退到默认清单，供 Task 创建与 Capture 确认复用。
- `ListAPI` 实现 `/v1/task-lists`。

## 不变量

- 每个用户恰好一个默认清单（数据库部分唯一索引保证）。
- 同一用户下未归档清单不可重名。
- 默认清单不能删除也不能归档；删除非空清单必须先指定 Task 的迁移目标。
- 归档只隐藏清单，不删除其中的 Task。
