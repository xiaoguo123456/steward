# 上线阻塞项

## 文档信息

| 项目 | 内容 |
|---|---|
| 文档类型 | 正式发布前的外部确认与人工交付清单 |
| 当前状态 | 维护中 |
| 更新日期 | 2026-08-29 |

本页只记录会阻塞正式发布、且需要外部信息、配置或人工验收的事项，不作为功能开发 backlog。功能实现进度见 [实现状态](./实现状态.md)，H5 与应用商店边界见 [H5 与公开页面边界](./H5与公开页面边界.md)。

- [ ] 发送域名解析邮件，并确认 `test-steward.qhzhiyin.com`、`steward.qhzhiyin.com` 的 CNAME 生效。
- [ ] 为两个域名申请并绑定 HTTPS 证书。
- [ ] 配置 OSS CORS，允许测试和生产域名上传、读取文件。
- [ ] 确认运营主体全称、联系地址／邮箱、发行地区和经授权审核的《用户协议》《隐私政策》正式文本。
- [ ] 发布 `/legal/*` 与 `/support` H5，验证免登录、关闭 JavaScript、移动窄屏、无占位和正式 HTTPS URL。
- [ ] 在登录页接入未默认勾选的协议确认和真实 H5 链接，在“我的”接入法律与支持入口。
- [ ] 完成 App 内账号删除和 `/legal/account-deletion` Web 请求链路，并同步 App Store／Google Play 删除与隐私资料。
- [ ] 核对个人信息收集清单、第三方信息共享清单、iOS Privacy Details、Google Play Data safety 与实际权限／Provider 一致。
- [ ] 将 `.local/signing` 中的生产签名和密码备份到安全的离线位置。
- [ ] 创建或确认 Expo Project 与 Production／Enterprise 套餐，取得真实 `EXPO_PROJECT_ID`，并绑定当前移动端工程。
- [ ] 生成 OTA 签名证书和私钥，将私钥保存到受控离线备份；确认仓库、构建产物和日志均不包含私钥明文。
- [ ] 在 GitHub `test`／`production` Environment 分别配置 `EXPO_TOKEN`、`EXPO_PROJECT_ID`、`EXPO_UPDATES_CERTIFICATE_BASE64`、`EXPO_UPDATES_PRIVATE_KEY_BASE64`，并配置对应 EAS Environment 的 `EXPO_PUBLIC_API_URL`。
- [ ] 把 Expo／EAS Update 纳入第三方信息共享清单和隐私申报核对：更新请求会发送操作系统、Expo Project ID、随机安装 Token，并产生必要网络日志。
- [ ] 发布首个包含 `expo-updates` 验签证书的测试 APK，完成测试频道更新、生产 10% 灰度、回到上一更新和回到安装包内置版本演练。
- [ ] 使用中国移动、中国联通、中国电信的 4G／5G 和常用家庭 Wi-Fi 真机验证 EAS Update：覆盖冷启动、无更新、下载中断、弱网、离线和更新服务不可达，确认失败时仍能使用缓存或安装包内置版本；未达到生产可用性要求时改用国内请求代理或自建更新服务。
- [ ] 手工生成并安装测试 APK，完成真机验收。
- [ ] 验证登录、核心功能、图片上传和管理台。
