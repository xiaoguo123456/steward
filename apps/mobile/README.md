# AI事管家移动端

当前目录是基于 Expo SDK 57、React Native 与 Expo Router 的移动端前端工程。

## 当前实现范围

第一版严格以 Ardot 文件“清单设计”的现有视觉稿为准，使用本地 Mock 数据实现以下可运行页面：

- 登录、注册、找回密码。
- 首页、计划、笔记、打卡，以及从首页头像进入的“我的”与设置。
- 底栏中央“新增”打开统一 Capture 底部输入面板，支持文字、语音和图片组合的前端预览，并覆盖整理进度、结果确认、保存与撤销状态；当前仍使用本地 Mock，不写入正式 Object。
- 首页提供运动、食谱、番茄钟、记账、重要日、购物、复盘和更多 8 个生活场景快捷入口，并包含可操作的本地原型页面。运动已拆为独立二级流程，支持户外跑步、健走、骑行和力量训练；食谱覆盖本周菜单、发现、问卷、详情、烹饪和购物确认；番茄钟覆盖任务关联、倒计时／正向计时、想法暂存、休息、保存确认和专注记录；记账覆盖当月概览、预算、拍照／截图识别确认、手动记账、最近账单和月度报告；重要日覆盖日期排序、类型预设、日历选日、年度重复、提醒和详情查看；购物覆盖右上角新增、数量／规格编辑、自动品类分组、进度、食谱来源和已买到收纳；复盘采用一页式 AI 周报告，覆盖历史周切换、来源追溯、个人补充和建议确认；更多功能中心当前只保留行程入口，行程使用独立总览与详情页承载按天安排、预订信息和行前清单。
- 首页“今天要做”、计划“清单”以及打卡“今日待打卡／我的打卡”的数量统一使用紧跟标题的小胶囊；首页“今日提醒”整张承载面进入日历，不在标题右侧重复放置文字入口。
- 打卡页承载按计划出现的今日待打卡和全部 Tracker；内部路由与领域命名继续使用 `data`、`Tracker` 和 `Record`。
- 计划页使用“今天／明天／已完成”紧凑入口、独立“待安排”和统一清单；日历从右上角进入并支持周／月展开收起。
- 任务详情、新建任务、笔记详情、专注、设置。
- 笔记首页使用标签筛选和单一卡片流，不显示置顶／最近更新分区或列表分割线；搜索按需展开。账户与日历使用独立二级页面，不显示底部一级导航；账户页不重复展示已经由“复盘”承载的本周回顾。
- 全局 AI 助手使用统一的暖色叠页管家形象和聊天式底部面板，支持跨页面拖动、松手贴边吸附、保留停靠位置、快捷回答并返回 Capture 确认页。默认入口会按用户时区恢复当天最近使用的对话，仅在发送首条消息时创建 Thread，并保留显式新建与历史选择；Assistant 最终消息使用受限 Markdown 渲染，用户消息和流式草稿保持纯文本，远程图片不自动加载，正式操作继续由独立建议确认卡片承载。复盘页本身已经是 AI 报告，不重复叠加悬浮入口，避免遮挡来源与建议内容。

已接入服务端的能力统一使用生成的 API Client；仍处于本地交互阶段的场景不定义临时网络 DTO，也不把 Mock 数据写入正式契约。

运动模块的户外跑步、健走和骑行已接入 MapLibre 与前台 GPS：显示真实路线、距离、平均配速或平均速度，用户在总结页确认后写入既有 Tracker / Record。原始坐标不上传，不申请后台定位；健走步数仍由用户选填。

专注模块的计时、想法和记录只保存在当前 App 进程内；“标记任务完成”不会修改首页 Task，“保存专注记录”也不会写入正式 Tracker / Record。正式接入前仍需完成 Task 更新、Tracker Schema、Record 字段、后台恢复和时间语义的跨端契约设计。

记账模块当前使用本地账单 Fixture 与模拟图片识别流程，不会调用真实相机、相册、OCR 或上传接口；识别结果仍需用户确认才加入本地账单。接入真实能力前需要完成媒体上传、识别候选、重复检测、确认保存和 Record Schema 的跨端契约设计，并在新增原生媒体依赖后重新构建开发预览 APK。

