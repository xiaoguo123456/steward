# memory

长期语义记忆。拥有 Memory Item、Evidence、Revision 与 Relearn Block。

## 三条硬规则

1. **不静默学习。** 这个模块没有"从行为里自动记住"的路径。`UpsertInTx` 只由
   `assistant` 的建议确认事务调用，也就是说用户一定点过确认。
2. **每条记忆都有来源。** `memory_evidence` 记录它从哪来。用户在设置页能看到
   "系统为什么记住这个"。来源被删除后显示 tombstone，不把原文复制进记忆表。
3. **删除是真的删除。** `Delete` 立即把状态改为 deleted，检索与 Prompt 上下文
   当场就看不到它。

## 与显式设置的分工

- `user_preferences`：产品设置和用户直接填写的稳定偏好。
- `memory_items`：对话中提出、经用户确认的补充上下文。

两者表达同一语义时以显式设置为准，记忆标记为 `shadowed`。

## Relearn Block 为什么只存指纹

用户选择"不再学这项"时，我们需要在下次模型提出同一语义时挡住它，但又不能把
被删除的内容留在库里——那样"删除"就只是换了张表存着。

折中是存一个 HMAC 指纹：
`HMAC(key, version || memory_key || normalize(canonical_text))`。

关键在于 `normalize`：如果直接哈希用户原句，同一个偏好换一种说法、多一个空格
就绕过去了，阻止等于没有生效。当前的规范化只做去空白与大小写折叠；换更强的
语义归一化时必须递增 `FingerprintKeyVersion`，让旧指纹和新指纹并存而不是
错误比对。

指纹密钥来自 `STEWARD_MEMORY_FINGERPRINT_KEY`，是独立用途的密钥，
不复用 JWT 密钥：两者的轮换周期与泄漏影响完全不同。

## 敏感记忆

`retrievableSensitivity` 目前只有 `normal`：高敏记忆默认不参与检索，也不会
进入 Prompt。健康、财务、住址、家庭关系、受保护属性都属于高敏，只允许用户
明确输入并单独确认，不通过行为推断。高敏记忆删除后不提供恢复入口
（`DeleteResult.Recoverable = false`）。

## 检索

`Search` 先做确定性过滤（用户、status=active、敏感级别、有效期），再按
"用户显式说出的优先"和最近使用时间排序。返回条数有上限，不返回完整记忆库。

`TouchMemoryUsed` 只记录使用时间用于排序——被模型引用过**不**提高这条记忆
的事实可信度。
