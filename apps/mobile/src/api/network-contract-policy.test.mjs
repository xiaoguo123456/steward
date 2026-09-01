import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const fetcherPath = new URL('../../../../packages/api-client/src/http/fetcher.ts', import.meta.url);
const generatedViewsPath = new URL(
  '../../../../packages/api-client/src/generated/views/views.ts',
  import.meta.url,
);
const shoppingHookPath = new URL('../features/shopping/use-shopping-list.ts', import.meta.url);
const tripsHookPath = new URL('../features/trips/use-trips.ts', import.meta.url);
const projectDetailPath = new URL('../app/projects/[id].tsx', import.meta.url);
const assistantScreenPath = new URL('../app/ai.tsx', import.meta.url);
const assistantStreamPath = new URL('../features/assistant/use-turn-stream.ts', import.meta.url);
const notificationsHookPath = new URL('../features/notifications/use-notifications.ts', import.meta.url);

test('成功响应必须经过生成的 Zod Schema 校验', async () => {
  const [fetcher, generatedViews] = await Promise.all([
    readFile(fetcherPath, 'utf8'),
    readFile(generatedViewsPath, 'utf8'),
  ]);

  assert.match(fetcher, /responseValidator\.parse\(payload\)/);
  assert.match(generatedViews, /StewardResponseSchemas\.GetTodayResponse/);
  assert.match(generatedViews, /StewardResponseSchemas\.ListPendingRemindersResponse/);
});

test('失败写请求按方法、URL 和请求体保留稳定幂等键', async () => {
  const fetcher = await readFile(fetcherPath, 'utf8');

  assert.match(fetcher, /pendingIdempotencyKeys\.get\(identity\)/);
  assert.match(fetcher, /idempotencyIdentity\(method, url, init\?\.body, headers\.get\('If-Match'\)\)/);
  assert.match(fetcher, /releaseIdempotencyKey\(prepared\.identity\)/);
});

test('购物与行程更新携带当前实体版本', async () => {
  const [shopping, trips] = await Promise.all([
    readFile(shoppingHookPath, 'utf8'),
    readFile(tripsHookPath, 'utf8'),
  ]);

  assert.match(shopping, /'If-Match': String\(item\.version\)/);
  assert.match(trips, /'If-Match': String\(task\.version\)/);
});

test('Project 详情通过正式 project_id 查询聚合 Record', async () => {
  const projectDetail = await readFile(projectDetailPath, 'utf8');

  assert.match(projectDetail, /useListRecords\(\{ project_id: projectId, limit: 50 \}\)/);
  assert.match(projectDetail, /records\.error/);
});

test('Assistant 查询失败可恢复，停止回复与 SSE 刷新链路可达', async () => {
  const [screen, stream] = await Promise.all([
    readFile(assistantScreenPath, 'utf8'),
    readFile(assistantStreamPath, 'utf8'),
  ]);

  assert.match(screen, /operation\.isError/);
  assert.match(screen, /useCancelTurn/);
  assert.match(screen, /停止回复/);
  assert.match(stream, /getStreamTurnUrl\(turnId\)/);
  assert.match(stream, /request\.status === 401/);
  assert.match(stream, /session\.refresh\(\)/);
});

test('通知已读复用统一稳定幂等策略，不在重试时生成新键', async () => {
  const notifications = await readFile(notificationsHookPath, 'utf8');

  assert.match(notifications, /useMarkNotificationRead/);
  assert.doesNotMatch(notifications, /newIdempotencyKey/);
});
