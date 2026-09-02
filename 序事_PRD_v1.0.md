# 序事｜产品需求文档 PRD v1.0

> 历史资料：本文保留最初需求背景，不再作为当前业务、设计或实现进度的权威来源。当前规则见 `docs/功能规格说明.md`、`docs/产品设计说明.md` 与 `docs/整体架构设计.md`；当前实现见 `docs/实现状态.md`。

> **产品定位：一个统一管理“事情、日程、项目、记录和数据”的 AI Personal OS。**  
> **核心承诺：什么都可以丢进来，AI 帮你理清。**

---

## 0. 文档信息

| 项目 | 内容 |
|---|---|
| 产品名称 | 序事 |
| 文档版本 | PRD v1.0 |
| 产品阶段 | MVP 定义 / 可进入 UI 与研发 |
| 目标平台 | iOS / Android |
| 技术方向 | Expo + React Native + TypeScript |
| 核心用户 | 需要同时管理工作和个人事务的知识工作者、管理者、自由职业者 |
| 核心能力 | Capture、AI 结构化、Object System、Today、Project、Data、Review |
| 暂不覆盖 | 团队协作、复杂财务记账、CRM 全功能、自动执行高风险操作 |

---

# 1. 产品背景

## 1.1 用户现在的问题

一个人每天的信息通常散落在：

- 微信聊天
- 日历
- Todo
- 备忘录
- 截图
- 相册
- Excel
- 文档
- 邮件
- 各种垂直 App

用户真正的问题不是“没有工具”，而是：

1. **输入成本高**  
   想记一件事时，要先判断应该放日历、Todo、笔记还是表格。

2. **信息割裂**  
   “王总”“报价”“周五会议”“30 万预算”“跟进任务”往往存在不同 App 中。

3. **记录以后没有后续**  
   大量信息只是被保存，没有自动变成行动。

4. **数据沉淀但不产生价值**  
   用户记录了很多数字，却很少得到趋势、异常和复盘。

5. **每天仍然需要自己重新整理优先级**  
   软件保存了信息，但没有真正替用户“管事”。

---

# 2. 产品目标

## 2.1 一句话目标

让用户不需要学习“如何管理”，只需要自然地输入信息，系统自动完成：

**理解 → 分类 → 关联 → 安排 → 提醒 → 复盘。**

## 2.2 产品核心循环

```text
Capture
收进来
   ↓
Understand
AI 理解
   ↓
Organize
生成 Object 并关联
   ↓
Plan
进入 Today / Project / Timeline
   ↓
Do
用户执行
   ↓
Learn
系统学习用户习惯
   ↓
下一次更准确
```

## 2.3 MVP 成功标准

第一版必须验证三个问题：

1. 用户是否愿意把“杂乱输入”交给序事？
2. AI 是否能稳定把输入转成正确的结构化对象？
3. Today 是否真的能成为用户每天打开的页面？

---

# 3. 产品边界

## 3.1 序事是什么

- 个人事务管理系统
- AI 日程助手
- AI 任务管理器
- AI 项目组织器
- AI 数据记录器
- AI 周报与复盘助手
- 个人上下文存储层

## 3.2 序事不是什么

第一版不做：

- 企业级项目管理软件
- 完整 CRM
- 专业财务记账
- 医疗健康诊断
- 团队 IM
- 云盘
- Notion 式自由搭建数据库
- 纯聊天机器人
- 完全自动替用户修改所有日程

---

# 4. 目标用户

## 4.1 核心用户 A：事务密集型知识工作者

特征：

- 每天会议多
- 同时推进多个项目
- 经常需要记“答应别人什么”
- 任务来自聊天、电话、会议、截图
- 会用日历和 Todo，但仍然感觉乱

典型需求：

> “我只想把事情说出来，系统替我整理。”

---

## 4.2 核心用户 B：自由职业者 / 小老板

特征：

- 工作与生活混在一起
- 需要管理客户、项目、收款、时间
- 没有专门助理
- 很多信息靠脑子记

典型需求：

> “帮我记住所有该跟进的人、该做的事和关键数据。”

---

## 4.3 核心用户 C：数据记录型用户

特征：

- 会记录运动、体重、收入、内容数据、销售数据
- 但不愿意搭表格
- 希望能直接用自然语言记录

典型需求：

> “我说一句，自动记进去，月底直接告诉我变化。”

---

# 5. 核心概念：Object System

