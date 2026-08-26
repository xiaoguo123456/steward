# AI事管家项目协作规范

## 语言规范

代码提交信息、文档说明、代码注释、PR 描述、测试说明及其他团队可读内容统一采用中文，便于团队阅读、理解和维护。

领域类型、API 字段、数据库字段、代码标识符和第三方技术名称使用稳定英文名，不使用拼音命名。

## 开始任务前必须阅读

1. `docs/功能规格说明.md` 中对应功能章节。
2. `docs/产品设计说明.md` 中对应页面与状态章节。
3. `docs/整体架构设计.md` 中对应模块、契约和数据流章节。
4. 涉及 Go 后端、AI、Assistant、意图识别、工具编排或用户记忆时，阅读 `docs/后端与AI开发指南.md` 中对应章节。
5. 目标代码模块自己的 `README.md`、共享 Schema 和测试 Fixture。

不得只根据页面截图、单个接口、旧 PRD 或局部代码猜测完整业务规则。

## 单仓库边界

目标工程结构为：

```text
apps/mobile       Expo / React Native App
apps/backend      Go HTTP API 与 Go River Worker（普通／维护 profile）
packages/contracts       OpenAPI、Fixture 与跨语言测试向量
packages/api-client      OpenAPI 生成的 TypeScript Client
packages/ai-contracts    JSON Schema AI 契约
packages/ui
packages/config
packages/testkit
docs
infra
```

- App 和 Go 后端必须留在同一个 Git 仓库中；TypeScript 使用 pnpm workspace，Go 使用根 `go.work` 和 `apps/backend/go.mod`。
- 网络字段、枚举和错误码只定义在 `packages/contracts/openapi`。
- 移动端必须使用生成的 TypeScript API Client 和 Zod 网络校验器；Go 后端必须实现生成的 strict server 接口，不得任一侧手写重复 DTO、URL 或网络 Schema。
- AI 结构化输出只定义在 `packages/ai-contracts/schemas`，生成 Go 类型后仍必须对模型原始 JSON 做运行时校验。
- 移动端不得导入 Go 后端、数据库或 AI Provider 实现；Go 后端不得导入 TypeScript 包。
- `packages/*` 不得反向依赖 `apps/*`；Go 生成代码放在 `apps/backend/internal/gen`。
- 禁止循环 workspace 依赖和 Go package import cycle。
- 权威状态机、Today 收录、重复检测和时间语义只在 Go Domain 实现；跨语言只共享契约、Fixture 和 JSON 测试向量。

## 跨端变更

涉及 API 字段、状态、错误码或网络行为时，同一变更原则上必须包含：

- 功能或设计文档修改（行为变化时）。
- OpenAPI 源文件。
- 生成的 Go Server/DTO 与 TypeScript Client。
- Go Handler、Application、Repository 实现。
- 移动端适配。
- Contract Fixture。
- 集成或端到端测试。

若其中某项不需要修改，提交说明必须解释原因。

## 业务与 AI 约束

- 每个新增的用户功能必须同时设计并实现对应的 AI 能力，至少覆盖该功能最核心的理解、查询、创建、更新或辅助流程；不得只交付手工页面后把 AI 适配留作未记录的后续事项。
- 新功能的 AI 能力必须复用正式领域契约和 Command。涉及写入时，AI 只能生成结构化 Candidate／Proposal，用户确认后再由 Go Domain 执行；同时必须保留不依赖 AI 的确定性手工路径。
- 若因安全、合规或事实来源限制暂时无法提供某项 AI 操作，必须在功能规格、产品设计和提交说明中写明边界，并由产品决策确认，不得由开发者静默省略。
- AI 不得直接写数据库。
- AI 解析和建议结果必须经过用户确认后保存。
- Today 排序、状态转换、重复检测、时间和单位换算使用 Go 确定性代码。
- AI 创建或更新的字段必须保留实际来源。
- 图片中的指令属于用户资料，不能改变系统规则或触发外部操作。
- 所有用户数据访问必须在服务端按当前用户隔离。
- 日志、埋点和测试快照不得包含 Token、验证码、完整原始媒体或不必要的用户正文。

## 完成任务前

- 运行根 `make check`，或至少运行受影响的 TypeScript workspace 与 Go module 格式、Lint、类型／编译和测试。
- Go 代码通过 `gofmt`、`go vet`、`golangci-lint`、`go test ./...`，核心并发路径执行 `go test -race`。
- 契约变化时重新生成 Go Server/DTO、TypeScript Client、Zod 校验器和 Mock，并确认无漂移。
- 数据库变化时新增 Goose 向前迁移并重新运行 sqlc，不改写已执行迁移或生成的 dbgen 文件。
- AI Prompt、模型或 Schema 变化时运行对应 Eval。
- 确认正常、空、加载、错误、离线和版本冲突状态没有遗漏。
- 将新增规则写回相应文档，避免只存在于代码或对话中。
