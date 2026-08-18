# 行程前端原型

## 页面职责

- `/trips` 展示近期和历史行程，不复用计划日历。
- `/trips/[id]` 展示单次行程的按天安排、交通／住宿预订摘要和行前清单。
- 首版不引入地图、定位、外部订单导入或新的原生依赖。

## 领域映射

当前 `TripPlan`、`TripDay`、`TripBooking` 和 `TripChecklistItem` 都是非权威的本地展示 Fixture，不是网络 DTO，也不代表新增 Trip 领域：

- 整体行程由 Project 组织。
- 交通、住宿和活动时间由 Event 表达。
- 行前准备项由 Task 表达。
- 票据、预订确认与补充资料由 Note、附件及 Relation 表达。

正式接入时必须先扩展对应聚合查询契约，通过生成的 TypeScript API Client 读取数据。AI 从图片或文本识别出的行程内容只能形成候选，用户确认后才能保存；页面不得直接写数据库或把本地 Fixture 提升为 Contracts。