序事不把用户的信息强制分散到“日历 / Todo / 记账 / 笔记”。

所有内容统一抽象为 **Object**。

## 5.1 MVP Object 类型

### Task

代表需要完成的行动。

字段：

```text
id
title
description
status
priority
due_at
estimated_minutes
project_id
person_ids[]
source_capture_id
created_at
completed_at
```

状态：

```text
inbox
planned
doing
done
cancelled
```

---

### Event

代表在确定时间发生的事情。

字段：

```text
id
title
start_at
end_at
location
participants[]
project_id
note
reminder
source_capture_id
```

---

### Project

代表一个需要多步骤完成的目标或事务集合。

字段：

```text
id
name
description
status
start_date
target_date
progress
related_objects[]
```

状态：

```text
active
paused
completed
archived
```

---

### Record

代表一次结构化数据记录。

例如：

- 体重 72.3kg
- 今日成交额 18600
- 跑步 5km
- 本场直播观看 3200

字段：

```text
id
tracker_id
timestamp
values{}
note
source_capture_id
```

---

### Note

代表目前不需要行动、但值得保存的信息。

字段：

```text
id
title
content
related_objects[]
source_capture_id
```

---

## 5.2 后续 Object

v1.1+：

- Person
- File
- Goal
- Habit
- Reminder
- Location
- Metric
- Subscription

---

# 6. Relation System

Object 之间必须能够建立关系。

例如用户说：

> 周五下午和王总讨论新官网项目，他预算大概 30 万，记得提前准备报价方案。

系统生成：

```text
Project：新官网项目
 ├── Event：周五下午与王总会议
 ├── Task：准备报价方案
 └── Note：预算约 30 万
```

后续增加 Person 后：

```text
Person：王总
    ↓ belongs_to
Project：新官网项目
    ↓ contains
Event：周五会议
    ↓ requires
Task：报价方案
```

Relation 结构：

```text
id
source_object_id
target_object_id
relation_type
confidence
created_by
```

`created_by`：

```text
ai
user
system
```

---

# 7. 产品信息架构

底部导航第一版固定为：

```text
Today
Inbox
Projects
Data
Me
```

全局浮动入口：

```text
＋ Capture
```

---

# 8. Onboarding

## 8.1 目标

3 分钟内完成：

- 用户理解产品
- 设置基本习惯
- 创建第一批 Object
- 体验第一次 AI 自动整理

## 8.2 页面流程

### Step 1：一句话解释

页面文案：

> **事情不用分类，直接告诉我。**

副文案：

> 日程、任务、项目、记录，AI 会自动帮你整理。

按钮：

`开始`

---

### Step 2：选择主要用途

最多选 3 个：

- 工作事务
- 日程安排
- 项目管理
- 数据记录
- 个人生活
- 目标管理

用途只影响首次模板，不限制后续功能。

---

### Step 3：工作习惯

用户设置：

- 通常几点开始一天
- 通常几点结束
- 是否周末工作
- 默认提醒习惯

示例：

```text
工作日开始：09:00
工作日结束：18:30
默认事件提醒：30 分钟前
```

---

### Step 4：第一次 Capture

系统引导用户说一句：

> “下周二下午 3 点和产品团队开会，提前准备一下数据。”

AI 返回：

```text
已识别：

Event
下周二 15:00 产品会议

Task
准备会议数据
建议：下周二 11:00 前完成
```

用户点击：

`确认保存`

完成 onboarding。

---

# 9. 全局 Capture

## 9.1 入口

所有主页面右下角固定一个 `＋`。

点击后展开：

- 文字
- 语音
- 拍照
- 相册
- 文件

MVP 优先：

- 文字
- 语音
- 图片 / 截图

文件解析可放 v1.1。

---

## 9.2 Capture 页面

页面结构：

```text
[ 输入框 ]

“把任何事情告诉我……”

[语音按钮]

快捷示例：

“明天下午3点开会”
“帮我记今天体重72.5”
“下周去上海出差三天”
“记一下：王总比较关注交付速度”
```

---

## 9.3 AI 解析中

不显示纯 Loading。

展示：

```text
正在理解……

✓ 找到 1 个日程
✓ 找到 2 个任务
✓ 识别到 1 个项目
```

目标：

1～3 秒先展示初步结果。

---

# 10. Capture Confirmation

这是 MVP 极其重要的页面。

