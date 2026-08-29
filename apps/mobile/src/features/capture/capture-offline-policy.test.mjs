import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (name) => readFile(new URL(name, import.meta.url), 'utf8');

test('原生 Capture 草稿使用按账号隔离的 SQLCipher 与设备级密钥', async () => {
  const [store, config] = await Promise.all([
    read('./capture-draft-store.native.ts'),
    read('../../../app.json'),
  ]);

  assert.match(config, /"expo-sqlite"[\s\S]*"useSQLCipher": true/);
  assert.match(store, /digestStringAsync\(Crypto\.CryptoDigestAlgorithm\.SHA256, accountId\)/);
  assert.match(store, /openDatabaseAsync\(databaseName\(accountHash\)\)/);
  assert.match(store, /PRAGMA key/);
  assert.ok(store.indexOf('PRAGMA key') < store.indexOf('CREATE TABLE IF NOT EXISTS capture_drafts'));
  assert.match(store, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(store, /WHERE id = \? AND account_id = \?/);
  assert.match(store, /拒绝跨账号读写 Capture 草稿/);
});

test('媒体先复制到应用持久目录，Web 实现不把私有草稿写入浏览器存储', async () => {
  const [nativeStore, webStore] = await Promise.all([
    read('./capture-draft-store.native.ts'),
    read('./capture-draft-store.ts'),
  ]);

  assert.match(nativeStore, /Paths\.document, 'capture-drafts', accountHash, draftId/);
  assert.match(nativeStore, /await source\.copy\(destination\)/);
  assert.doesNotMatch(webStore, /globalThis\.(?:localStorage|sessionStorage)|AsyncStorage\./);
});

test('离线上传队列持久化稳定幂等键和 media_id，但不持久化签名 URL', async () => {
  const [model, queue, provider] = await Promise.all([
    read('./capture-draft-model.ts'),
    read('./capture-upload-queue.ts'),
    read('./capture-queue-provider.tsx'),
  ]);

  assert.match(model, /grantIdempotencyKey/);
  assert.match(model, /completeIdempotencyKey/);
  assert.match(model, /createCaptureIdempotencyKey/);
  assert.doesNotMatch(model, /uploadUrl|upload_url|signedUrl/);
  assert.match(queue, /mediaId: grant\.media_id/);
  assert.match(queue, /'Idempotency-Key': part\.grantIdempotencyKey/);
  assert.match(queue, /'Idempotency-Key': part\.completeIdempotencyKey/);
  assert.match(queue, /'Idempotency-Key': draft\.createCaptureIdempotencyKey/);
  assert.match(queue, /renewMediaUploadGrant\(part\.mediaId/);
  assert.doesNotMatch(queue, /saveCaptureDraft\([^)]*upload_url/s);

  assert.match(provider, /status === 'waiting_for_network'/);
  assert.match(provider, /const restored = online && onlineRef\.current === false/);
  assert.match(provider, /status: 'ready_for_upload'/);
});

test('退出登录提供保留或删除当前账号设备草稿的明确选择', async () => {
  const me = await read('../../app/me.tsx');
  assert.match(me, /保留草稿并退出/);
  assert.match(me, /删除设备草稿并退出/);
  assert.match(me, /deleteAccountCaptureDrafts\(accountId\)/);
});

test('用户清空已有 Capture 草稿后不会恢复出旧内容', async () => {
  const screen = await read('../../app/capture/new.tsx');

  assert.match(screen, /everHadContent\.current = Boolean\(initial\.text\.trim\(\) \|\| initial\.parts\.length\)/);
  assert.match(screen, /if \(hasContent\) everHadContent\.current = true/);
  assert.match(screen, /if \(draft\) await deleteCaptureDraft\(draft\.accountId, draft\.id\)/);
});
