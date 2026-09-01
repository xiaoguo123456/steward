# 心情日记模块

## 职责

拥有心情日记的日期语义、结构字段、日历、确定性统计与只读抽象视觉种子。
正文复用 `objects` 模块的 Note Command，但固定为 `note_kind=mood_journal` 与
`blocks_v1`，普通 Notes API 不得读取或修改。

## 数据边界

- `notes` 保存唯一权威块文档和服务端派生纯文本。
- `mood_journal_entries` 保存 `occurred_at`、心情、精力、受控词与隐私开关。
- 所有查询依赖 RLS，正文不进入普通 Note Search、Project 或全局 Memory。
- `visual_seed` 只驱动客户端抽象节点，不保存图片或第二份心情事实。

## AI 边界

手工记录、日期浏览和统计完全不依赖 AI。深度回望必须在用户逐篇选择并单独同意后
调用 Provider；未配置敏感数据 Provider 前只展示确定性统计，不发送正文。

用户主动点击“AI 排版润色”并单独开启心情日记 AI 后，可以把当前草稿的
`blocks_v1` 发送给专用窄 Provider。该链路不读取其他日记或长期 Memory，模型结果
先经过 JSON Schema、块 ID／顺序、链接、数字与 Domain 校验，只回填可撤销草稿；
用户最终保存并回传 `ai_action_id` 后才把来源写入 Note。部署还必须显式设置
`STEWARD_AI_APPROVED_SENSITIVE_CONTENT=true`；默认关闭时，即使用户同意也不发送正文。
