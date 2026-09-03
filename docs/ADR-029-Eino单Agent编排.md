# ADR-029：Eino 单 Agent 编排

## 文档信息

| 项目 | 内容 |
|---|---|
| 文档类型 | 架构决策记录（ADR-029） |
| 决策状态 | 已接受 |
| 首次接受日期 | 2026-09-03 |
| 更新日期 | 2026-09-03 |
| 实施状态 | Eino 已成为 Assistant 唯一编排实现；旧自研引擎及运行时切换开关已删除，行为契约与动态审计继续保留 |

## 背景

Assistant 已经具备多轮工具调用、流式输出、取消、工具预算、来源审计和 Proposal 确认。此前同时维护自研工具循环与 Eino 适配器，重复承担相同的事件循环、工具适配和测试成本；但把业务状态、授权或确认事务交给通用 Agent 框架，又会破坏现有领域边界。Eino 单 Agent 已通过项目行为契约验证，因此不再保留第二套生产编排实现。

## 决策

1. 引入固定版本 `github.com/cloudwego/eino v0.9.19`，在 `platform/ai/runtime/eino` 实现现有 `OrchestrationEngine`。
2. 只使用一个 Eino ADK `ChatModelAgent`，并顺序执行工具。当前不引入 Multi-Agent、DeepAgent、MCP、Graph Checkpoint 或实验性 Agentic Model。
3. Eino 只负责单次 Turn 内的“模型 → 工具 → 模型”循环。Thread、Message、Turn、Capability Registry、Action Proposal、用户确认、幂等、审计和所有领域状态继续由序事自己的 Go 与 PostgreSQL 负责。
4. 继续复用现有 OpenAI 兼容 Provider Adapter。阿里云地址、`qwen3.8-flash`、工具名映射、流式 usage 与 `enable_thinking=false` 均不由 Eino 重新实现。
5. Eino Tool 是现有 `ai.Capability` 的适配层；每轮只向 Agent 注入当前允许集合。工具参数仍是不可信输入，必须经过 JSON 解析、当前用户隔离、超时、结果截断、重复调用拦截和领域校验。
6. 单次 Turn 保留模型轮数、工具次数、耗时和 token 预算。预算只防止一次后台执行失控，不限制用户继续追问，也不把自然语言对话改成固定步骤状态机。
7. Eino v0.9.19 单 Agent 是 Assistant 唯一可用编排实现；删除旧自研引擎与 `STEWARD_AI_ENGINE` 环境变量，所有环境使用同一装配路径。
8. Turn 与 AI Action 审计继续记录实际 `engine_type` 与 `engine_version`。既有 `direct` 历史记录保持原样，新增 Turn 记录 `eino` 与当前适配器版本；业务表不保存 Eino 私有状态。
9. Engine Conformance Test 继续作为项目自有 `OrchestrationEngine` 的共享行为契约。当前由 Eino 实现执行，未来替换框架时必须复用同一套测试；至少覆盖直接回答、工具循环、允许集合、未授权拦截、重复调用、单轮预算、用户取消、Provider 故障、来源与用量审计。

## 明确不做

- 不让 Agent 或 Tool 直接写数据库；写操作仍只能生成 Proposal，用户确认后由 Go Domain 执行。
- 不把 Eino Checkpoint 当会话恢复来源，也不新增 `engine_checkpoint_json`。权威消息和状态足以重建下一轮上下文。
- 不把 Capture 的一次结构化解析、图片理解、语音转写、Embedding 等窄任务塞进 Agent。
- 不因使用框架而扩大模型可访问的数据、工具或用户权限。
- 不做真实用户请求的双跑 Shadow，避免同一正文被重复发送、增加延迟和模型成本；先使用共享 Fixture、合成输入和测试账号验证。

## 发布与回滚

1. CI 运行 Engine Conformance Test、后端全量测试与核心并发路径竞态测试。
2. 测试服务器使用测试账号验证连续追问、查询工具、Proposal 确认、取消、超时和 SSE；所有环境都由 Bootstrap 固定装配 Eino，不依赖额外环境变量。
3. 观察 `assistant_turns.engine_type/engine_version`、工具失败率、降级率、首字延迟、总延迟和 token 用量；日志不得包含用户正文或工具完整结果。
4. 这次收敛不需要数据库迁移，也不需要重新构建移动端。已保存的 Thread、Message、Proposal 和领域数据继续有效。
5. 发生异常时回滚到最近验证通过的 Eino 后端构建；不得通过环境变量切回已删除的实现。若未来替换编排框架，必须实现同一接口、通过同一行为契约并另立 ADR。

## 隐私与第三方边界

Eino 作为编译进后端镜像的开源 Go 依赖在自有服务器内运行，不新增远程处理者，也不改变已披露的阿里云模型处理链路。此次变更没有新增移动端权限、SDK、H5 页面、用户字段或数据保留规则，因此不触发新的个人信息清单或应用商店数据申报；将来若接入 Eino 托管服务、远程插件或 MCP Server，必须另行评审和记录。

## 后果

- 优点：只维护一套成熟的单 Agent 工具循环，同时保留现有安全、确认和领域边界；开发、测试和生产使用一致的装配路径。
- 代价：不再有进程启动时切换到旧引擎的即时回滚路径；异常恢复依赖部署上一版已验证构建。Eino 尚未进入 v1，升级必须固定版本、查看变更并重跑全部契约与 Eval。
- 约束：框架事件、状态和类型不得越过 `platform/ai/runtime/eino`；业务代码继续只依赖项目自有接口。

## 依据

- [CloudWeGo Eino 仓库](https://github.com/cloudwego/eino)
- [Eino ADK User Manual](https://www.cloudwego.io/docs/eino/core_modules/eino_adk/)
- [Eino Tool User Manual](https://www.cloudwego.io/docs/eino/core_modules/components/tools_node_guide/)
