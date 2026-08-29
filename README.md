# AI事管家

AI事管家是一套统一管理任务、日程、项目、笔记和结构化记录的个人事务系统。用户可以通过文字、语音、图片或组合输入提交内容；AI 生成可编辑候选，只有用户确认后才由 Go Domain 写入正式数据。

## 当前状态

仓库已打通“Expo 移动端 → OpenAPI 生成 Client → Go API／Worker → PostgreSQL／River”的核心链路，Task、Event、Project、Note、Tracker／Record、Capture、Assistant 与长期记忆均有正式契约和服务端实现。

这不代表所有页面都已正式接入，也不代表已经满足应用商店发布条件。时光、亲友、音乐及部分生活场景仍有原型、准备状态或本地会话边界；公开法律页面、账号删除和商店资料仍是上线阻塞项。唯一的全局进度表见 [实现状态](./docs/实现状态.md)。

## 本地启动

需要 Go 1.26、Node.js 22、pnpm 10 和 PostgreSQL 16 以上。

```bash
cp .env.example .env
createdb steward_dev

pnpm install
make migrate
make seed

STEWARD_EMBEDDED_WORKER=true make api
pnpm mobile:web
```

后两条命令分别在两个终端运行。默认开发验证码为 `123456`；`make seed` 写入手机号 `13800138000` 的演示数据。API 就绪检查：

```bash
curl -s localhost:8787/healthz
```

生产环境将公共 API、Worker 和管理 API 作为独立进程运行，具体配置见 [部署说明](./docs/部署说明.md)。

## 工程结构

```text
apps/mobile                Expo / React Native App
apps/backend               Go 公共 API、Worker、管理 API 与迁移
apps/admin                 React 管理台
packages/contracts         公共与管理 OpenAPI、Fixture
packages/api-client        公共 OpenAPI 生成的 TypeScript Client 与 Zod 校验器
packages/admin-api-client  管理 OpenAPI 生成的 TypeScript Client
packages/ai-contracts      AI JSON Schema、Prompt 与 Eval
docs                       产品、设计、架构、现状与运维文档
```

移动端与后端位于同一个仓库。TypeScript 使用 pnpm workspace，Go 使用根 `go.work` 与 `apps/backend/go.mod`。网络字段、枚举和错误码只定义在 `packages/contracts/openapi`；AI 结构化输出只定义在 `packages/ai-contracts/schemas`。

## 常用命令

```bash
make generate       # OpenAPI bundle、Go Server／DTO、sqlc、TS Client 与 AI 契约同步
make check          # 格式、Lint、测试和类型检查
make test-race      # 核心并发路径 race 检测
make build          # 构建 API、Worker、管理 API 与迁移二进制
```

生成目录禁止手工修改。契约变更必须重新生成两端产物并确认没有漂移。

## 安全边界

- 所有用户数据访问都在服务端按当前用户隔离；API 与 Worker 使用受 RLS 约束的非超级用户角色。
- AI 只产出 Candidate 或 Proposal，不直接写数据库；确认事务重新执行权限、状态机、版本和幂等校验。
- 未确认 Capture 不进入 Today、计划、笔记、数据、搜索或复盘。
- 验证码、Token、完整原始媒体和不必要的用户正文不得进入日志、埋点或测试快照。
- 运营主体、联系方式、法律文本或第三方处理者未确认时，不得用占位内容发布。

## 文档与协作

从 [项目文档入口](./docs/README.md) 开始阅读；该页说明权威来源、任务阅读路径、实现状态和文档维护规则。编码与提交前同时遵守 [AGENTS.md](./AGENTS.md)。团队可读内容统一使用中文，领域类型、API 字段和代码标识符保持稳定英文名。