AI 不应该默认静默保存高风险内容。

示例：

用户输入：

> 下周去上海三天，周二见老张，酒店还没订，预算 3000，周三参加展会。

返回：

```text
上海出差

Project
9/8 - 9/10

Event
周二 · 与老张见面

Event
周三 · 参加展会

Task
预订酒店

Record / Note
预算：¥3000
```

用户操作：

- 修改
- 删除单项
- 全部保存

底部：

`保存 5 项`

---

## 10.1 AI Confidence

每一个抽取字段必须有 confidence：

```text
0.95
0.82
0.61
```

规则：

- `>= 0.85`：默认填入
- `0.60 - 0.84`：黄色提示，用户确认
- `< 0.60`：不直接创建，主动询问

例如：

> “下周找老王聊聊。”

AI 无法确定时间。

返回：

```text
Task
联系老王

时间：
尚未确定

[明天]
[本周]
[暂不安排]
```

而不是自己编一个时间。

---

# 11. Today 页面

Today 是产品日活核心。

## 11.1 页面结构

### Header

```text
8月13日 · 星期四

早上好
今天有 5 件真正需要关注的事
```

---

### Section A：Now / Next

展示最近即将发生的 Event。

```text
09:30
产品会议

还有 28 分钟

[查看准备事项]
```

---

### Section B：Today Tasks

按 AI 推荐顺序展示：

```text
高优先级

□ 回复王总报价
  已拖延 2 天

□ 完成产品数据
  预计 45 分钟

一般

□ 提交报销
```

每项支持：

- 完成
- 延期
- 编辑
- 进入 Project

---

### Section C：AI Daily Brief

最多 3 条。

例如：

> 你下午 2:00～5:30 连续有 3 场会议，建议把“月度数据整理”放到上午。

> “报价方案”已经连续延期 2 次，建议今天优先完成。

> 上海出差还有 5 天，目前酒店仍未预订。

---

### Section D：Today Records

如果用户有活跃 Tracker：

```text
今天还没记录：

体重
睡眠时长
直播数据
```

点击即可输入。

---

# 12. Task 详情页

字段：

- 标题
- 状态
- 截止时间
- 计划时间
- 优先级
- 预计耗时
- Project
- 相关 Note
- 来源

AI 能力：

### 智能拆分

用户点击：

`AI 帮我拆`

例如：

> 准备周五汇报

拆成：

```text
□ 整理数据
□ 确定结论
□ 做 PPT
□ 检查数据
□ 预演一次
```

必须由用户确认后加入。

---

### 智能安排

按钮：

`安排时间`

AI 根据：

- 截止时间
- 当前日程
- 用户工作时间
- 预计耗时

给出：

```text
建议：
周四 10:00 - 11:30

原因：
这是截止日前最大的一段连续空闲时间。
```

用户确认后加入 Today / Timeline。

---

# 13. Event 详情页

字段：

- 标题
- 开始时间
- 结束时间
- 地点
- 参与人
- Reminder
- Project
- Notes

增加：

### 会前准备

事件开始前：

```text
15:00 王总项目会

AI 会前提醒：

上次记录：
王总最关注交付周期。

相关任务：
✓ 报价已准备

待确认：
项目上线时间仍未确定。
```

后续有 Person 系统后能力更强。

---

# 14. Projects

## 14.1 Project 首页

显示：

```text
Active Projects

上海出差
3 / 6 完成
还有 5 天

新官网项目
8 / 15 完成
目标：9月30日

减脂计划
Day 12
```

---

## 14.2 Project 详情

统一结构：

### Overview
一句话描述 + AI 状态总结。

### Next
接下来最重要的 1～3 项。

### Timeline
相关 Event + Task。

### Objects
所有关联内容。

### Data
Project 相关 Record。

---

## 14.3 AI Project Summary

例如：

```text
上海出差

当前：
机票已完成
展会日程已确认
酒店仍未预订

风险：
周二见老张的地点尚未确定

建议：
今天先完成酒店预订。
```

---

# 15. Data 模块

Data 不是 Excel，而是：

> **自然语言创建和记录 Tracker。**

---

## 15.1 创建 Tracker

用户点击：

`新建记录`

可以直接说：

> 帮我记录每场直播的观看人数、成交额和转化率。

AI 输出：

```text
Tracker：直播数据

字段：

日期          Date
观看人数      Number
成交额        Currency
转化率        Percentage

是否增加：
直播时长？
```

