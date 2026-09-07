# @steward/ai-contracts

服务端 AI 结构化输入输出的 JSON Schema。**移动端不得导入本包。**

## 当前状态

当前定义六条链路：

```text
schemas/capture/capture-parse-result.v4.schema.json
schemas/recipes/seasonal-ingredient-tags.v1.schema.json
schemas/review/review-narrative-result.v2.schema.json
schemas/notes/note-polish-result.v1.schema.json
schemas/mood-journal/mood-reflection-result.v1.schema.json
schemas/mood-journal/mood-journal-polish-result.v1.schema.json
```

前者描述 `apps/backend/internal/platform/ai` 中 `CaptureParseResult` 的完整契约；v4 在行程字段基础上增加稳定候选引用、已有实体更新目标和关系候选。旧版本作为历史契约保留。
当前的 `fake` Provider 是进程内的确定性测试替身，输出结构由 Go 类型保证，因此没有接入运行时 Schema 校验。它只允许在 development/test 显式使用，不是产品级理解能力，不得作为生产 Provider 或真实 Provider 的静默 fallback。

时令契约供 `tools/recipe-import/generate_seasonal_tags.py` 离线生成时令食材库。
工具会校验模型原始 JSON、输入覆盖和重复项，并把自然上市月份确定性归并为
春、夏、秋、冬四季；线上菜谱查询不调用模型。

复盘契约要求模型输出短标题、摘要、最多两条指标重点和带来源的建议。
客户端只渲染这些结构化字段，不接受模型输出的 Markdown、HTML 或样式指令。

笔记润色契约只返回标题与纯文本正文。已有标题由服务端确定性保留；标题为空时
模型才生成标题。结果先回填编辑器，用户保存后才写入 Note，并通过 AI Action
来源引用保留这次润色的实际来源。该契约只接受 `NoteContent.format=plain_text`
的普通 Note；心情日记的 `blocks_v1` 文档不得复用它，以免富文本结构被压平成
字符串。心情日记不复用它，而是使用独立的 `mood-journal-polish-result.v1`：
结果返回完整 `blocks_v1` 候选，Go 确定性重验原块 ID、顺序、链接、数字／日期
与块文档上限，新增拆分块由服务端生成正式 ID；保存时同样通过 AI Action 保留来源。

心情日记回望契约只用于用户主动选择范围并单独同意后的深度回望，输出为摘要、
带日记来源的观察、反思问题和温和建议。运营主体与目标 Provider 已确定为
琼海绘象图数字科技有限公司和阿里云百炼；在敏感正文处理的合同登记、真实模型回归与
部署门禁完成前，客户端只开放 Go 确定性统计，真实日记正文不会进入 Provider。
Schema、Prompt 和契约安全 Eval 已先固化。当前 Eval 只确定性检查输入边界、
来源字段、诊断禁令和输出上限，不冒充真实模型质量评测；待合规与 Provider 敏感等级
门禁完成后，再接正式 Operation、保存确认链路和 Provider 运行时 Eval。

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

## 无意义与模糊输入真实评测

`evals/ambiguity-live.json` 定义 37 个真实模型场景，包括多轮补充、取消和 Capture 入口。该 JSON 由后端 `TestLiveAmbiguityAcceptance` 单独加载，不混入使用脚本 Provider 的 JSONL 基线；仅在 `STEWARD_AI_LIVE_AMBIGUITY=1` 时执行。当前保留已复现的质量失败，不降低断言来获得通过。说明与修复顺序见 `docs/Agent模糊输入实测与改进方案-2026-09-07.md`。
