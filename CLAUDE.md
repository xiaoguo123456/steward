@AGENTS.md

# 仓库工作说明

上面导入的 `AGENTS.md` 是团队协作规范（语言、单仓库边界、跨端变更、业务与 AI 约束），必须遵守。本文只补充仓库现状、命令和代码层面的实际约定，不重复其中内容。

## 当前实现状态

对应后端指南第 25 节的**阶段 0～7 的服务端部分已完成**：

- `packages/contracts`：OpenAPI 3.0.3 契约，50 个路径、80 个操作，是前后端唯一事实来源。
- `apps/backend`：Go 模块化单体，实现全部 80 个契约操作；PostgreSQL + RLS + River。
- `packages/api-client`：Orval 生成的 TypeScript Client、TanStack Query Hooks 与 Zod 校验器。
- `apps/mobile`：登录、首页、计划、笔记、打卡、日历、任务详情与 Capture 全流程已接真实 API。

尚未实现：向量检索与 Embedding、SSE 流式回复、Assistant 历史会话入口。
`STEWARD_AI_PROVIDER=fake` 时使用确定性本地解析，不发起任何外部请求，
此时对话会明确返回"暂时回复不了"而不是伪造一个回答。

仍在本地 Fixture 上的前端场景：运动、食谱、番茄钟、记账、重要日、购物、复盘、行程。
它们的正式契约尚未设计，详见各自的 `src/features/*/README.md`。

## 常用命令

```bash
make migrate     # 应用数据库迁移（含 River 队列表）
make seed        # 写入演示数据（用户 13800138000，验证码 123456）
make api         # 启动 HTTP API
make worker      # 启动 River Worker
make check       # 提交前必跑：gofmt + go vet + eslint + go test + tsc
make generate    # 契约变更后重新生成 Go Server、sqlc 与 TS Client
```

本地开发想用单进程同时跑 API 与 Worker：`STEWARD_EMBEDDED_WORKER=true make api`。

移动端：`pnpm mobile:web`（浏览器）、`pnpm mobile:live`（Android 真机）。

首次运行需要先 `cp .env.example .env`。

## 代码生成链路

契约是源码，三处生成产物都禁止手工修改：

```text
packages/contracts/openapi/**          ← 手写
        ↓ redocly bundle
packages/contracts/dist/openapi.bundle.yaml
        ↓ oapi-codegen              ↓ orval
apps/backend/internal/gen/httpapi   packages/api-client/src/generated

apps/backend/db/migrations/**          ← 手写（只向前追加）
        ↓ sqlc
apps/backend/internal/gen/dbgen
```

改了契约或迁移后必须 `make generate`，否则两端会漂移。

### 生成器的三个坑

1. **Orval 会丢掉契约里的 `Idempotency-Key` 头**。写请求的幂等键由
   `packages/api-client/src/http/fetcher.ts` 统一注入；需要「用户重试也复用同一个键」时，
   调用方通过 `{ headers: { 'Idempotency-Key': key } }` 显式传入。
2. **`orval.config.ts` 的 `query.useQuery` / `useMutation` 是「所有操作都生成这种 Hook」**，
   设了任何一个都会让 GET 与 PATCH 生成成同一类。留空时 orval 按 HTTP 方法自动区分。
3. **sqlc 推不出 `RETURNS TABLE` 函数与派生表的列类型**，会退化成 `interface{}`。
   遇到时改用显式的分组查询，或（像登录前的三个查询那样）在模块内用 pgx 手写并集中 SQL。

## 后端结构

```text
apps/backend/
├── cmd/{api,worker,migrate,seed}      # 四个进程入口
├── db/migrations/                     # Goose 向前迁移，也是 sqlc 的 schema 来源
├── db/queries/                        # sqlc 查询源文件
└── internal/
    ├── bootstrap/                     # 唯一知道全部模块的地方；组装与路由
    ├── gen/{httpapi,dbgen}            # 生成代码，禁止手改
    ├── modules/                       # 业务模块，各自有 README.md
    │   ├── auth users lists objects trackers views captures activity media
    │   └── assistant memory
    └── platform/                      # config database auth httpx timeutil idgen apperr jobs storage
        └── ai/                        # ports capability engine assets
            ├── fake/ openai/          # Provider 适配器，SDK 与线上协议只出现在这里
            └── runtime/direct/        # 薄工具循环，实现 ai.OrchestrationEngine
```

模块之间只通过各自声明的窄接口通信，具体实现在 `bootstrap` 注入，因此没有跨模块直接依赖。
每个模块的 API 层类型名各不相同（`SessionAPI`、`ObjectAPI`…），
这样 `bootstrap.Server` 可以直接嵌入它们并依靠 Go 的方法提升；
`var _ httpapi.StrictServerInterface = (*Server)(nil)` 保证漏实现任何一个操作都编译不过。

## AI 编排的授权边界

