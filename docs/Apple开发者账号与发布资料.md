# Apple 开发者账号与发布资料

## 文档信息

| 项目 | 内容 |
|---|---|
| 文档类型 | Apple Developer Program 与 App Store Connect 账号登记资料 |
| 适用范围 | iOS 开发者账号申请、App 备案、签名与 App Store 发布 |
| 当前状态 | D-U-N-S 信息已取得，组织开发者会员待申请 |
| 更新日期 | 2026-09-02 |

本文只登记团队协作所需的非密码资料。不得在仓库中记录 Apple 账户密码、短信验证码、双重认证恢复信息、App Store Connect API 私钥、Distribution Certificate 私钥、`.p12` 文件或其密码。

## 运营主体

| 项目 | 已确认信息 | 来源与状态 |
|---|---|---|
| 法定中文名称 | 琼海绘象图数字科技有限公司 | 营业执照 |
| D&B 英文名称 | `Qionghai Xiangtu Digital Technology Co., Ltd` | D&B 邮件返回；后续 Apple 表单以此拼写为准 |
| D-U-N-S 编号 | `516255950` | D&B 邮件返回，2026-09-02 确认 |
| 法定代表人／拟任账户持有人 | 郭晓征（`Xiaozheng Guo`） | 营业执照与 Apple 账户 |
| 注册地址 | 海南省琼海市博鳌镇博鳌乐城国际医疗旅游先行区乐天路001号B288 | 营业执照 |
| Apple 账户邮箱 | `guoxiaozheng1@cqslim.com` | 当前 Apple 账户登录邮箱 |
| 联系电话 | `+86 15801373360` | D-U-N-S 查询联系人与公司联系电话 |

`cqslim.com` 并非当前产品公开使用的 `qhzhiyin.com` 域名。Apple 组织注册要求工作邮箱使用组织域名；若 Apple 或 D&B 在人工核验时提出异议，应改用由运营主体控制的 `@qhzhiyin.com` 邮箱，并同步更新本文。不得为了通过核验虚构邮箱归属关系。

## 当前办理状态

| 事项 | 状态 | 后续动作 |
|---|---|---|
| Apple 账户 | 已创建 | 保持双重认证与受信任手机号有效 |
| D-U-N-S 查询 | 已完成 | 使用 D&B 邮件中的英文名称和编号 |
| Apple Developer Program 组织会员 | 待申请 | 在 Apple Developer App 中选择“组织”并提交核验 |
| 会员费 | 未支付 | 组织核验通过后接受协议并支付年费 |
| App Store Connect 团队 | 未创建 | 会员开通后邀请团队成员，禁止共享主账号密码 |
| 正式 iOS Bundle ID | 待创建 | 计划使用 `com.aisteward.mobile`，创建前确认未被占用 |
| Apple Distribution Certificate | 未创建 | Bundle ID 与 EAS iOS 构建配置完成后生成 |
| iOS App 备案特征信息 | 未取得 | 从最终发布证书提取公钥与 SHA-1 指纹 |

## 后续登记字段

取得下列信息后补充本文；秘密值只记录其保管位置和责任人，不记录明文：

| 项目 | 当前值 |
|---|---|
| Apple Developer Team ID | 待补充 |
| App Store Connect Provider／团队名称 | 待补充 |
| 会员生效日期 | 待补充 |
| 会员到期／续费日期 | 待补充 |
| 正式 Bundle ID | 待确认 |
| App Store Connect Apple ID | 待补充 |
| Distribution Certificate 到期日 | 待补充 |
| 证书及私钥保管位置 | 待补充，不记录密码或私钥正文 |

## 一致性要求

- Apple 组织注册、D&B、App 备案、隐私政策和应用商店资料中的法人主体必须一致。
- D&B 英文名称使用邮件返回的 `Qionghai Xiangtu Digital Technology Co., Ltd`，不得继续使用查询阶段自行拟定的 `Qionghai Huixiangtu Digital Technology Co., Ltd.`。
- App Store 开发商名称以 Apple 核验后的法人实体名称为准；产品名称继续使用“序事”。
- Apple 账户仅用于账户持有人登录；开发、构建和运营人员通过 App Store Connect 团队权限协作，不共享账户密码或验证码。
- Apple Distribution Certificate 更新导致公钥或 SHA-1 指纹变化时，应同步变更 App 备案特征信息。

