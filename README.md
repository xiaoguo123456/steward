# 序事

序事是一套统一管理任务、日程、项目、笔记和结构化记录的个人事务系统。用户可以通过文字、语音、图片或组合输入提交内容；AI 生成可编辑候选，只有用户确认后才由 Go Domain 写入正式数据。

## 当前状态

仓库已打通“Expo 移动端 → OpenAPI 生成 Client → Go API／Worker → PostgreSQL／River”的核心链路，Task、Event、Project、Note、Tracker／Record、Capture、Assistant 与长期记忆均有正式契约和服务端实现。

这不代表所有页面都已正式接入，也不代表已经满足应用商店上架条件。时光已接正式私人媒体链路，亲友已接正式 People API；部分生活场景仍有本地会话或原生设备边界，音乐已退出当前首页信息架构。公开法律页面的版本 1.0 已于 2026-09-02 获公司授权确认并允许部署；生产阿里云百炼真实模型回归和应用商店资料仍按上线清单完成。唯一的全局进度表见 [实现状态](./docs/实现状态.md)。

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

## Expo／EAS 账号与 OTA

Android APK 由 GitHub Actions 自行编译和签名，Expo 账号不参与 APK 构建；Expo 仅用于 EAS Update 的项目身份、测试／生产频道和 OTA 托管。完整安全边界与操作流程见 [ADR-028：移动端 OTA 更新](./docs/ADR-028-移动端OTA更新.md) 和 [部署说明](./docs/部署说明.md)。

| 项目 | 当前配置 |
|---|---|
| 登录方式 | 在 [Expo 登录页](https://expo.dev/login) 选择 GitHub 登录；不要在仓库记录 GitHub／Expo 密码 |
| Expo 个人账号 | `xiaoguo456` |
| 公司组织标识 | `qionghaihuixiangtu` |
| 公司组织名称 | 琼海绘象图数字科技有限公司 |
| Expo Project | `qionghaihuixiangtu/steward` |
| Expo Project ID | `fcbe4a6d-5cbc-4bad-954b-2079fbdb3bbd` |
| 项目控制台 | [Expo steward Project](https://expo.dev/accounts/qionghaihuixiangtu/projects/steward) |
| GitHub Actions Robot | `steward-github-actions`，角色为 `Developer` |
| 首个正式移动端版本 | `1.0.0`；根目录及其他 workspace 的包版本不作为 App 上架版本 |
| OTA 频道 | 测试 `steward-test`；生产 `steward-production` |
| EAS 环境 | `preview` 注入测试 API；`production` 注入生产 API |

`EXPO_TOKEN`、OTA 私钥、Keystore 和密码不得进入 README、Git、Issue、日志或聊天记录。`EXPO_TOKEN` 已保存在 GitHub `test`、`production` Environment Secrets；其他签名材料也按环境隔离保存。Robot Token 失效时，由 Expo 组织管理员在组织的 **Access tokens** 页面为 `steward-github-actions` 重新生成，再同步更新两个 GitHub Environment。生产 OTA 仍须确认 EAS 套餐支持端到端代码签名，并完成测试频道、灰度和回滚演练。

### 生产签名材料位置

下表只记录文件位置和 Secret 名称，不记录任何密码、私钥正文或 Base64 内容。`.local/` 已被 Git 忽略；GitHub Environment Secret 的值写入后不能重新查看，因此不能替代原始文件备份。

| 材料 | 当前开发机文件位置 | GitHub `production` Environment Secret |
|---|---|---|
| Android 生产 Keystore | `.local/signing/steward-production.jks` | `ANDROID_PRODUCTION_KEYSTORE_BASE64` |
| Android 生产 Keystore 密码 | `.local/signing/steward-production.password` | `ANDROID_PRODUCTION_KEYSTORE_PASSWORD` |
| OTA 签名私钥 | `.local/signing/expo-updates/private-key.pem` | `EXPO_UPDATES_PRIVATE_KEY_BASE64` |
| OTA 验签证书 | `.local/signing/expo-updates/certificate.pem` | `EXPO_UPDATES_CERTIFICATE_BASE64` |

Android 生产签名别名固定为 `steward-production`。GitHub 配置入口为仓库 **Settings → Environments → production**。截至当前，原始文件保存在上述本机目录，CI 使用副本保存在 GitHub Environment；尚未建立独立备份，后续备份完成前不要删除或重建 `.local/signing` 中的生产文件。

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