- `ai.Registry` 只接受代码里显式登记过的 Capability，**不支持按名字反射任意 Go 方法**。
- `Allowed(allowProposals)` 算出的工具列表只是给模型的**提示**；
  `direct.Engine.executeCall` 每次调用前都会重新按名字授权，
  列表外的工具一律拒绝（`AI_TOOL_NOT_ALLOWED`）并留审计。
- `user_id` 只来自服务端已验证身份（`ai.CapabilityContext`），忽略模型自报的任何身份。
- 工具循环的停止条件都在 `direct.Engine.RunTurn` 里，
  `internal/platform/ai/runtime/direct/engine_test.go` 是它们的 Conformance Test。
- 模型产出的建议只落 `action_proposals`；写入发生在
  `assistant.ProposalService.Confirm` 的那一个事务里，并在其中重新读目标、重跑校验。
- 无来源的结论一律丢弃：复盘建议、Action Proposal 都要求 `source_refs` 非空
  且每个 ID 都出自服务端给出的清单。

## 数据库与安全

- **RLS 必须靠 `steward_app` 角色生效**。`FORCE ROW LEVEL SECURITY` 约束不到超级用户，
  用超级用户连接会让所有隔离策略失效。迁移用有 DDL 权限的角色，API 与 Worker 用 `steward_app`。
- 所有用户数据访问都要经过 `database.InTx`：它在事务开始时用 `set_config` 写入 `app.user_id`。
  `SET LOCAL` 不支持绑定参数，不要改回去。
- 需要 `pgx.Tx` 的平台组件（River 事务内入队）通过 `database.TxFrom(ctx)` 获取；
  业务模块继续只用 `*dbgen.Queries`。
- 中文检索用 `pg_trgm` + `ILIKE`。Postgres 默认分词器不切分中文，
  `to_tsvector` 会把整句当成一个 token，搜不到子串。
- `STEWARD_MEMORY_FINGERPRINT_KEY` 是「不再学习这项」阻止记录的 HMAC 密钥，
  独立用途，不要复用 JWT 密钥。指纹基于规范化后的语义值计算，
  换更强的归一化时必须递增 `memory.FingerprintKeyVersion`。

## 移动端代码约定

- 文件名 kebab-case，导出组件 PascalCase；路径别名 `@/*` → `src/*`。
- **JSX 属性按字母序排列**（Lint 未强制，但全仓库一致）。
- 样式一律 `StyleSheet.create` 放文件底部；颜色、字号、圆角、间距从 `@/theme/tokens` 取。
- 场景专属色（食谱橙、记账蓝等）以「前景色 + 浅底色」成对出现在页面内字面量中，不进 tokens。
- 图标只用 `@/components/ui/icon` 的 `AppIcon` 与 `SportModeIcon`（内含 Web 首屏水合保护）。
- 页面骨架复用 `AppScreen`、`PageHeader`、`NavHeader`、`SectionTitle`、`StatePanel`、`ModalSheet`。
- 可点元素给 `accessibilityRole` 与中文 `accessibilityLabel`，触控高度不小于 44。
- 新增路由后必须在 `src/app/_layout.tsx` 注册 `Stack.Screen`。
- 网络访问一律通过 `@steward/api-client`，不手写 fetch、URL 或 DTO。
- ESLint 会拦住「在 effect 里同步 setState」：用派生值代替 `useEffect` + `setState`。

## 状态与缓存

- 服务端事实放 TanStack Query，登录态放 `src/api/session.ts`，两者不各自持有副本。
- 退出登录必须 `queryClient.clear()`，否则下一个账号会看到上一个账号的数据。
- 写操作成功后按响应里的 `affected_resources` 精确失效，不要无脑清空全部缓存。
- Today 的收录、排序与分组由服务端决定，客户端不得重排，展开只改变可见数量。

## 文档与事实来源

改动前按 `AGENTS.md` 的要求读对应章节。事实来源优先级：

1. `docs/功能规格说明.md` — 业务规则、状态、边界与验收
2. `docs/产品设计说明.md` — 页面、交互、视觉与用户文案
3. `docs/整体架构设计.md` — 系统边界、依赖方向与技术实现
4. `docs/后端与AI开发指南.md` — Go 后端、AI 编排、Assistant、用户记忆
5. `packages/contracts` → `packages/ai-contracts` → 数据库迁移

`PRODUCT.md` 是品牌与设计原则来源（含 WCAG AA 无障碍底线）。
`AI事管家_PRD_v1.0.md` 是原始需求，冲突时以 `docs/` 为准。

## 技术栈注意事项

- **Expo SDK 57 / React Native 0.86 / React 19.2**，写代码前查
  https://docs.expo.dev/versions/v57.0.0/ 的对应版本文档。
- `reactCompiler` 已开启，不要手工堆 `useMemo` / `useCallback` 做微优化。
- Go 1.26，`oapi-codegen` 与 `sqlc` 以 `go tool` 依赖形式固定在 `go.mod`。
- 包管理器固定 `pnpm@10.32.1`，workspace 为 `apps/*` 与 `packages/*`。
- `apps/mobile/android/`、`dist/`、`output/`、`.expo/`、`.env` 均在 `.gitignore` 中。
