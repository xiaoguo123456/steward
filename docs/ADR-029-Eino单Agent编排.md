# ADR-029：Eino 单 Agent 编排

## 文档信息

| 项目 | 内容 |
|---|---|
| 文档类型 | 架构决策记录（ADR-029） |
| 决策状态 | 已接受 |
| 首次接受日期 | 2026-09-03 |
| 更新日期 | 2026-09-03 |
| 实施状态 | 适配器、配置开关、动态审计和双引擎契约测试已完成；测试环境端到端验收后再评估生产切换 |

## 背景

Assistant 已经具备多轮工具调用、流式输出、取消、工具预算、来源审计和 Proposal 确认。继续在 `DirectEngine` 中自行扩展模型—工具循环，会重复维护框架层的事件循环与工具适配；但把业务状态、授权或确认事务交给通用 Agent 框架，又会破坏现有领域边界。

## 决策

1. 引入固定版本 `github.com/cloudwego/eino v0.9.19`，在 `platform/ai/runtime/eino` 实现现有 `OrchestrationEngine`。
2. 只使用一个 Eino ADK `ChatModelAgent`，并顺序执行工具。当前不引入 Multi-Agent、DeepAgent、MCP、Graph Checkpoint 或实验性 Agentic Model。
3. Eino 只负责单次 Turn 内的“模型 → 工具 → 模型”循环。Thread、Message、Turn、Capability Registry、Action Proposal、用户确认、幂等、审计和所有领域状态继续由序事自己的 Go 与 PostgreSQL 负责。
4. 继续复用现有 OpenAI 兼容 Provider Adapter。阿里云地址、`qwen3.8-flash`、工具名映射、流式 usage 与 `enable_thinking=false` 均不由 Eino 重新实现。
5. Eino Tool 是现有 `ai.Capability` 的适配层；每轮只向 Agent 注入当前允许集合。工具参数仍是不可信输入，必须经过 JSON 解析、当前用户隔离、超时、结果截断、重复调用拦截和领域校验。
6. 单次 Turn 保留模型轮数、工具次数、耗时和 token 预算。预算只防止一次后台执行失控，不限制用户继续追问，也不把自然语言对话改成固定步骤状态机。
7. `STEWARD_AI_ENGINE` 选择 `direct` 或 `eino`。开发和生产默认 `direct`；测试环境默认并在模板中显式启用 `eino`，保证旧服务器环境文件未补变量时也能在下一次部署进入灰度。测试账号端到端验收通过后才可把生产环境显式切换为 `eino`，异常时改回 `direct` 并重新部署。
8. Turn 与 AI Action 审计记录实际 `engine_type`；Turn 开始执行时同时记录 `engine_version`。业务表不保存 Eino 私有状态。
9. `DirectEngine` 与 `EinoEngine` 必须通过同一套 Engine Conformance Test。测试至少覆盖直接回答、工具循环、允许集合、未授权拦截、重复调用、单轮预算、用户取消、Provider 故障、来源与用量审计。

## 明确不做

- 不让 Agent 或 Tool 直接写数据库；写操作仍只能生成 Proposal，用户确认后由 Go Domain 执行。
- 不把 Eino Checkpoint 当会话恢复来源，也不新增 `engine_checkpoint_json`。权威消息和状态足以重建下一轮上下文。
- 不把 Capture 的一次结构化解析、图片理解、语音转写、Embedding 等窄任务塞进 Agent。
- 不因使用框架而扩大模型可访问的数据、工具或用户权限。
- 不做真实用户请求的双跑 Shadow，避免同一正文被重复发送、增加延迟和模型成本；先使用共享 Fixture、合成输入和测试账号验证。

## 发布与回滚

1. CI 运行双引擎共享契约测试及后端全量测试。
2. 测试服务器设置 `STEWARD_AI_ENGINE=eino`，使用测试账号验证连续追问、查询工具、Proposal 确认、取消、超时和 SSE。
3. 对比 `assistant_turns.engine_type/engine_version`、工具失败率、降级率、首字延迟、总延迟和 token 用量；日志不得包含用户正文或工具完整结果。
4. 指标和人工交互均通过后，生产环境才从 `direct` 改为 `eino`。不需要数据库迁移，也不需要重新构建移动端。
5. 发生异常时把服务器环境变量改回 `direct` 并重新部署后端；已保存的 Thread、Message、Proposal 和领域数据继续有效。

## 隐私与第三方边界

Eino 作为编译进后端镜像的开源 Go 依赖在自有服务器内运行，不新增远程处理者，也不改变已披露的阿里云模型处理链路。此次变更没有新增移动端权限、SDK、H5 页面、用户字段或数据保留规则，因此不触发新的个人信息清单或应用商店数据申报；将来若接入 Eino 托管服务、远程插件或 MCP Server，必须另行评审和记录。

## 后果

- 优点：复用成熟的单 Agent 工具循环，同时保留现有安全、确认和领域边界；可通过单一环境变量回滚。
- 代价：增加 Eino 与 JSON Schema 适配依赖；Eino 尚未进入 v1，升级必须固定版本、查看变更并重跑全部契约与 Eval。
- 约束：框架事件、状态和类型不得越过 `platform/ai/runtime/eino`；业务代码继续只依赖项目自有接口。

## 依据

- [CloudWeGo Eino 仓库](https://github.com/cloudwego/eino)
- [Eino ADK User Manual](https://www.cloudwego.io/docs/eino/core_modules/eino_adk/)
- [Eino Tool User Manual](https://www.cloudwego.io/docs/eino/core_modules/components/tools_node_guide/)
