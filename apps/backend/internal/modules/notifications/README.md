# Notifications 模块

本模块拥有产品内通知快照、分页列表、来源删除态与首次已读时间。

当前真实触发来源只有已实现的 Event Reminder 与 Task Due：列表查询先调用
`views.PendingReminders` 的确定性时间／时区计算，再按稳定复合 ID 幂等写入
`notifications`。通知只保存标题、类型、来源和发生时间，不复制 Object 正文。

`daily_brief`、`project_risk`、`weekly_review` 已进入公开枚举，供对应上游能力
完成后写入；当前不得在此模块凭空生成。设备 Token、Push Delivery、通知设置
与后台 Scheduler 也不在当前实现范围内，系统通知权限不影响产品内列表。
