# AI事管家移动端

## 文档信息

| 项目 | 内容 |
|---|---|
| 文档类型 | 移动端工程说明 |
| 适用范围 | `apps/mobile` |
| 当前状态 | 维护中 |
| 更新日期 | 2026-08-30 |

本目录是基于 Expo SDK 57、React Native 0.86、React 19 与 Expo Router 的移动端应用。全局功能进度只在 [实现状态](../../docs/实现状态.md) 维护；本页说明移动端工程边界和开发方式，不重复逐页需求。

## 工程边界

- 路由位于 `src/app`，业务 UI 与数据编排位于 `src/features`，App 内共享组件位于 `src/components/ui`，视觉 Token 位于 `src/theme/tokens.ts`。
- 服务端事实使用 TanStack Query；网络请求必须通过 `@steward/api-client` 的生成 Client 和 Zod 校验器，不手写 URL、网络 DTO 或第二套错误码。
- 当前跨组件状态使用 React Context／Reducer／页面状态；凭证和心情日记草稿使用 `expo-secure-store`。仓库当前没有 Zustand、React Hook Form 或通用 SQLite 草稿层。
- Hugeicons 只能经 `src/components/ui/icon.tsx` 的语义名称使用。Expo UI 与 Slider 只能经 `src/components/ui/selection-controls.tsx` 适配后使用；Feature 不直接绑定底层组件库。
- MapLibre、Location、Image Picker、Speech、Secure Store 和 Updates 都包含平台或生命周期边界。新增原生依赖、权限或 Plugin 后必须重新构建原生包，不能只发布 JavaScript 更新。

## 当前能力边界

核心管理、Capture 确认、Assistant、时光、心情日记、食谱、行程、重要日、购物和复盘等页面已经使用正式 API。Capture 未提交输入使用按账号分库的 SQLCipher 草稿与离线上传队列，媒体先复制到应用 Documents；Web 不持久化该私有草稿。时光复用正式媒体上传并读取 Memory Moments API，发布后只读且只能整段删除；其独立发布草稿和离线上传恢复尚未持久化。亲友占用首页标签，但只在开发构建中展示 Fixture，生产构建显示准备状态；音乐不进入当前首页信息架构。专注、记账和运动均把最终记录写入正式 Tracker／Record；专注计时和原始 GPS 仍按各模块边界留在设备会话，拍照记账复用正式媒体 Capture、可编辑确认和 Record 保存链路。

不要从页面是否“看起来完整”推断是否已接正式数据。开发前先查 [实现状态](../../docs/实现状态.md)，再阅读目标 Feature 的 README、[功能规格说明](../../docs/功能规格说明.md) 和 [产品设计说明](../../docs/产品设计说明.md)。

公开法律与支持 H5 的静态结构、登录前单独同意、“我的”入口、App／Web 账号删除链路和构建门禁已经完成；正式法律内容、运营信息、备份保留口径与线上商店申报尚未完成，因此当前构建仍不具备正式应用商店发布条件。涉及登录、隐私、第三方 SDK／Provider、权限、公开页面、OTA 或商店发布时，必须先阅读 [H5 与公开页面边界](../../docs/H5与公开页面边界.md)。

## 启动与检查

在仓库根目录执行：

```bash
pnpm install
pnpm mobile:web
```

iOS 或 Android 原生开发：

```bash
pnpm --filter mobile ios
pnpm --filter mobile android
```

MapLibre 包含原生代码，不能使用 Expo Go。已安装开发预览包的真机与电脑处于同一局域网时，可以运行：

```bash
pnpm mobile:live
```

该命令默认连接测试环境 `https://test-steward.qhzhiyin.com`。需要其他后端时显式设置 `EXPO_PUBLIC_API_URL`，避免把测试数据写入错误环境。

移动端检查：

```bash
pnpm --filter mobile lint
pnpm --filter mobile typecheck
pnpm --filter mobile test
pnpm --filter mobile test:h5
```

`test:h5` 用于测试环境结构检查；`test:h5:production` 在占位信息未补齐时应当失败。生产 Web、APK 和 OTA 工作流均会执行生产门禁。

完整仓库检查仍从根目录运行 `make check`。

## 原生包与 OTA

- 测试 APK、生产 APK 和服务器部署由独立 GitHub Actions 工作流负责，触发方式、签名和产物见 [部署说明](../../docs/部署说明.md)。
- OTA 只允许发布与已安装原生 runtime 兼容的 JavaScript、样式和专用资源，且只能经仓库工作流执行；runtime、频道、签名、灰度与回滚规则见 [ADR-028：移动端 OTA 更新](../../docs/ADR-028-移动端OTA更新.md)。
- 新增原生依赖、权限、App Config、图标、启动图或普通原生资源时必须提升 App 版本并重新构建 APK。
- Expo Project、验签证书、Secrets、首个原生包和回滚演练完成前，不得声称 OTA 已对用户生效。

## 依赖补丁

- `expo-router@57.0.12` 当前在 Android 冷启动解析初始链接时，可能在导航容器挂载前更新 `lastUnhandledLink`，触发 React 的未挂载组件状态更新警告。仓库通过根目录 `patches/expo-router@57.0.12.patch` 暂存修复：挂载前先缓存链接，挂载后再提交状态。
- 升级 Expo Router 时必须先复测 Android 冷启动和深链；确认上游版本已修复后，删除补丁及根 `package.json`、`pnpm-lock.yaml` 中的 `patchedDependencies` 配置，避免长期维护重复修复。

## 相关文档

- [项目文档入口](../../docs/README.md)
- [整体架构设计](../../docs/整体架构设计.md)
- [后端与 AI 开发指南](../../docs/后端与AI开发指南.md)
- [上线阻塞项](../../docs/TODO.md)
