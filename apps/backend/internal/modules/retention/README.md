# Retention 模块

本模块拥有账号删除受理状态机与在线数据清理。账号删除必须先由 Auth 签发单用途
reauth token；受理后立即把账号置为 `deletion_pending`、撤销全部会话，并把仅含
`request_id` 的任务送入 retention 队列。

公开状态镜像不保存用户 ID、手机号、对象键或业务内容，只保存用途隔离且不可逆的
账号重放指纹、幂等键摘要和请求摘要。对象存储先按服务端清单
逐个清理，随后由固定 `SECURITY DEFINER` 函数物理删除主库与后台读模型。备份的
最终自然过期时间只来自部署配置，未确认时不得在生产文案中声称具体承诺。

同一用户的受理请求由事务锁串行化。账号进入 `deletion_pending` 后普通 API 立即拒绝；
精确的删除受理 POST 仍允许签名有效的旧 Access Token 以同一键和请求体重放，其他接口
没有例外。`status_token` 由 deletion request ID 稳定派生，数据库只保存摘要，因此无需
持久化敏感响应明文；即使用户主记录已物理删除，同键同请求仍可恢复首次受理结果。

状态顺序为 `accepted → revoking_sessions → purging_assets → purging_derivatives →
purging_primary → completed/failed`。集成测试使用真实 PostgreSQL 与 `steward_app`
角色验证会话撤销、Operation 取消、对象删除、主库物理清理和状态镜像保留。
