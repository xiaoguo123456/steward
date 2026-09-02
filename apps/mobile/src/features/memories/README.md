# 时光移动端

## 当前范围

`features/memories` 承载首页“时光”分区的 React Native 原生正式链路：

- 照片主导的月份时间线与独立月历查找。
- 首页“按日期／选照片”复用公共紧凑按钮，不与底栏全局新增图标竞争。
- 1～9 张系统选图、朋友圈式九宫格预览、移除单张照片，以及可选描述。
- 发布走正式媒体直传和 `POST /v1/memory-moments`，成功后直接返回首页“时光”时间线，不自动进入新条目详情；列表与详情来自当前用户的服务端数据。
- 发布后内容只读；契约、服务端和移动端均不提供更新能力，只能删除整段时光。

每条时光必须至少包含一张图片，不提供纯文字入口。描述可以留空，发布日期由服务端按账号时区生成。

## 数据与契约边界

- 网络 DTO 只定义在 `packages/contracts/openapi/components/schemas/memory-moments.yaml`，
  移动端通过生成的 Client 和 Query Hook 访问，不手写 URL 或网络类型。
- `MemoryMoment` 只是由生成 DTO 映射出的展示模型，不得与后端长期记忆
  `memory_items` 混用。
- 仓库不再在运行时装载本地时光 Fixture，也不显示“本地演示内容”或确定性假 AI 结果。
- 发布与删除使用幂等键；详情和列表中的图片地址是短期私有地址，不写日志、不长期缓存。

## 媒体、隐私与 AI

- 相册入口复用 `expo-image-picker`，只在用户主动点击后打开系统选择器，最多 9 张。
- App 不读取未选择媒体，不使用 EXIF 定位，不根据照片位置自动创建足迹。
- 照片直传私有对象存储，API 只保存用户隔离的媒体引用；删除时清理服务端副本，
  不影响系统相册原文件。
- 当前产品决策是不把时光照片或正文发送给 AI，也不展示本地假 Candidate。
  后续若开放文案或图像理解，必须先完成单独同意、第三方清单、AI Schema、审计和 Eval，
  并保持“AI 只给 Candidate、用户确认后发布”的边界。

## 文件

- `memory-model.ts`：网络 DTO 到展示模型的映射、日期分组与格式化。
- `memory-picker.ts`：选图转换、MIME 归一、按选择顺序去重和九张上限。
- `memories-home.tsx`：正式查询驱动的首页时间线。
- `memory-moment-row.tsx`、`memory-photo-grid.tsx`：可复用照片与日期组件。

路由位于 `src/app/memories`：`calendar.tsx`、`new.tsx` 和 `[id].tsx`。
