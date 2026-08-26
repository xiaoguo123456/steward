# @steward/ai-contracts

服务端 AI 结构化输入输出的 JSON Schema。**移动端不得导入本包。**

## 当前状态

当前定义三条链路：

```text
schemas/capture/capture-parse-result.v3.schema.json
schemas/recipes/seasonal-ingredient-tags.v1.schema.json
schemas/review/review-narrative-result.v2.schema.json
```

前者描述 `apps/backend/internal/platform/ai` 中 `CaptureParseResult` 的完整契约；v3 增加交通、住宿、活动的结束时间、预订字段和素材来源。旧版本作为历史契约保留。
当前的 `fake` Provider 是进程内的确定性实现，输出结构由 Go 类型保证，因此还没有接入运行时 Schema 校验。

时令契约供 `tools/recipe-import/generate_seasonal_tags.py` 离线生成时令食材库。
工具会校验模型原始 JSON、输入覆盖和重复项，并把自然上市月份确定性归并为
春、夏、秋、冬四季；线上菜谱查询不调用模型。

复盘契约要求模型输出短标题、摘要、最多两条指标重点和带来源的建议。
客户端只渲染这些结构化字段，不接受模型输出的 Markdown、HTML 或样式指令。

## 接入真实 Provider 时必须补上的环节

按后端指南第 15 节，模型返回的原始 JSON 属于不可信输入，必须走完整链路：

```text
项目完整 Schema
    → Schema Lint
    → Provider Capability 检查
    → Provider 子集编译（schemacompiler）
    → Provider 请求
    → 原始 JSON
    → 项目完整 Schema 再验证
    → Domain Validation
```

具体来说需要新增：

- `apps/backend/internal/platform/ai/schemacompiler`：把本目录的完整 Schema 编译成 Provider 支持的子集。
  完整 Schema 无法安全映射到当前 Provider 时必须直接失败，不能静默放宽约束。
- 运行时校验：用 `github.com/santhosh-tekuri/jsonschema/v6`（已在 `go.mod` 中）对模型原始输出再次校验。
- `prompts/`：Prompt 按区块版本化，变化时递增 `prompt_version`，不允许只改线上控制台而仓库无记录。
- `evals/`：意图、Proposal、来源与安全 Eval 数据集与基线。

## 边界

- Provider SDK 只允许出现在 `apps/backend/internal/platform/ai/<provider>` 适配器内。
- 生成的 Go 类型只提升编译期可读性，不能替代运行时验证。
- 不能反过来用某个 Provider SDK 的 Go Struct 生成项目权威 Schema。
