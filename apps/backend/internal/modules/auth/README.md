# 登录与令牌 模块

## 职责

手机号验证码登录、Access / Refresh Token 签发与轮换。首次登录时创建用户并触发初始化。

## 拥有数据

`auth_verification_codes`、`auth_refresh_tokens`。

## 公开接口

- `Service.RequestCode` / `Login` / `Refresh` / `Logout`
- `SessionAPI` 实现契约中的 `/v1/auth/*`

## 依赖

- `users.EnsureDefaults`（通过 `UserInitializer` 接口注入）
- `platform/auth` 的令牌与哈希能力

## 禁止

- 不保存验证码或令牌明文，两者都只落哈希。
- 不把明文验证码、令牌写入日志、埋点或测试快照。
- 不直接访问其他模块的私表。

## 特别说明

登录前还没有 `app.user_id`，受 RLS 保护的 `users` 与 `auth_refresh_tokens` 无法直接读写。
这三个查询通过迁移中定义的 SECURITY DEFINER 函数访问，并因为 sqlc 不解析
`RETURNS TABLE` 的列类型而在 `repository.go` 中用 pgx 手写，SQL 集中在该文件内便于审计。
