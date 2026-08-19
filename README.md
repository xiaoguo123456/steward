# AI事管家

AI事管家是一套统一管理任务、日程、项目、笔记和结构化记录的个人事务系统。用户通过文字、语音、图片、图片＋文字或图片＋语音提交内容，AI 生成可编辑候选结果，用户确认后进入首页、计划、笔记、数据与复盘流程。

## 当前阶段

仓库已经打通「移动端 → 契约 → Go 后端 → PostgreSQL」的完整链路。对照 [后端与 AI 开发指南](./docs/后端与AI开发指南.md) 第 25 节的分阶段计划：

| 阶段 | 状态 |
|---|---|
| 阶段 0 决策与骨架 | 已完成 |
| 阶段 1 无 AI 的后端闭环 | 已完成 |
| 阶段 2 AI Platform 基础 | Provider 中立接口与确定性 Fake 实现已完成，真实 Provider 未接入 |
| 阶段 3 Capture 正式闭环 | 文字输入已完成；媒体上传、转写与 OCR 未接入 |
| 阶段 4～8 | 未开始 |

即使关闭全部 Provider，用户仍可以用表单管理正式内容；Today、状态转换、时间语义与重复检测都只有 Go 实现。

## 本地启动

需要 Go 1.26、Node 22、pnpm 10 与 PostgreSQL 16 以上。

```bash
cp .env.example .env
createdb steward_dev

pnpm install
make migrate      # 建表、启用 RLS、创建应用角色、初始化 River 队列
make seed         # 演示数据：用户 13800138000，验证码 123456

STEWARD_EMBEDDED_WORKER=true make api    # API 与 Worker 单进程启动，便于本地开发
pnpm mobile:web                          # 另开一个终端
```

生产形态是两个进程：`make api` 与 `make worker` 分开跑。

验证服务是否就绪：

```bash
curl -s localhost:8787/healthz
```

## 工程结构

```text
apps/mobile       Expo / React Native App
apps/backend      Go HTTP API 与 Go River Worker
packages/contracts    OpenAPI 契约、错误码与 Fixture（唯一网络事实来源）
packages/api-client   由 OpenAPI 生成的 TypeScript Client、Query Hooks 与 Zod 校验器
packages/ai-contracts AI 结构化输入输出的 JSON Schema
docs              产品、设计、架构与后端 AI 指南
```

移动端与 Go 后端保留在同一个 Git 仓库中。TypeScript 使用 pnpm workspace，Go 使用根 `go.work` 与 `apps/backend/go.mod`。网络字段和错误码以 `packages/contracts/openapi` 为唯一来源，并生成 Go Server／DTO、TypeScript Client、Zod 校验器。

## 代码生成

契约与迁移是源码，生成产物禁止手工修改：

```bash
make generate          # 打包 OpenAPI → 生成 Go Server + sqlc + TS Client
```

| 源 | 产物 |
|---|---|
| `packages/contracts/openapi/**` | `packages/contracts/dist/openapi.bundle.yaml` |
| bundle | `apps/backend/internal/gen/httpapi` |
| bundle | `packages/api-client/src/generated` |
| `apps/backend/db/migrations/**` | `apps/backend/internal/gen/dbgen` |

## 质量检查

```bash
make check        # gofmt + go vet + eslint + go test + tsc
```

## 安全边界

- 所有用户数据访问都在受行级安全约束的短事务内进行。API 与 Worker 使用非超级用户的 `steward_app` 角色连接，因为 `FORCE ROW LEVEL SECURITY` 约束不到超级用户。
- AI 只产出候选，任何正式写入都必须经过用户确认后由 Go Domain 执行。
- 未确认的 Capture 候选不会出现在首页、计划、笔记、数据与搜索中。
- 验证码与 Refresh Token 只以哈希形式落库，不写入日志与埋点。

## 文档入口

- [功能规格说明](./docs/功能规格说明.md)
- [产品设计说明](./docs/产品设计说明.md)
- [整体架构设计](./docs/整体架构设计.md)
- [后端与 AI 开发指南](./docs/后端与AI开发指南.md)
- [品牌与设计原则](./PRODUCT.md)
- [原始 PRD](./AI事管家_PRD_v1.0.md)

## 协作规范

编码 Agent 和团队成员开始任务前必须阅读 [AGENTS.md](./AGENTS.md)。代码提交信息、文档说明、代码注释和 PR 描述统一使用中文。
