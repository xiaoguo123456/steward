# 登录与令牌 模块

## 职责

手机号验证码登录、Access / Refresh Token 签发与轮换。首次登录时创建用户并触发初始化。

## 拥有数据

`auth_verification_codes`、`auth_refresh_tokens`、`account_deletion_reauth_tokens`。

## 公开接口

- `Service.RequestCode` / `Login` / `Refresh` / `Logout`
- `Service.RequestAccountDeletionCode` / `ReauthenticateAccountDeletion`
- `SessionAPI` 实现契约中的 `/v1/auth/*`

## 依赖

- `users.EnsureDefaults`（通过 `UserInitializer` 接口注入）
- `platform/auth` 的令牌与哈希能力
- `CodeSender` 验证码发送接口；服务器环境由阿里云短信适配器实现
- 测试环境使用固定验证码适配器，不调用外部短信；生产环境禁止启用

## 禁止

- 不保存验证码或令牌明文，两者都只落哈希。
- 不把明文验证码、令牌写入日志、埋点或测试快照。
- 不直接访问其他模块的私表。

短信发送在验证码事务提交后执行，避免外部网络调用占用数据库事务。发送失败时本次验证码立即作废，并返回可重试的 `SMS_PROVIDER_UNAVAILABLE`。

## 特别说明

登录前还没有 `app.user_id`，受 RLS 保护的 `users` 与 `auth_refresh_tokens` 无法直接读写。
登录查询与 Refresh 原子轮换通过迁移中定义的 SECURITY DEFINER 函数访问；因为 sqlc
不解析 `RETURNS TABLE` 的列类型，调用在 `repository.go` 中用 pgx 手写，SQL 集中在该文件内便于审计。

这两张表保持 `ENABLE + FORCE ROW LEVEL SECURITY`。阿里云 RDS 的迁移账号没有
`BYPASSRLS`，因此另有只对表属主、且仅在 `current_user != session_user` 时生效的
最小 SELECT／INSERT 策略；该条件只会在 SECURITY DEFINER 切换执行身份时成立。
相关函数同时撤销 `PUBLIC` 的默认执行权，只允许迁移明确授权的应用角色调用。

账号删除重新认证与登录、换绑使用不同验证码用途。reauth token 绑定用户和
`Idempotency-Key` 稳定派生，数据库只保存 token hash 与请求 hash；相同请求断线重放
返回同一凭证，不重复消费验证码，同键不同验证码返回 `IDEMPOTENCY_KEY_REUSED`。

验证码消费会锁定最新 challenge 行，同一验证码的并发校验只有一个事务能成功。
Refresh Token 带 `family_id` 并通过 `auth_rotate_refresh_token` 在单个数据库事务内完成
旧 Token 锁定、撤销与新 Token 创建；旧 Token 再次出现会撤销整个 family。Access Token
携带不含秘密的 Refresh Session ID，手机号换绑据此只保留当前 family、撤销其他设备，
并通过 `Idempotency-Key` 重放首次成功结果。部署前签发、不含 Session ID 的旧 Access Token
不能执行换绑，需先刷新或重新登录。

## 原生登录态续期与线上 RLS

原生 App 安全存储长期会话，短期 Access Token 到期后用 Refresh Token 续期。迁移
00057 修复受限函数属主下匿名续期的行级安全上下文：先按令牌哈希确定所属用户，
再在该用户隔离范围内锁定、重验并轮换，正常返回前恢复调用者原上下文。
未知、过期、已撤销或账号失效的令牌仍然拒绝；并发重放仍撤销整族。

认证集成测试必须让迁移角色和函数属主均为 NOSUPERUSER、NOBYPASSRLS，不能只约束
应用连接角色。否则 SECURITY DEFINER 内部仍会绕过 RLS，无法覆盖线上行为。
测试／生产发布流水线使用专用受限迁移角色执行空库迁移，并校验函数属主权限。

该修复仅调整数据库函数实现，不改变 API 字段、错误码、网络 Schema 或 AI 行为；
不需要修改 OpenAPI、生成 Client、移动端或 AI Fixture。运行 sqlc 确认生成无漂移。