用户确认后创建。

---

## 15.2 Record 输入

后续只需要说：

> 今天观看 3200，成交 18600，转化 3.7%。

AI 自动匹配 Tracker 并填入。

如果有歧义：

> “今天 72.3。”

AI 不能猜。

应询问：

```text
你是要记录：

○ 体重
○ 其他数据
```

---

## 15.3 Data 详情页

展示：

- 最近记录
- 折线趋势
- 周 / 月变化
- AI Summary

例如：

```text
过去 4 周

平均观看人数：
+12.8%

成交额：
+6.4%

转化率：
3.9% → 3.5%

AI：
流量增加，但转化略有下降。
```

AI 只能基于已有数据描述，不捏造原因。

如果用户问：

> 为什么转化下降？

AI 应明确：

> 从现有数据只能确认转化率下降，无法确认原因。你可以补充直播主题、时长或商品信息，我可以继续分析。

---

# 16. Inbox

Inbox 保存所有未完全处理的 Capture。

类型：

```text
Needs Confirmation
Unscheduled
Unlinked
Low Confidence
```

示例：

```text
“下周找老王聊聊”

AI 已创建 Task：
联系老王

但还未确定时间。

[安排]
```

目标：

**Inbox 永远可以清空。**

顶部显示：

```text
Inbox 7

[AI 帮我清理]
```

AI 清理只给建议，用户确认后执行。

---

# 17. Search

全局搜索必须支持自然语言。

例如：

> 我上次和王总聊了什么？

> 上海出差还有哪些没做？

> 最近一个月直播哪场成交最高？

> 我今天有什么可以推迟？

搜索结果来源：

- Object
- Relation
- Record
- Note
- Event
- Project

AI 回答必须附带来源 Object。

---

# 18. Me 页面

包括：

- 本周 Review
- 使用习惯
- Goals（v1.1）
- AI 设置
- 通知设置
- 数据导出
- 隐私
- 订阅

---

# 19. AI Weekly Review

每周固定时间生成。

## 19.1 输出结构

### 数据概览

```text
完成任务：38
延期：6
会议：12
活跃项目：5
记录数据：17 条
```

### AI 观察

最多 3 条：

```text
1.
你本周最容易完成的任务集中在上午 9:30～11:30。

2.
“财务报销”类事项平均拖延 2.8 天。

3.
上海出差相关事项还有 2 个关键任务未完成。
```

### 下周建议

最多 3 条：

```text
建议把需要连续专注的任务优先安排在上午。

周一前完成酒店预订。

把“报销”设置为每周五固定任务。
```

必须做到：

- 有数据依据
- 不生成空泛鸡汤
- 不超过一屏核心内容

---

# 20. AI 能力设计

AI 不是一个单独的大模型调用，而是拆成多个 Agent / Pipeline。

## 20.1 Intent Parser

负责判断：

```text
Task
Event
Project
Record
Note
Mixed
```

---

## 20.2 Entity Extractor

提取：

```text
时间
人物
地点
金额
数量
项目
截止日期
优先级
```

---

## 20.3 Object Builder

把解析结果生成 Object。

标准输出必须为 JSON。

示例：

```json
{
  "objects": [
    {
      "type": "event",
      "title": "和王总讨论新项目",
      "start_at": "2026-08-14T15:00:00+08:00",
      "confidence": 0.96
    },
    {
      "type": "task",
      "title": "准备报价方案",
      "due_at": "2026-08-14T12:00:00+08:00",
      "confidence": 0.78,
      "requires_confirmation": true
    }
  ]
}
```

---

## 20.4 Linker

判断新 Object 和历史 Object 的关系。

例如：

新输入：

> 王总说预算可以到 35 万。

系统发现：

```text
Person / Note 中存在“王总”
Project 中存在“新官网项目”
```

AI 建议：

```text
关联到：
新官网项目

更新 Note：
预算 30 万 → 35 万
```

用户确认。

---

## 20.5 Scheduler

输入：

```text
Task
deadline
estimated_minutes
calendar
working_hours
user_preference
```

输出：

```text
recommended_slot
reason
alternative_slots[]
```

不能默认写入。

必须用户确认。

---

## 20.6 Reviewer

只处理结构化数据，不直接读取所有原始隐私内容。

负责：

- Daily Brief
- Weekly Review
- Project Summary
- Data Summary

---

