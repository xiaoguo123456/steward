# ADR-028：移动端 OTA 更新

## 文档信息

| 项目 | 内容 |
|---|---|
| 文档类型 | 架构决策记录（ADR-028） |
| 决策状态 | 已接受 |
| 首次接受日期 | 2026-08-28 |
| 更新日期 | 2026-09-02 |
| 实施状态 | 代码、Expo Project、GitHub Secrets、发布门禁和首个带验签证书的测试 APK 已完成；套餐确认、真机更新、灰度和回滚演练仍是正式启用前阻塞项 |

## 背景

AI事管家使用 Expo SDK 57 与 React Native，并通过 GitHub Actions 自行生成 Android APK。产品需要在两次应用商店发布之间快速修复 JavaScript、样式和文案问题，但远程更新不能把不兼容的原生代码发给旧安装包，也不能绕过商店审核、隐私告知和用户状态机。

## 决策

1. 客户端使用 `expo-updates ~57.0.18`，更新服务使用 EAS Update，不迁移到 EAS Build。
2. runtime version 采用 `appVersion`。测试包必须使用与目标生产包相同的 App 版本；任何原生依赖、Expo Plugin、权限或原生配置变化都提升 App 版本并重新构建。
3. 测试、生产分别固定请求 `steward-test`、`steward-production` 频道。频道写入原生包，不提供运行时切换入口。
4. 启动使用 `ON_LOAD` 检查与 `fallbackToCacheTimeout=0`：优先立即打开缓存或安装包内置版本，后台下载新包，下次冷启动应用，不在用户输入、计时或确认过程中强制重载。
5. 使用 EAS Update 端到端代码签名。公钥证书嵌入原生包；私钥只保存于 GitHub Environment Secret 与受控离线备份。Expo 账户套餐不支持代码签名时保持阻塞，不发布无签名生产更新。
6. OTA 只能由 `.github/workflows/mobile-update.yml` 手工发布。发布者必须提供目标原生包提交、更新提交、App 版本、频道、灰度比例和中文说明；两个提交都必须属于 `main`，且更新提交位于原生包提交之后。
7. 自动变更检查只允许 `apps/mobile/src`、`packages/api-client/src` 和 `apps/mobile/assets/updates` 进入更新包。依赖、锁文件、App Config、普通 assets 或其他可能影响原生 runtime 的文件出现变化时拒绝 OTA，改走新原生包。
8. 先向测试频道 100% 发布并完成真机冷启动验证，再向生产频道小比例灰度；默认建议从 10% 开始。异常时停止灰度，回滚到上一稳定更新或安装包内置版本；涉及本地持久化格式变化时优先修复前滚，不能假设代码回滚会自动恢复数据。

## 配置与秘密

GitHub `test`、`production` Environment 分别配置：

| Secret | 用途 |
|---|---|
| `EXPO_TOKEN` | 机器人账号调用 EAS Update；只授予目标 Project 所需权限 |
| `EXPO_PROJECT_ID` | EAS Update 项目 UUID |
| `EXPO_UPDATES_CERTIFICATE_BASE64` | 构建 APK 时嵌入的验签证书 |
| `EXPO_UPDATES_PRIVATE_KEY_BASE64` | 发布更新时的签名私钥，只在临时目录还原 |

本地未提供 Project ID 和证书时 `expo-updates` 明确关闭。正式 Android 工作流设置 `STEWARD_REQUIRE_EXPO_UPDATES=1`，任何 Secret 缺失都会使构建失败，避免产出看似支持 OTA、实际无法更新的 APK。

首次配置时，由有权限的维护者在 `apps/mobile` 目录使用固定版本 EAS CLI 登录并执行 `pnpm dlx eas-cli@22.6.0 init`，取得真实 Project ID。签名材料使用 SDK 57 自带命令生成，私钥输出目录必须位于仓库外：

```bash
pnpm --filter mobile exec expo-updates codesigning:generate \
  --key-output-directory /受控的仓库外目录/private \
  --certificate-output-directory /受控的仓库外目录/certificate \
  --certificate-validity-duration-years 3 \
  --certificate-common-name "经确认的运营主体名称"
```

证书与私钥分别转换为单行 Base64 后写入对应 GitHub Environment。EAS 的 `preview`、`production` Environment 还必须分别配置测试、生产 `EXPO_PUBLIC_API_URL`；否则 OTA 打出的 JavaScript 可能连接错误环境。

## 隐私与合规

App 启动检查会向 Expo 请求更新。根据 Expo 官方说明，请求包含操作系统、Expo Project ID 和用于判断安装是否请求过更新的随机 Token，并产生必要的 IP／网络与性能日志；不发送 AI事管家的用户正文、手机号、Token 或业务数据库内容。正式启用前必须把 Expo 列入第三方信息共享清单，核对隐私政策、App Store Privacy Details 与 Google Play Data safety。

OTA 只用于与已审核原生能力一致的 JavaScript、样式、文案和资源变更。新增权限、SDK、订阅付费、隐私处理或改变 App 核心用途的变化即使技术上可以打包，也必须重新完成产品、合规和应用商店评审。

## 后果

- 优点：小型修复可以独立于 APK 发布，测试与生产隔离，并具备签名、灰度和回滚路径。
- 代价：每个原生版本都要维护兼容 runtime；发布需要 Expo 服务和受控密钥；EAS Update 成为需要披露、监控和评估可用性的第三方依赖。
- 首次启用仍必须发布新原生包，旧 APK 不会因为仓库加入依赖而自动获得 OTA 能力。

## 依据

- [Expo SDK 57 Updates](https://docs.expo.dev/versions/v57.0.0/sdk/updates/)
- [EAS Update runtime version](https://docs.expo.dev/eas-update/runtime-versions/)
- [EAS Update code signing](https://docs.expo.dev/eas-update/code-signing/)
- [EAS Update rollouts](https://docs.expo.dev/eas-update/rollouts/)
- [EAS Update rollbacks](https://docs.expo.dev/eas-update/rollbacks/)
- [Expo Privacy Explained](https://expo.dev/privacy-explained)
