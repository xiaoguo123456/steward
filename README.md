# AI事管家

AI事管家是一套统一管理任务、日程、项目、笔记和结构化记录的个人事务系统。用户通过文字、语音、图片、图片＋文字或图片＋语音提交内容，AI 生成可编辑候选结果，用户确认后进入首页、计划、笔记、数据与复盘流程。

## 当前阶段

当前仓库已建立 Expo 移动端前端工程，并按照 Ardot“清单设计”完成第一版可运行 UI；当前使用本地 Mock 数据，便于优先验收视觉和交互。Go 后端、正式 API 契约与生成 Client 尚未开始实现。

移动端启动：

```bash
pnpm install
pnpm mobile:web
```

## 文档入口

- [功能规格说明](./docs/AI事管家_功能规格说明_MVP_v0.2.md)
- [产品设计说明](./docs/AI事管家_产品设计说明_MVP_v0.1.md)
- [整体架构设计](./docs/AI事管家_整体架构设计_MVP_v0.2.md)
- [原始 PRD](./AI事管家_PRD_v1.0.md)

## 目标工程结构

```text
apps/mobile       Expo / React Native App
apps/backend      Go HTTP API 与 Go River Worker（普通／维护 profile）
packages          OpenAPI/JSON Schema 契约、生成的 TypeScript Client 和 UI
docs              产品、设计、架构和 ADR
infra             本地依赖、部署与可观测配置
```

工程初始化后，移动端与 Go 后端必须继续保留在同一个 Git 仓库中。TypeScript 使用 pnpm workspace，Go 使用根 `go.work` 与后端 `go.mod`；网络字段和错误码以 `packages/contracts/openapi` 为唯一来源，并生成 Go Server/DTO、TypeScript Client、Zod 校验器和 Mock。

## `packages` 是什么

`apps` 是会运行和部署的产品，`packages` 是 App、Go 后端和测试共同使用的“对齐层”。它不作为第三个服务部署，也不承载权威业务状态机。

| 目录 | 职责 | 谁使用 |
|---|---|---|
| `packages/contracts` | OpenAPI、错误码、公共枚举、响应样例和跨语言规则测试向量 | 生成 Go HTTP 类型和 TypeScript Client；两端契约测试 |
| `packages/api-client` | 由 OpenAPI 生成的 TypeScript 请求方法、Query Hooks、Zod 校验和 Mock | `apps/mobile` |
| `packages/ai-contracts` | 服务端 AI 输入输出的 JSON Schema、版本和评估样例 | 生成并校验 Go 后端的 AI 类型；移动端不得导入 |
| `packages/ui` | 设计 Token 与不访问业务数据的跨功能基础组件 | `apps/mobile` |
| `packages/config` | TypeScript、Lint 和测试共享配置 | TypeScript 工作区 |
| `packages/testkit` | Fixture、数据工厂和契约测试工具 | App、契约与集成测试 |

最关键的边界是：Go 后端不会直接导入 TypeScript 包，而是从同一份 OpenAPI／JSON Schema 生成 Go 代码；前后端共享的是可校验契约，不是跨语言复制业务实现。

## 协作规范

编码 Agent 和团队成员开始任务前必须阅读 [AGENTS.md](./AGENTS.md)。代码提交信息、文档说明、代码注释和 PR 描述统一使用中文。
