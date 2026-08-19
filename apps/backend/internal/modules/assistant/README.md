# assistant

通用对话域。拥有 Thread、Message、Turn、Tool Call 与 Action Proposal。

## 三条硬规则

1. **模型只产建议。** 这个模块里没有任何直接写业务表的代码路径。写入只发生在
   用户点确认之后的 `ProposalService.Confirm` 事务里，并且那个事务会重新读目标、
   重新跑领域校验。模型给的 `reason` 不能替代这一步。
2. **模型不知道任何业务事实。** 它只知道调用过的工具返回了什么。System Policy
   里明说了这一点，Context Builder 也只放引用不放数据。
3. **权威会话是本模块的表。** Provider 侧的任何状态都是可以随时丢弃的优化。

## 文件

| 文件 | 职责 |
|---|---|
| `service.go` | Thread/Message/Turn 的读写，以及 Worker 调用的 `Respond` |
| `context.go` | Context Builder：按优先级组装最小上下文 |
| `capabilities.go` | 只读 Capability 的登记与实现 |
| `capabilities_proposal.go` | Proposal Capability：只构造建议，不写入 |
| `proposals.go` | 建议的落库、读取、确认执行与拒绝 |
| `handler.go` | 契约映射 |
| `cursor.go` | 消息分页用的序号游标 |

## 一次 Turn 的时序

```text
POST /assistant/threads/{id}/turns
  └ 短事务：分配序号 → 写用户消息 → 写 Turn(queued) → 写 Operation → 入队
     ↓（River，ai 队列）
  Respond
  ├ 短事务：StartTurn → 读时区、历史、待确认建议数
  ├ 事务外：buildContextBlocks（记忆检索走自己的短事务）
  ├ 事务外：DirectEngine.RunTurn
  │    └ 每个工具调用各自开一个短 RLS 事务
  └ 短事务：写工具审计 → 写回复消息 → 写建议 → FinishTurn → 完成 Operation
```

外部 Provider 调用绝不在数据库事务内：等模型响应期间持有连接会迅速耗尽连接池。

## 能力的授权边界

`ai.Registry` 只接受在代码里显式登记过的 Capability，不支持按名字反射任意 Go 方法。
`Allowed(allowProposals)` 计算本轮交给模型的工具列表，但那只是**提示**——
`DirectEngine.executeCall` 在每次调用前重新按名字查找并授权，模型请求列表外的工具
一律被拒（`AI_TOOL_NOT_ALLOWED`）并留下审计。

`user_id` 只来自 `CapabilityContext`，即服务端已验证的身份；模型自报的任何身份信息
都被忽略。

## 与 captures 的分工

- 多模态输入、一次整理多个对象 → Capture Candidate + Capture Confirmation。
- 对已存在对象的单项建议、安排、长期记忆 → Action Proposal。

两条链路都遵守"模型只产候选、用户确认后由 Go 写入"，但不共用一张表。

## 依赖方向

本模块依赖 `objects`、`views`、`trackers`、`memory` 的**窄接口**，实体在
`internal/bootstrap` 注入。它不 import 这些模块的私有类型，也不直接读它们的表
（`ListProposalsForTurn` 等只碰自己的表）。
