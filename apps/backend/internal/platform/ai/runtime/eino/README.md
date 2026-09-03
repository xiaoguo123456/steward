# Eino 单 Agent 适配器

本目录只把 CloudWeGo Eino ADK 适配到项目自有 `ai.OrchestrationEngine`。它负责单次 Turn 内的模型—工具循环，不拥有 Thread、Message、Proposal、用户记忆或领域状态。

## 边界

- `providerModel` 复用现有 `ai.ChatProvider`，不直接读取环境变量，也不绑定阿里云或某个模型。
- `capabilityTool` 只能执行调用方为本轮传入的 `ai.Capability`；参数视为不可信输入，并执行次数、重复、超时和结果大小限制。
- Tool 不能直接写数据库。写入意图只能返回 `ProposalDraft`，之后仍由 Assistant 的确认事务执行正式 Command。
- 不保存 Eino Checkpoint。下一轮上下文由项目自己的 PostgreSQL 消息和审计记录重建。
- Eino 类型不得进入 Domain、OpenAPI、数据库公共字段或移动端。

## 验证

`runtime/internal/conformancetest` 是 DirectEngine 与 EinoEngine 共用的行为契约。修改适配器后至少运行：

```bash
go test ./internal/platform/ai/runtime/eino ./internal/platform/ai/runtime/direct
```

架构选择、灰度与回滚规则见 `docs/ADR-029-Eino单Agent编排.md`。
