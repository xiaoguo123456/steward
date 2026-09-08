# Qwen3.8 Flash 价格配置与成本验收

## 配置口径

生产配置已只读核对：OpenAI 兼容适配器连接阿里云北京地域，解析、视觉与对话模型均为
`qwen3.8-flash`。此次只配置该模型的成本价格，不切换模型，不配置 `qwen3-asr-flash`。
后台属于既有内部 Web，本轮仅修正确定性核算和运维配置，不新增 App、H5 页面、权限、SDK
或 AI 执行能力。模型、Prompt、用户侧 API 及 AI Schema 均无变化，因此无需新增 AI Eval。

2026-09-08 核验的[阿里云模型官方价格](https://help.aliyun.com/zh/model-studio/qwen3-8-flash)：

| 单位（每百万 Token） | 人民币单价 |
| --- | ---: |
| 普通输入 | 0.8 |
| 缓存命中输入 | 0.1 |
| 输出（含思考） | 2.7 |

后台现有账本与预算统一 USD，不把人民币金额写入 USD 字段。采用
[国家外汇管理局公布的当日中间价](https://www.safe.gov.cn/AppStructured/hlw/RMBQuery.do?COLLCC=546877760)
`1 USD = 6.7804 CNY`，使用 PostgreSQL numeric 计算 `人民币单价 / 6.7804`，
保留现有 8 位小数精度。此汇率固化在价格版本内，不随日后汇率浮动改写历史。
价格仅为原价估算，未扣免费额度或账户优惠，也不表示供应商实际结算账单。

配置文件：`infra/pricing/qwen3.8-flash-beijing-20260908.sql`。
价格从核验日 `2026-09-08 00:00:00+08:00` 生效，早于该日的未知历史价格继续缺失；
本次不启用 Batch、显式缓存创建或其它计费项目。脚本在事务内新增三个版本，重复执行核对
已存版本完全一致；不同价格或重叠生效区间会使整笔回滚，不覆盖旧版本。

## 必要核算修复

Provider 的 `prompt_tokens` 包含缓存命中部分。落账普通输入数量改为
`input_tokens - cached_input_tokens`，缓存部分单独按缓存单价计费；用量事实不改写。
缓存数量超出总输入、任何负用量均拒绝结算。零用量即使已有价格，金额仍为 NULL、
状态仍为 `not_applicable`，避免触发成本明细约束而让整批结算失败。

仅 SQL 查询实现变化，已重新生成 sqlc；不改变数据库结构或网络字段，故无新增迁移、
OpenAPI、Go 网络 DTO、TypeScript Client 或移动端适配。对计算规则补充了实际数据库回归。

## 运维与验收

价格录入使用对应环境已有的后台数据库角色。随后通过镜像内的 `cost-recalculate`，
先预览，再显式执行：

```sh
cost-recalculate -provider openai -model qwen3.8-flash -day 2026-09-08
cost-recalculate -provider openai -model qwen3.8-flash -day 2026-09-08 -apply
```

补算仅把指定模型当天的记录重置为待算，不改 Token 或其它业务事实。结算复用正式成本服务，
使用无 BYPASSRLS 的运行账号逐用户处理，然后刷新当天报表；同一用户其它已待算记录也按
各自既有价格版本正常结算。重复运行覆盖成本明细，不累加费用。命令只打印模型、日期、
调用数量和执行状态，不输出用户 ID、手机号、凭据或用户正文。

成本与聚合模块的 race 回归已通过，覆盖混合缓存、全缓存、全部零用量、价格版本和聚合。
根 `make check` 通过，golangci-lint 新增问题为 0。另建独立验收库，三项价格连续录入两次保持一致；补算预览保持 pending，执行两次均得到 USD 0.00106189（总输入 10000、缓存 5000、输出 1000），无重复收费。发布、配置回读及线上补算结果完成后补充。
