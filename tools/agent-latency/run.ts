import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as api from '../../packages/api-client/src/index';

// 真实 HTTP、River、模型的串行小样本验收；只输出时间、数量和状态，不输出正文或凭据。
// 必须使用专用本地验收库。会创建虚构任务和对话，结束后清理；Capture 审计留在验收库。
const base = process.env.STEWARD_LATENCY_BASE ?? 'http://localhost:8792';
const database = process.env.STEWARD_LATENCY_DATABASE ?? '';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)
  || !['localhost', '127.0.0.1'].includes(new URL(database).hostname)
  || !/hardening|latency/.test(new URL(database).pathname)) {
  throw new Error('只允许专用本地验收环境');
}
const session = JSON.parse(readFileSync(process.env.STEWARD_LATENCY_SESSION!, 'utf8'));
const output = process.env.STEWARD_LATENCY_OUTPUT!;
const repeats = Number(process.env.STEWARD_LATENCY_REPEATS ?? 3);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error('重复次数需为 1 至 10');
api.configureApiClient({ baseUrl: base, getAccessToken: async () => session.tokens.access_token, refreshTokens: async () => false });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const elapsed = (start: number) => Math.round(performance.now() - start);
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const sql = (query: string) => JSON.parse(execFileSync('psql', [database, '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' }).trim());
const samples: Record<string, unknown>[] = [];
const save = () => writeFileSync(output, JSON.stringify({ environment: '本地隔离 API/Worker + 真实 Provider', repeats, polling_ms: 250, samples }, null, 2));

async function poll(operation: string) {
  const deadline = performance.now() + 100_000;
  while (performance.now() < deadline) {
    const op = (await api.getOperation(operation)).data;
    if (['succeeded', 'failed', 'cancelled'].includes(op.status)) return op;
    await sleep(250);
  }
  throw new Error('验收等待超时');
}

async function watch(turn: string, start: number, row: Record<string, unknown>, signal: AbortSignal) {
  try {
    const response = await fetch(base + api.getStreamTurnUrl(turn), { headers: { Authorization: `Bearer ${session.tokens.access_token}` }, signal });
    row.stream_http = response.status;
    if (!response.ok || !response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      pending += decoder.decode(value, { stream: true });
      const frames = pending.split('\n\n');
      pending = frames.pop()!;
      for (const frame of frames) for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const event = JSON.parse(line.slice(5));
        if (event.kind === 'status' && row.first_status_ms === undefined) row.first_status_ms = elapsed(start);
        if (event.kind === 'delta' && event.text && row.first_text_ms === undefined) row.first_text_ms = elapsed(start);
        if (event.kind === 'tool') row.stream_tool_count = Number(row.stream_tool_count ?? 0) + 1;
        if (event.kind === 'done' || event.kind === 'error') { row.stream_done_ms = elapsed(start); return; }
      }
    }
  } catch (error) {
    if (!signal.aborted) row.stream_error = (error as { name?: string }).name ?? '连接错误';
  }
}

function assistantMetrics(turn: string, since: string) {
  return sql(`select json_build_object(
    'queue_ms',round(extract(epoch from (started_at-created_at))*1000),
    'worker_ms',round(extract(epoch from (completed_at-started_at))*1000),
    'server_total_ms',round(extract(epoch from (completed_at-created_at))*1000),
    'tools',(select coalesce(json_agg(json_build_object('name',capability_name,'status',status,'error_code',error_code,'ms',duration_ms) order by call_seq),'[]') from ai_tool_calls where turn_id=t.id),
    'model',(select coalesce(json_agg(json_build_object('policy',model_policy,'model',provider_model,'ms',latency_ms,'input_tokens',input_tokens,'output_tokens',output_tokens,'status',status)),'[]') from ai_actions where user_id=t.user_id and feature='assistant' and created_at>=${quote(since)})
  ) from assistant_turns t where id=${quote(turn)}`);
}

async function assistantSample(name: string, text: string, repeat: number) {
  const thread = (await api.createThread({ title: '响应时间验收', force_new: true })).data;
  const row: Record<string, unknown> = { name, repeat, kind: 'assistant' };
  let streaming: Promise<void> | undefined;
  const controller = new AbortController();
  try {
    const since = new Date().toISOString();
    const start = performance.now();
    const turn = (await api.createTurn(thread.id, { text })).data;
    row.ack_ms = elapsed(start);
    streaming = watch(turn.turn_id!, start, row, controller.signal);
    const op = await poll(turn.operation_id!);
    row.operation_seen_ms = elapsed(start);
    row.status = op.status;
    row.error_code = op.error?.code;
    const [messages, proposals] = await Promise.all([api.listMessages(thread.id, { limit: 30 }), api.listProposals({ status: ['pending'], limit: 100 })]);
    row.result_read_ms = elapsed(start);
    row.has_answer = messages.data.some(m => m.role === 'assistant');
    const owned = proposals.data.filter(p => p.turn_id === turn.turn_id);
    row.proposals = owned.map(p => p.proposal_type);
    const expected: Record<string, string> = { 创建任务: 'task_create', 修改任务: 'task_update', 拆分任务: 'task_split', 创建日程: 'event_create', 记录偏好: 'memory_upsert' };
    row.result_ready = op.status === 'succeeded' && row.has_answer === true
      && (!expected[name] || owned.some(p => p.proposal_type === expected[name]));
    Object.assign(row, assistantMetrics(turn.turn_id!, since));
    for (const proposal of owned) await api.rejectProposal(proposal.id);
  } catch (error) {
    row.measurement_error = (error as { code?: string }).code ?? '验收异常';
  } finally {
    controller.abort();
    await streaming;
    await api.deleteThread(thread.id);
    samples.push(row); save(); console.log(JSON.stringify(row));
  }
  if (row.measurement_error) throw new Error('采样工具失败，详情见脱敏结果');
}

