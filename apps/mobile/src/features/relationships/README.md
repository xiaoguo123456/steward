# 亲友前端模块

## 职责

本模块负责首页“亲友”分区、人物列表的展示模型和人物表单共享组件。全屏路由位于 `src/app/people`。

## 页面与接口

- 首页列表：`GET /v1/people`，支持姓名／关系搜索和关系分组筛选。
- 添加亲友：`POST /v1/people`，对应 `/people/new`。
- 人物详情：`GET /v1/people/{person_id}`，对应 `/people/[id]`。
- 编辑／删除：`PATCH/DELETE /v1/people/{person_id}`，对应 `/people/[id]/edit`。
- 历史互动：`GET/POST /v1/people/{person_id}/interactions`。
- 未来事件：`GET/POST /v1/people/{person_id}/events`，创建正式 Event 并关联当前人物。

## 当前边界

- 首版只支持手动添加，不申请通讯录、相册或通知权限，不读取聊天、通话、邮件或系统联系人。
- 页面不使用演示人物，不以本地 Fixture 回退网络失败。
- 点击人物进入全屏详情；过去的联系保存为 PersonInteraction，未来安排和重要日保存为 Event。
- 当前不向 AI Provider 发送人物、互动或备注，也不提供关系评分、亲密度判断或自动联系建议。

## 数据与隐私

- 移动端只使用生成的 People Client 和 Event DTO，不手写 URL 或网络类型。
- 重要日期继续复用 `event_kind=important_date` Event；人物页只建立关联，不复制日期权威状态。
- 删除人物会删除互动和人物关联，但保留 Event。
- 以后若接系统联系人选择器，优先按人授权，并先更新个人信息清单、权限用途与应用商店申报。
- 若启用 AI 人物能力，必须增加用户开关、最小字段发送、可追溯来源和 Proposal 确认；同名人物、敏感事实和身份无法确定时不得自动关联。

## 禁止依赖

- 不直接依赖后端、数据库、AI Provider 或系统通讯录实现。
- 不建立本地人物网络 DTO，统一使用生成类型。
- 不根据联系频率对关系打分，不根据照片猜测人物身份。
