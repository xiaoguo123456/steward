# 上线阻塞项

## 文档信息

| 项目 | 内容 |
|---|---|
| 文档类型 | 正式发布前的外部确认与人工交付清单 |
| 当前状态 | 维护中 |
| 更新日期 | 2026-09-02 |

本页只记录会阻塞正式发布、且需要外部信息、配置或人工验收的事项，不作为功能开发 backlog。功能实现进度见 [实现状态](./实现状态.md)，H5 与应用商店边界见 [H5 与公开页面边界](./H5与公开页面边界.md)。

公开 H5 的页面结构、登录前单独同意、“我的”入口和构建门禁已经落地，但页面仍带 `data-release-blocker`、`noindex` 与“待确认”标记。测试环境可以部署结构；生产 Web、生产 APK 和生产 OTA 会被 `pnpm --filter mobile test:h5:production` 主动阻断，不能通过删除检查脚本绕过。

## 域名与基础设施

- [ ] 发送域名解析邮件，并确认 `test-steward.qhzhiyin.com`、`steward.qhzhiyin.com` 的 CNAME 生效。
- [ ] 为两个域名申请并绑定 HTTPS 证书。
- [ ] 配置 OSS CORS，允许测试和生产域名上传、读取文件。

## 合规内容与账号治理

- [ ] 已确认运营主体为“琼海绘象图数字科技有限公司”、常用办公地区为海南省琼海市，个人信息保护与支持邮箱为 `guoxiaozheng1@cqslim.com`；仍需补统一社会信用代码、完整注册地址、服务等级和有效联系人。
- [ ] 确认发行国家／地区、目标年龄、未成年人规则、适用法律、争议解决方式，以及《用户协议》《隐私政策》的版本、生效日期和授权审核人。
- [ ] 按实际实现逐项确认个人信息的字段、处理目的、处理方式、必要性、保存期限、删除方式、跨境情况和用户权利受理期限。
- [ ] 已按当前代码核对阿里云短信／OSS、Ace Data Cloud、自托管 MapLibre／PMTiles、Expo／EAS Update，以及未接入第三方统计／崩溃／推送的事实并补入清单；仍需逐项确认生产区域、保留与删除策略、训练退出、跨境、合同负责人和最终隐私申报。
- [ ] 心情日记 AI 排版润色正式发布前，确认所用 Provider 已批准处理敏感正文，并把当前草稿块文档、单独同意版本、撤回方式、训练退出、保留与删除能力写入隐私政策、个人信息收集清单、第三方信息共享清单及 iOS／Google Play 隐私申报。
- [ ] 由产品／法务把正式内容替换进 `/legal/*` 与 `/support`，删除生产阻塞标记和 `noindex`，通过生产 H5 门禁，并在正式 HTTPS 域名验证免登录、关闭 JavaScript、移动窄屏、打印和所有站内链接。
- [x] 完成 App 内及 `/account-deletion` Web 账号删除技术链路：手机号验证码、单用途 reauth、幂等受理、会话撤销、后台清理和独立状态查询均已落地。
- [ ] 由产品／法务确认账号删除 SLA、备份最晚自然过期、法定保留、申诉和人工支持口径，并替换公开页面占位内容；生产网关补账号／IP 限流与告警。
- [ ] 核对个人信息收集清单、第三方信息共享清单、iOS Privacy Details、Google Play Data safety、权限用途文案与运行中的 SDK／Provider 完全一致。
- [ ] 在 App Store Connect 与 Google Play Console 填写正式 Privacy Policy URL、Terms URL、Support URL、账号删除 URL，并完成人工可访问性检查。

## 签名、OTA 与发布验收

- [ ] 将 `.local/signing` 中的生产签名和密码备份到安全的离线位置。
- [ ] 公司 Expo 组织下已创建并绑定 `steward` Project，取得真实 `EXPO_PROJECT_ID`；仍需确认当前套餐支持端到端代码签名及预期发布量。
- [ ] OTA 签名证书和私钥已生成，明文只位于 Git 忽略的 `.local/signing`，并已写入 GitHub Environment；仍需把私钥保存到受控离线备份并登记轮换／吊销责任人。
- [x] GitHub `test`／`production` Environment 已配置 `EXPO_PROJECT_ID`、公司 Robot 的 `EXPO_TOKEN`、OTA 证书和私钥；EAS `preview`／`production` 也已配置隔离的 `EXPO_PUBLIC_API_URL`。
- [ ] 已把 Expo／EAS Update 的主体、操作系统、Project ID、随机安装 Token 和必要网络日志写入第三方信息共享清单；仍需完成跨境评估、合同与 iOS／Google Play 隐私申报核对。
- [ ] GitHub Actions 已生成首个包含 `expo-updates` 验签证书的测试 APK；仍需安装该 APK，并完成测试频道更新、生产 10% 灰度、回到上一更新和回到安装包内置版本演练。
- [ ] 使用中国移动、中国联通、中国电信的 4G／5G 和常用家庭 Wi-Fi 真机验证 EAS Update：覆盖冷启动、无更新、下载中断、弱网、离线和更新服务不可达，确认失败时仍能使用缓存或安装包内置版本；未达到生产可用性要求时改用国内请求代理或自建更新服务。
- [ ] 下载并安装 GitHub Actions 生成的测试 APK，完成真机验收。
- [ ] 验证登录、核心功能、图片上传、公开 H5 和管理台。