async function captureSample(name: string, kinds: ('text' | 'image' | 'audio')[], repeat: number) {
  const row: Record<string, unknown> = { name, repeat, kind: 'capture' };
  const media: string[] = [];
  try {
    const uploadStart = performance.now();
    const parts: api.CreateCaptureRequestPartsItem[] = [];
    for (const kind of kinds) {
      if (kind === 'text') { parts.push({ kind, text: '明天下午三点前整理响应时间验收材料，创建一个任务。' }); continue; }
      const file = kind === 'image' ? process.env.STEWARD_LATENCY_IMAGE! : process.env.STEWARD_LATENCY_AUDIO!;
      const data = readFileSync(file);
      const grant = (await api.createUploadGrants({ items: [{ kind, content_type: kind === 'image' ? 'image/png' : 'audio/wav', byte_size: data.length }] })).data[0]!;
      media.push(grant.media_id);
      const uploaded = await fetch(grant.upload_url, { method: grant.method, headers: grant.headers, body: data });
      if (!uploaded.ok) throw new Error('上传失败');
      await api.completeMediaUpload(grant.media_id, { byte_size: data.length });
      parts.push({ kind, media_id: grant.media_id });
    }
    row.upload_ms = elapsed(uploadStart);
    const start = performance.now();
    const accepted = (await api.createCapture({ origin: 'assistant', parts })).data;
    row.ack_ms = elapsed(start);
    const op = await poll(accepted.operation_id!);
    row.operation_seen_ms = elapsed(start);
    row.status = op.status;
    row.error_code = op.error?.code;
    const capture = (await api.getCapture(accepted.resource_id!)).data;
    row.result_read_ms = elapsed(start);
    row.capture_status = capture.status;
    row.candidates = capture.candidates?.length ?? 0;
    row.result_ready = op.status === 'succeeded' && capture.status === 'needs_confirmation' && Number(row.candidates) > 0;
    Object.assign(row, sql(`select json_build_object(
      'server_total_ms',round(extract(epoch from(completed_at-created_at))*1000),
      'model',(select coalesce(json_agg(json_build_object('policy',model_policy,'model',provider_model,'ms',latency_ms,'status',status,'input_tokens',input_tokens,'output_tokens',output_tokens)),'[]') from ai_actions where run_id=${quote(accepted.resource_id!)}),
      'jobs',(select coalesce(json_agg(json_build_object('kind',kind,'queue_ms',round(extract(epoch from(attempted_at-created_at))*1000),'worker_ms',round(extract(epoch from(finalized_at-attempted_at))*1000),'attempt',attempt)),'[]') from river_job where args->>'operation_id'=${quote(accepted.operation_id!)})
    ) from async_operations where id=${quote(accepted.operation_id!)}`));
  } catch (error) { row.measurement_error = (error as { code?: string }).code ?? '验收异常'; }
  finally {
    for (const id of media) await api.deleteMediaAsset(id);
    samples.push(row); save(); console.log(JSON.stringify(row));
  }
  if (row.measurement_error) throw new Error('采样工具失败，详情见脱敏结果');
}

const fixtures: api.Task[] = [];
try {
  fixtures.push((await api.createTask({ title: '响应时间验收周报' })).data);
  // 暖机不计入样本；每例独立对话，不把历史增长混入类别差异。
  await assistantSample('暖机', '你好，请简短回应。', 0);
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const [name, text] of [
      ['简短聊天', '你好，请简短回应。'],
      ['空查询', '查找标题包含不存在的响应时间验收XYZ的任务。'],
      ['任务查询', '查找标题包含响应时间验收周报的任务。'],
      ['创建任务', '帮我记一个任务：明天下午三点前交响应时间验收报告，请生成待确认建议。'],
      ['修改任务', '把响应时间验收周报的截止时间改到明天下午三点，请生成待确认建议。'],
      ['拆分任务', '把响应时间验收周报拆成三个子任务，请生成待确认建议。'],
      ['创建日程', '明天上午十点到十一点开响应时间验收会议，请生成日程待确认建议。'],
      ['记录偏好', '请记住我一般晚上七点以后运动，生成待确认的记忆建议。'],
    ]) await assistantSample(name!, text!, repeat);
    for (const [name, kinds] of [
      ['文字整理', ['text']], ['单图整理', ['image']], ['短语音整理', ['audio']], ['图文语音混合', ['text', 'image', 'audio']],
    ] as const) await captureSample(name, [...kinds], repeat);
  }
} finally {
  for (const task of fixtures) await api.deleteTask(task.id, { headers: { 'If-Match': String(task.version) } });
  save();
}
