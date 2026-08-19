# 用户资料与偏好 模块

## 职责

用户资料、显式偏好（周起始、工作时间、默认提醒时刻）与 AI 开关。

## 拥有数据

`users`、`user_preferences`、`user_ai_settings`。

## 公开接口

- `Service.Timezone`：其他模块获取用户时区的唯一入口，时间语义都依赖它。
- `Service.EnsureDefaults`：补齐偏好、AI 设置与默认清单，可重复调用。
- `ProfileAPI` 实现 `/v1/me`、`/v1/me/preferences`、`/v1/me/ai-settings`。

## 依赖

- `lists.EnsureDefaultList`（通过 `DefaultListEnsurer` 接口注入）

## 禁止

- 不返回未脱敏的手机号；`MapUser` 始终输出中间四位打码的形式。
- 显式设置优先于任何学习到的偏好，两者语义冲突时以本模块为准。
