# 行程模块

## 页面职责

- `/trips` 展示近期和历史行程，并提供右上角和空状态新建入口，不复用计划日历。
- `/trips/new` 收集名称、目的地、开始／结束日期和可选注意事项，通过生成的 API Client 创建 `project_kind=trip` 的 Project。
- `/trips/new-item` 新增结构化的交通、住宿或活动 Event。
- `/trips/[id]` 展示按天安排、交通／住宿预订详情和行前清单，右上角“＋”同时提供手工新增与 AI 票据识别。

## 领域映射

`TripPlan`、`TripDay`、`TripBooking` 和 `TripChecklistItem` 是由网络对象映射出的页面展示模型，不是网络 DTO，也不代表新增 Trip 领域：

- 整体行程由 Project 组织。
- 交通、住宿和活动时间由 Event 表达。
- 行前准备项由 Task 表达。
- Event 的 `itinerary_details` 保存安排类型、路线、班次、座位、状态和票据媒体 ID。
- 新建页把目的地写在 Project description 第一行，余下内容作为注意事项展示；不另建网络字段。

页面只通过生成的 TypeScript API Client 读取与写入。AI 从图片或文本识别出的行程内容只能形成候选，用户确认后才能保存。
