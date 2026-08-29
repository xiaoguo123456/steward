# 上线阻塞项

## 文档信息

| 项目 | 内容 |
|---|---|
| 文档类型 | 正式发布前的外部确认与人工交付清单 |
| 当前状态 | 维护中 |
| 更新日期 | 2026-08-29 |

本页只记录会阻塞正式发布、且需要外部信息、配置或人工验收的事项，不作为功能开发 backlog。功能实现进度见 [实现状态](./实现状态.md)，H5 与应用商店边界见 [H5 与公开页面边界](./H5与公开页面边界.md)。

公开 H5 的页面结构、登录前单独同意、“我的”入口和构建门禁已经落地，但页面仍带 `data-release-blocker`、`noindex` 与“待确认”标记。测试环境可以部署结构；生产 Web、生产 APK 和生产 OTA 会被 `pnpm --filter mobile test:h5:production` 主动阻断，不能通过删除检查脚本绕过。

## 域名与基础设施

- [ ] 发送域名解析邮件，并确认 `test-steward.qhzhiyin.com`、`steward.qhzhiyin.com` 的 CNAME 生效。
- [ ] 为两个域名申请并绑定 HTTPS 证书。
- [ ] 配置 OSS CORS，允许测试和生产域名上传、读取文件。

## 合规内容与账号治理

- [ ] 确认运营主体全称、统一社会信用代码（如适用）、注册地址、常用办公地址、个人信息保护邮箱、支持邮箱、服务时间和有效联系人。
- [ ] 确认发行国家／地区、目标年龄、未成年人规则、适用法律、争议解决方式，以及《用户协议》《隐私政策》的版本、生效日期和授权审核人。
- [ ] 按实际实现逐项确认个人信息的字段、处理目的、处理方式、必要性、保存期限、删除方式、跨境情况和用户权利受理期限。
- [ ] 确认所有实际第三方处理者，包括短信、对象存储、AI／语音／视觉、地图、日志监控和 Expo／EAS Update；逐项填写主体、产品／SDK、信息种类、目的、处理地区、保留与删除策略、隐私政策 URL。
- [ ] 由产品／法务把正式内容替换进 `/legal/*` 与 `/support`，删除生产阻塞标记和 `noindex`，通过生产 H5 门禁，并在正式 HTTPS 域名验证免登录、关闭 JavaScript、移动窄屏、打印和所有站内链接。
- [ ] 完成 App 内账号删除和 `/legal/account-deletion` Web 请求链路：确认再次验证方式、删除范围、受理与完成 SLA、备份到期边界、法定保留、失败恢复、申诉和人工支持口径。
- [ ] 核对个人信息收集清单、第三方信息共享清单、iOS Privacy Details、Google Play Data safety、权限用途文案与运行中的 SDK／Provider 完全一致。
- [ ] 在 App Store Connect 与 Google Play Console 填写正式 Privacy Policy URL、Terms URL、Support URL、账号删除 URL，并完成人工可访问性检查。

## 签名、OTA 与发布验收

- [ ] 将 `.local/signing` 中的生产签名和密码备份到安全的离线位置。
- [ ] 创建或确认 Expo Project 与 Production／Enterprise 套餐，取得真实 `EXPO_PROJECT_ID`，并绑定当前移动端工程。
- [ ] 生成 OTA 签名证书和私钥，将私钥保存到受控离线备份；确认仓库、构建产物和日志均不包含私钥明文。
- [ ] 在 GitHub `test`／`production` Environment 分别配置 `EXPO_TOKEN`、`EXPO_PROJECT_ID`、`EXPO_UPDATES_CERTIFICATE_BASE64`、`EXPO_UPDATES_PRIVATE_KEY_BASE64`，并配置对应 EAS Environment 的 `EXPO_PUBLIC_API_URL`。
- [ ] 把 Expo／EAS Update 纳入第三方信息共享清单和隐私申报核对：更新请求会发送操作系统、Expo Project ID、随机安装 Token，并产生必要网络日志。
- [ ] 发布首个包含 `expo-updates` 验签证书的测试 APK，完成测试频道更新、生产 10% 灰度、回到上一更新和回到安装包内置版本演练。
- [ ] 使用中国移动、中国联通、中国电信的 4G／5G 和常用家庭 Wi-Fi 真机验证 EAS Update：覆盖冷启动、无更新、下载中断、弱网、离线和更新服务不可达，确认失败时仍能使用缓存或安装包内置版本；未达到生产可用性要求时改用国内请求代理或自建更新服务。
- [ ] 手工生成并安装测试 APK，完成真机验收。
- [ ] 验证登录、核心功能、图片上传、公开 H5 和管理台。
