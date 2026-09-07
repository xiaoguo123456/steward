import { readFileSync, writeFileSync } from 'node:fs';
import * as api from '../../packages/api-client/src/index';

// 补测真正 HTTP/Worker 链路上的空输入、阻塞澄清和回答推进；仅允许本地专用账号。
const base = process.env.STEWARD_LATENCY_BASE ?? 'http://localhost:8792';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('仅限本地验收环境');
const session = JSON.parse(readFileSync(process.env.STEWARD_LATENCY_SESSION!, 'utf8'));
const output = process.env.STEWARD_LATENCY_OUTPUT!;
api.configureApiClient({ baseUrl: base, getAccessToken: async () => session.tokens.access_token, refreshTokens: async () => false });
const rows: Record<string, unknown>[] = [];
const record = (row: Record<string, unknown>) => {
  rows.push(row);
  writeFileSync(output, JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(row));
};
async function settle(id: string) {
  for (let i = 0; i < 180; i++) {
    const op = (await api.getOperation(id)).data;
    if (['succeeded', 'failed', 'cancelled'].includes(op.status)) return op;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('等待超时');
}
for (const text of ['', ' \n\t ']) {
  const thread = (await api.createThread({ title: '歧义输入 HTTP 验收', force_new: true })).data;
  try {
    await api.createTurn(thread.id, { text });
    record({ case: text === '' ? '空字符串' : '纯空白', rejected: false });
  } catch (error) {
    const e = error as { code?: string; status?: number };
    record({ case: text === '' ? '空字符串' : '纯空白', rejected: true, code: e.code, http: e.status });
  } finally {
    await api.deleteThread(thread.id);
  }
}
for (const [name, text, answer] of [
  ['乱码后补充', 'asdfghjkl @@##', '帮我记一个任务：歧义验收买牛奶，不设截止日期。'],
  ['矛盾时间', '明天上午十点开会，结束时间是同一天上午九点', '正确时间是明天上午十点到十一点。'],
  ['否定输入', '不要记任务，我只是随口说说想买牛奶', ''],
  ['明确不保存', '不要保存成任务、笔记或任何记录。我只是随口说说想买牛奶。', ''],
]) {
  if (process.env.STEWARD_AMBIGUITY_HTTP_CASE && name !== process.env.STEWARD_AMBIGUITY_HTTP_CASE) continue;
  const accepted = (await api.createCapture({ origin: 'assistant', parts: [{ kind: 'text', text }] })).data;
  const id = accepted.resource_id!;
  try {
    const operation = await settle(accepted.operation_id);
    const cap = (await api.getCapture(id)).data;
    const questions = (await api.listCaptureQuestions({ status: 'open', limit: 100 })).data.filter(q => q.capture_id === id);
    record({ case: name, stage: '初次解析', operation: operation.status, capture: cap.status, candidates: cap.candidates?.map(c => c.candidate_type), blocking_questions: questions.filter(q => q.blocking).length });
    if (cap.status === 'awaiting_instruction') {
      try {
        await api.confirmCapture(id, { revision: cap.revision, items: (cap.candidates ?? []).map(c => ({ candidate_id: c.id })) });
        record({ case: name, stage: '未澄清确认', blocked: false });
      } catch (error) {
        record({ case: name, stage: '未澄清确认', blocked: true, code: (error as { code?: string }).code });
      }
    }
    if (answer && questions.length > 0) {
      const next = (await api.answerCaptureQuestion(questions[0]!.id, { answer })).data;
      const operation = await settle(next.operation_id);
      const updated = (await api.getCapture(id)).data;
      const remaining = (await api.listCaptureQuestions({ status: 'open', limit: 100 })).data.filter(q => q.capture_id === id);
      record({ case: name, stage: '回答后', operation: operation.status, capture: updated.status, revision_advanced: updated.revision > cap.revision, candidates: updated.candidates?.map(c => c.candidate_type), open_questions: remaining.length });
    }
  } finally {
    await api.discardCapture(id);
  }
}
