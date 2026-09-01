# 通知中心

通知中心对应功能规格 F-14 与页面 NOT-01，只读取正式 `GET /v1/notifications`，并通过 `POST /v1/notifications/{notification_id}/read` 保存首次已读时间。

- 服务端按发生时间倒序返回，客户端只按设备本地自然日分成“今天／更早”，不改变组内顺序。
- 未读同时使用圆点、字重和无障碍朗读表达，不能只依赖颜色。
- Task、Event、Project 与 Review 分别进入现有正式详情路由。
- `source_deleted=true` 时保留标题快照，正文显示“内容已删除”；点击只标记已读，不打开空白详情。
- 首屏、空、错误、下拉刷新与游标分页均有独立状态；网络失败不使用 Fixture 或本地 Mock 回退。
- 这是产品内通知，不申请设备通知权限，也不暗示 Push 已送达。