重要日模块当前使用本地 Fixture 和进程内新增状态，只支持公历，不会申请通知、联系人或系统日历权限。生日、纪念日、到期日和其他只是前端交互预设；正式接入后均保存为 `event_kind=important_date` 的全天 Event，并由服务端处理年度投影、时区、提醒与重复规则。

购物模块当前使用本地 Fixture、关键词品类模拟结果和进程内新增／编辑／勾选状态，不会同步家庭成员、读取商店货架、计算价格预算或连接线上商城。正式接入后继续复用 TaskList / Task；数量／规格、品类、备注和食谱来源若需要结构化持久化，必须先完成跨端契约设计。新增表单不维护独立单位或品类，正式品类由服务端返回。

## 启动方式

在仓库根目录执行：

```bash
pnpm install
pnpm mobile:web
```

也可以进入本目录启动 iOS 或 Android：

```bash
pnpm ios
pnpm android
```

## Android 真机实时预览

项目使用 `expo-dev-client` 提供真机开发预览。MapLibre 包含原生代码，不能使用 Expo Go；安装包含 MapLibre 与 Expo Location 的开发预览 APK 后，普通 TypeScript、JavaScript 和样式改动可继续通过 Fast Refresh 刷新。

电脑与 Android 手机连接同一个局域网后，在仓库根目录启动实时服务：

```bash
pnpm mobile:live
```

随后打开手机上的“清单”开发预览版，选择检测到的本地开发服务。首次连接也可以扫描 Expo CLI 显示的二维码。

以下变更仍需要重新构建并安装开发预览 APK：

- 新增或升级包含 Android 原生代码的依赖。
- 修改应用图标、启动图、包名等原生配置。
- 升级 Expo SDK 或 React Native。

如果同一 Wi-Fi 下无法连接，可检查电脑防火墙、路由器客户端隔离与 VPN；必要时改用 Expo Tunnel 模式。

## Android APK 预览包

Android Release APK 会把 JavaScript、静态资源和 API 地址写入安装包，安装后无需连接电脑或 Metro。打包时必须明确指定环境地址。

正常发布使用 GitHub Actions：

- `main` 中包含移动端、公共 API 契约或 Android 打包配置的改动时，测试部署成功后自动生成“清单测试”，在本次 Actions 的 Artifacts 下载，保留 30 天；纯后端或管理台改动不打包。手工运行测试部署时可自行勾选是否生成。
- 需要发布正式 App 时，手工运行独立的“Android 正式发布”，输入 main commit SHA 和 App 版本号；“生产环境部署”只更新服务器，不生成 APK。
- 正式 APK 长期保存到对应 GitHub Release。
- 测试包名为 `com.aisteward.mobile.test`，生产包名为 `com.aisteward.mobile`，可在同一台手机安装。

本地构建需要 JDK 17、Android SDK Platform 36、Build Tools 36，以及 Android NDK 27。配置好 `JAVA_HOME` 与 `ANDROID_HOME` 后执行：

```bash
# 测试包
APP_VARIANT=test \
EXPO_PUBLIC_API_URL=https://test-steward.qhzhiyin.com \
pnpm --filter mobile exec expo prebuild --platform android --clean --no-install

cd apps/mobile/android
APP_VARIANT=test \
NODE_ENV=production \
EXPO_PUBLIC_API_URL=https://test-steward.qhzhiyin.com \
./gradlew :app:assembleRelease \
  -PreactNativeArchitectures=arm64-v8a,armeabi-v7a \
  --no-daemon
```

原始产物位于：

```text
apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

上面的本地命令使用开发调试签名，只适合临时验收；自动流程使用固定的测试或生产签名。

在 Android 手机上打开 APK 后，如果系统拦截安装，需要为当前浏览器或文件管理器临时开启“允许安装未知应用”。

## 质量检查

```bash
pnpm check
```

后续接入正式业务时，页面只能通过 `packages/api-client` 的生成 Client 与 Zod 校验器访问网络数据，不能直接把本地 Mock 类型扩展为手写 DTO。
