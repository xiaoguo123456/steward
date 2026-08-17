# 运动前端原型

## 范围

本模块对应功能规格 8.2、产品设计 9.2 与架构设计 3.3.1 的“运动”生活场景入口。当前只实现 Expo 前端原型，覆盖运动首页、运动准备、运动进行中、运动总结和历史记录。

支持四种模式：户外跑步、健走、骑行和力量训练。户外模式使用模拟路线与计时数据；力量训练使用本地动作、组数和休息计时。两类页面采用不同交互结构，不把所有运动压缩成同一种记录表单。

## 数据边界

- 当前状态、路线、历史记录和统计均为本地 Mock，仅用于视觉与交互验收，不是权威运动数据。
- 当前不请求定位、计步器或后台运动权限，也不新增原生依赖。
- “保存运动记录”是用户主动确认动作，但当前只更新本地预览状态，不写入正式 Record。
- 后续接入正式能力时，运动结果投影到既有 Tracker / Record；网络字段必须来自 `packages/contracts/openapi`，移动端只能使用生成的 API Client 与 Zod 校验器。
- 真实 GPS 会话、运动状态机、重复检测和时间语义需要在跨端设计完成后实现，不能把本模块的 Mock 类型直接升级为网络 DTO。

## 页面

| 页面 | 路由 | 说明 |
|---|---|---|
| 运动首页 | `/features/exercise` | 四种运动的直接入口和最近两条运动记录；不承载目标设置 |
| 运动准备 | `/features/exercise/[mode]/prepare` | 目标、播报、定位或训练计划确认 |
| 运动进行中 | `/features/exercise/[mode]/active` | 户外地图数据或力量动作组数 |
| 运动总结 | `/features/exercise/[mode]/summary` | 模式化总结、感受选择和本地保存确认 |
| 历史记录 | `/features/exercise/history` | 按模式筛选并查看历史摘要 |

## 图标策略

- 通用操作继续使用项目既有线性图标；运动模式使用 Pictogrammers Material Design Icons 的同一套成熟运动图形。
- 页面只传入 `running`、`walking`、`cycling`、`strength` 语义名称，具体字形、品牌色和光学尺寸由 `components/ui/icon` 统一适配，Feature 不直接导入图标库。
- 四个运动入口均使用深品牌绿图标与相同浅中性底色，不以颜色区分默认选择，也不维护手绘 SVG。

## 交互组件策略

- 户外运动的目标类型使用 Expo UI `SegmentedControl`，目标数值使用 Expo UI `Slider`；它们分别映射 Android Material 3、iOS SwiftUI 和 Web 原生控件。
- Feature 只使用 `components/ui/selection-controls` 的品牌适配组件，不直接导入 `@expo/ui`；品牌色、外观和后续平台差异由适配层统一处理。
- 开始按钮继续复用运动模块统一主按钮，开关使用 React Native 平台 `Switch`，不在页面里重复实现同类基础控件。
