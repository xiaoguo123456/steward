import { readFileSync, writeFileSync } from 'node:fs';
import { configureApiClient, createTask, deleteTask, getTask } from '../../packages/api-client/src/index';

const session = JSON.parse(readFileSync('/tmp/steward-agent-local-session.json', 'utf8'));
configureApiClient({ baseUrl: 'http://localhost:8792', getAccessToken: async () => session.tokens.access_token, refreshTokens: async () => false });
const output = '/tmp/steward-intent-fixtures.json';
if (process.argv.includes('--cleanup')) {
  const items: string[] = JSON.parse(readFileSync(output, 'utf8'));
  for (const id of items) {
    const current = await getTask(id);
    await deleteTask(id, { headers: { 'If-Match': String(current.data.version) } });
  }
  console.log('已清理本次原生选择验收任务');
} else {
  const ids: string[] = [];
  for (const due_date of ['2026-09-10', '2026-09-12']) {
    const response = await createTask({ title: '意图验收周报', due_date });
    ids.push(response.data.id);
  }
  writeFileSync(output, JSON.stringify(ids), { mode: 0o600 });
  console.log('已创建两条有不同截止日期的同名合成任务');
}
