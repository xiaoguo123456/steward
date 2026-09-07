# Agent 响应时间验收

`run.ts` 使用正式生成 Client，测量本地 API → River Worker → 真实模型 → 权威结果读取。每例创建独立对话，默认串行执行 12 类输入各 3 次，额外一次聊天暖机不进入统计。

## 准备与运行

- 使用专用本地验收数据库，库名包含 `hardening` 或 `latency`；不能指向生产或日常开发库。API 与 Worker 必须使用同一个验收库，迁移至当前版本。
- 启动当前版本 API、Worker 和媒体存储，配置真实 Provider。记录模型、思考模式和 Git 提交。
- 使用已授权的本地测试账号登录，把生成 Client 的登录响应 `data` 保存到权限为 `0600` 的临时 JSON 文件。脚本不发送验证码。
- 准备只包含虚构资料的 PNG 和有效 WAV。音频应先确认时长、采样率和声道；本轮用 7.68 秒、16 kHz、单声道 PCM。

在仓库根目录执行：

```sh
node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/bin/esbuild tools/agent-latency/run.ts --bundle --platform=node --format=esm --outfile=/tmp/steward-agent-latency.mjs

STEWARD_LATENCY_DATABASE="postgres://$USER@localhost:5432/steward_agent_latency?sslmode=disable" \
STEWARD_LATENCY_BASE=http://localhost:8792 \
STEWARD_LATENCY_SESSION=/tmp/steward-agent-local-session.json \
STEWARD_LATENCY_OUTPUT=/tmp/steward-agent-latency.json \
STEWARD_LATENCY_IMAGE=/tmp/steward-agent-image.png \
STEWARD_LATENCY_AUDIO=/tmp/steward-agent-audio.wav \
node /tmp/steward-agent-latency.mjs
```

数据库连接需要读取对应验收账号的 Turn、工具、AI 审计和 River Job 时间戳；查询不导出用户正文、凭据或媒体地址。脚本只允许本地 URL，`STEWARD_LATENCY_REPEATS` 可设置为 1–10，默认 3。

## 口径与清理

- `ack_ms`：发起提交至收到异步受理结果。
- `first_status_ms`：收到首个 SSE 阶段事件，不是首字。
- `first_text_ms`：收到首个非空 SSE 文本；仅代表传输可见，不含原生渲染时间。
- `stream_done_ms`：SSE 报告最终写入完成。
- `operation_seen_ms`：250 毫秒探针轮询观察到 Operation 终态。
- `result_read_ms`：终态后读到正式消息／建议或 Capture 候选。与 App 的 800–1000 毫秒轮询口径不同。
- `queue_ms`、`worker_ms`：来自数据库时间戳。River 的 `worker_ms=null` 表示采样时 Job 尚未写入最终时间，不能按零计算。
- `model[].ms`：Provider 路径累计耗时，包含网络、服务端生成及本地流式回调，不等于纯模型算力耗时。Assistant 每 Turn 的审计是多次模型往返的合计。
- `upload_ms`：上传授权、直传和完成上传；媒体上传与录音时间不包含在 `result_read_ms` 内。

需要单次模型往返细分时，在同一个隔离环境中单独运行，避免与 HTTP 基准争用资源：

```sh
STEWARD_AI_LIVE_ACCEPTANCE=1 go -C apps/backend test -count=1 -v ./internal/platform/ai/eval -run '^TestLiveAssistantAcceptance$'
```

该测试记录每次模型往返、总编排和工具耗时，并验证查询与建议确认闭环；它直接调用应用服务，不测 HTTP 或队列。

HTTP 脚本拒绝自己生成的建议，清理自己创建的对话、任务及媒体；Capture 和模型审计保留在专用验收库。正常结束后删除临时登录文件。若进程被强制中止，应核对本次虚构记录再清理，不要批量删除账号已有内容。

结果只用于低负载性能基线。每类 3 次应报告中位数与范围，不能据此声称生产 p95、并发容量或原生点击到渲染的耗时达标。正式样本存在 `measurement_error` 时停止，不把采样工具失败当成产品失败或成功。