# 21. AI 记忆策略

分三层。

## Layer 1：短期上下文

当前 Capture / 当前对话。

生命周期：

分钟级。

---

## Layer 2：结构化长期记忆

保存为 Object / Relation。

这是主要长期记忆。

---

## Layer 3：用户偏好

例如：

```text
上午适合深度工作
会议默认提醒30分钟
不喜欢晚上安排工作任务
任务默认预计30分钟
```

必须可在 Me 页面查看、修改、删除。

原则：

> AI 不允许形成用户无法查看的“神秘永久记忆”。

---

# 22. 通知系统

通知不能泛滥。

类型：

### Event Reminder
确定性提醒。

### Task Due
截止提醒。

### Project Risk
例如：

> 上海出差还有 3 天，酒店仍未预订。

### Daily Brief
每天最多 1 条。

### Weekly Review
每周最多 1 条。

默认不开启营销型通知。

---

# 23. 删除与撤销

AI 自动操作必须支持：

`Undo`

例如：

```text
AI 已创建：
1 Event
2 Tasks
1 Project

[撤销]
```

所有 AI 修改建立 `activity_log`。

用户可以查看：

```text
AI 今天做了什么
```

包括：

- 创建
- 修改
- 关联
- 推荐

---

# 24. 数据模型建议

核心表：

```text
users
captures
objects
relations
trackers
records
ai_actions
activity_logs
user_preferences
notifications
```

---

## 24.1 captures

```text
id
user_id
input_type
raw_text
asset_url
created_at
processing_status
```

---

## 24.2 objects

```text
id
user_id
type
title
content_json
status
start_at
end_at
due_at
project_id
created_at
updated_at
deleted_at
```

---

## 24.3 relations

```text
id
user_id
source_object_id
target_object_id
type
confidence
created_by
```

---

## 24.4 trackers

```text
id
user_id
name
schema_json
unit
created_at
```

---

## 24.5 records

```text
id
tracker_id
timestamp
values_json
source_capture_id
```

---

## 24.6 ai_actions

```text
id
user_id
action_type
input_refs
output_json
confidence
status
approved_by_user
created_at
```

---

# 25. API 建议

## Capture

```http
POST /captures
```

提交文本 / 语音转写 / 图片。

---

## Parse

```http
POST /ai/parse
```

返回 Object Candidates。

---

## Confirm

```http
POST /captures/{id}/confirm
```

创建 Object。

---

## Today

```http
GET /today
```

返回：

- events
- planned_tasks
- AI daily brief

---

## Projects

```http
GET /projects
GET /projects/{id}
```

---

## Tracker

```http
POST /trackers
POST /trackers/{id}/records
GET /trackers/{id}/insights
```

---

## AI Review

```http
GET /reviews/weekly
```

---

# 26. 错误与边界处理

## 26.1 时间不明确

输入：

> 周末约一下王总。

不能自动生成确定 Event。

应创建：

```text
Task：
约王总

建议时间：
本周末

待确认
```

---

## 26.2 同名 Project

输入：

> 给官网项目增加一个报价任务。

存在两个官网 Project。

必须询问：

```text
你指的是：

○ 新官网项目
○ 品牌官网改版
```

---

## 26.3 AI 识别错误

任何 Confirmation 卡可点击字段直接改。

并提供：

```text
识别错了
```

作为反馈入口。

---

## 26.4 重复 Object

例如：

用户两次说：

> 周五3点产品会。

系统检测重复：

```text
这个日程可能已经存在。

[更新原日程]
[仍然创建]
```

---

# 27. 权限设计

MVP 权限：

- 通知
- 麦克风
- 相册 / 相机

日历权限：

v1.1 可增加系统 Calendar Sync。

原则：

> 权限只在用户第一次使用相应功能时请求，不在首次启动一次性索取。

---

# 28. 隐私设计

必须提供：

- 删除账号
- 数据导出
- 删除单个 Object
- 删除 AI 记忆
- 查看 AI 保存的长期偏好
- 关闭某类 AI 分析

敏感原始 Capture 应和结构化 Object 分层保存。

可提供：

```text
解析完成后自动删除原始语音
```

选项。

---

# 29. 商业化

## Free

建议：

- 200 Objects
- 每月 50 次 AI Capture
- 基础 Today
- 3 个 Projects
- 3 个 Trackers

---

## Pro

建议测试：

```text
¥28/月
¥228/年
```

