# @steward/contracts

网络契约的唯一来源。前后端都不得在任一侧手写 DTO、URL、枚举或错误码。

## 结构

```text
openapi/openapi.yaml            根文件：info、servers、security、paths 索引
openapi/paths/*.yaml            按业务模块拆分的 Path Item
openapi/components/schemas/     DTO、枚举、错误与来源结构
openapi/components/parameters.yaml
openapi/components/responses.yaml
dist/openapi.bundle.yaml        生成产物，两端代码生成只读取它
```

## 命令

```bash
pnpm --filter @steward/contracts run lint     # Redocly 校验
pnpm --filter @steward/contracts run bundle   # 打包成单文件
pnpm --filter @steward/contracts run check    # 两者都跑
```

## 约定

- 所有成功响应统一为 `{data, meta}`，集合额外带 `page`。
- 所有错误响应统一为 `{error, meta}`，App 只依赖 `error.code` 分支，不解析文案。
- 写请求必须携带 `Idempotency-Key`；并发编辑应携带 `If-Match`。
- 异步处理返回 `202` 与 `operation_id`，客户端通过 Operation 轮询。
- 所有对象都带 `additionalProperties: false`，防止字段漂移。

## 两个刻意的设计

**PATCH 用显式 `clear` 数组表达清空。** 生成的 Go 类型无法区分「字段不传」与「传 null」，
两者都会变成 `nil`，于是无法清空截止日期。因此可空字段的清空必须把字段名放进 `clear` 数组。
备选方案是给全部 130 个 schema 套 `nullable.Nullable[T]` 包装类型，代价远大于收益。

**数值字段显式声明 `format: double`。** 不写 format 时生成的是 `float32`，
只有约 7 位有效数字，记账金额会在千元级别丢失精度。

## 变更流程

改动契约后必须运行 `make generate` 重新生成 Go Server、TypeScript Client 与 Zod 校验器，
并确认工作区无漂移。涉及行为变化时，先更新 `docs/功能规格说明.md`。
