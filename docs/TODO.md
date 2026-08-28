# 上线待办

- [ ] 发送域名解析邮件，并确认 `test-steward.qhzhiyin.com`、`steward.qhzhiyin.com` 的 CNAME 生效。
- [ ] 为两个域名申请并绑定 HTTPS 证书。
- [ ] 配置 OSS CORS，允许测试和生产域名上传、读取文件。
- [ ] 确认运营主体全称、联系地址／邮箱、发行地区和经授权审核的《用户协议》《隐私政策》正式文本。
- [ ] 发布 `/legal/*` 与 `/support` H5，验证免登录、关闭 JavaScript、移动窄屏、无占位和正式 HTTPS URL。
- [ ] 在登录页接入未默认勾选的协议确认和真实 H5 链接，在“我的”接入法律与支持入口。
- [ ] 完成 App 内账号删除和 `/legal/account-deletion` Web 请求链路，并同步 App Store／Google Play 删除与隐私资料。
- [ ] 核对个人信息收集清单、第三方信息共享清单、iOS Privacy Details、Google Play Data safety 与实际权限／Provider 一致。
- [ ] 将 `.local/signing` 中的生产签名和密码备份到安全的离线位置。
- [ ] 手工生成并安装测试 APK，完成真机验收。
- [ ] 验证登录、核心功能、图片上传和管理台。