包含：

- 无限 Object
- 无限 Project
- 更多 AI Capture
- AI Scheduler
- Weekly Review
- 高级 Data Insight
- 图片 / 文件识别
- 多设备同步

---

## 后续 Agent Pro

增加：

- Calendar Agent
- Email Agent
- 自动生成会议准备
- 自动识别待跟进事项
- 自动建议下周计划

核心原则仍然：

> 高影响操作需要用户确认。

---

# 30. MVP 范围

## P0 必须有

- 登录
- Today
- Inbox
- Text Capture
- Voice Capture
- Task
- Event
- Project
- Record / Tracker
- Note
- Capture Confirmation
- AI Parse
- Object Relation
- 基础 Scheduler
- Daily Brief
- Weekly Review
- Notification
- 搜索
- Undo / Activity Log

---

## P1 应该有

- 图片 / 截图识别
- Project Summary
- Data Chart
- 重复 Object 检测
- 用户偏好学习
- 数据导出

---

## P2 暂不做

- Gmail
- 微信
- 团队协作
- 家庭空间
- 高级 CRM
- 自动记账
- HealthKit
- 自动发送邮件
- 自动支付
- 自动修改大量第三方日历

---

# 31. MVP 页面清单

预计 15～18 个主要页面：

1. Splash
2. Login
3. Onboarding
4. Today
5. Capture
6. Capture Processing
7. Capture Confirmation
8. Inbox
9. Task Detail
10. Event Detail
11. Projects
12. Project Detail
13. Data
14. Tracker Detail
15. New Tracker
16. Search
17. Weekly Review
18. Me

---

# 32. 核心埋点

必须记录：

```text
capture_started
capture_completed
capture_confirmed
capture_corrected
object_created
task_completed
event_created
project_created
tracker_created
record_added
today_opened
weekly_review_opened
ai_suggestion_accepted
ai_suggestion_rejected
```

核心指标：

### Activation
首次 24h 内成功创建 ≥3 个 Object。

### Day 7 Retention
7 天后仍打开 Today。

### Capture Success Rate
AI 解析后用户“不修改直接确认”的比例。

目标第一阶段：

> ≥70%

### Today Value
Today 页面用户完成 / 调整事项比例。

### AI Trust
AI 建议接受率。

---

# 33. 第一阶段验收标准

## Capture

输入：

> 明天下午3点跟老王开会，记得提前把报价发给他。

必须生成：

- Event：明天 15:00 与老王开会
- Task：发送报价

且不会自动捏造会议结束时间。

---

## Project

输入：

> 下周去上海三天，预算3000，周三参加展会，酒店还没订。

必须生成：

- Project：上海出差
- Note / Record：预算3000
- Event：周三展会
- Task：预订酒店

---

## Tracker

输入：

> 帮我记录每场直播的观看人数、成交额和转化率。

必须能够生成 Tracker Schema。

后续：

> 今天观看3200，成交18600，转化3.7%。

应正确写入对应 Tracker。

---

## Today

Today 必须能按：

- 时间
- 截止日期
- 延期
- Project 风险

生成优先级。

---

## Review

Weekly Review 中的每一个结论必须能追溯到实际 Object / Record。

---

# 34. 开发建议

## App

```text
Expo
React Native
TypeScript
Expo Router
```

## Backend

推荐：

```text
PostgreSQL
API Server
Object / Relation Layer
AI Orchestration
Notification Worker
```

早期可以选择 Supabase 等托管后端降低开发量。

## AI

不要让一个 Prompt 负责全部事情。

拆成：

```text
Parser
Extractor
Builder
Linker
Scheduler
Reviewer
```

每个能力输出明确 JSON Schema。

---

# 35. 产品最核心的护城河

不是 UI。

不是某个模型。

而是长期积累的：

```text
Objects
+
Relations
+
User Preferences
+
行为历史
+
AI Corrections
```

最终形成：

# Personal Context Layer

当用户用了 6～12 个月后，序事应该越来越清楚：

- 用户在做什么
- 用户和谁合作
- 哪些项目重要
- 什么事情经常拖延
- 哪些数据值得关注
- 什么时间适合安排什么任务
- 用户如何做决策

这才是长期价值。

---

# 36. 产品一句话

> **序事不是让用户学会如何管理，而是让 AI 真正开始替用户管理。**

核心体验：

> **说一句 → 自动成事。**
