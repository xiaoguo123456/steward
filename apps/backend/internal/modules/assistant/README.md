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
  ├ 事务外：OrchestrationEngine.RunTurn（EinoEngine）
  │    └ 每个工具调用各自开一个短 RLS 事务
  └ 短事务：写工具审计 → 写回复消息 → 写建议 → FinishTurn → 完成 Operation
```

外部 Provider 调用绝不在数据库事务内：等模型响应期间持有连接会迅速耗尽连接池。

## 能力的授权边界

`ai.Registry` 只接受在代码里显式登记过的 Capability，不支持按名字反射任意 Go 方法。
`Allowed(allowProposals)` 计算本轮交给模型的工具列表，但那只是**提示**——编排引擎
只执行本轮显式注入的能力，模型请求列表外的工具一律被拒（`AI_TOOL_NOT_ALLOWED`）
并留下审计。

`user_id` 只来自 `CapabilityContext`，即服务端已验证的身份；模型自报的任何身份信息
都被忽略。

## 编排引擎

- Assistant 固定使用 Eino v0.9.19 的单 `ChatModelAgent`，只管理单次 Turn 内的模型—工具循环，不保存权威状态。
- 项目继续保留自有 `ai.OrchestrationEngine` 边界；Assistant、Domain、OpenAPI 和数据库不依赖 Eino 类型。
- `runtime/internal/conformancetest` 持续验证直接回答、工具循环、权限、Proposal、预算、取消、Provider 故障、来源和用量审计等共享行为。
- 不提供 `STEWARD_AI_ENGINE` 运行时开关。编排实现变更必须通过代码评审、契约测试和部署完成，不能由环境变量切回已删除的实现。

详细边界见 `docs/ADR-029-Eino单Agent编排.md`。

## 与 captures 的分工

- 多模态输入、一次整理多个对象 → Capture Candidate + Capture Confirmation。
- 对已存在对象的单项建议、安排、长期记忆 → Action Proposal。

两条链路都遵守"模型只产候选、用户确认后由 Go 写入"，但不共用一张表。

## 依赖方向

本模块依赖 `objects`、`views`、`trackers`、`memory` 的**窄接口**，实体在
`internal/bootstrap` 注入。它不 import 这些模块的私有类型，也不直接读它们的表
（`ListProposalsForTurn` 等只碰自己的表）。

## 进度流的传输是可切换的

回复在 Worker 里生成，SSE 连接挂在 API 进程上，两者不共享内存，因此需要一条
跨进程广播通道。它由 `platform/streams` 提供，有两个适配器：

- `redisstream` —— Redis Pub/Sub。有 Redis 的部署用它。
- `pgnotify` —— PostgreSQL LISTEN/NOTIFY。零额外依赖，本地开发默认。

之所以能随便换，是因为**这条通道从不承载权威状态**：丢事件、连不上、
整个关掉，客户端读 Message 与 Operation 都能拿到完整结果。这也是为什么
适配器里没有重连退避、没有持久化、没有 ACK——那些都是给权威通道用的。

pgnotify 的三个代价都是结构性的，不是实现不好：LISTEN 是连接级状态所以每条流
独占一个数据库连接；PgBouncer 的 transaction 模式会让它彻底失效；单条 NOTIFY
载荷上限 8000 字节。最后一条尤其要小心——delta 是替换语义，超限时只能截断成
**前缀**并打 `truncated` 标记，切成多段会让客户端只显示最后一段。

## 默认对话连续性

- `GET /assistant/threads/current` 按 Users 提供的时区计算当地自然日，只读取当天最近发生用户消息的 active Thread；没有时返回空，不创建 Thread。
- `POST /assistant/threads` 仅在用户发送第一条消息时调用。无标题且未设置 `force_new` 时复用当天 Thread；`force_new=true` 始终创建新 Thread。
- 默认 Thread 的判断依据是用户消息时间，不是 Thread 的 `updated_at`。因此 Worker 在午夜后补完 Assistant 回复不会把昨天的对话变成今天的默认对话。
- 默认创建路径使用用户级事务 advisory lock，并只复用 `created_for_default=true` 的当天空 Thread，避免两个设备同时发首条消息时堆出空壳，也不会接管尚未发送的显式“新对话”。
