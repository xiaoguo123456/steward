import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('“我的”直接收纳资料、手机号和退出登录，不再进入重复设置页', async () => {
  const source = await readFile(new URL('../../app/me.tsx', import.meta.url), 'utf8');

  assert.match(source, /title="我的"/);
  assert.match(source, /router\.push\('\/settings\/phone'\)/);
  assert.match(source, /label="退出登录"/);
  assert.match(source, /publicPagePaths\.privacy/);
  assert.match(source, /publicPagePaths\.terms/);
  assert.match(source, /publicPagePaths\.personalInformation/);
  assert.match(source, /publicPagePaths\.thirdParties/);
  assert.match(source, /router\.push\('\/account-deletion'\)/);
  assert.match(source, /router\.push\('\/settings\/captures'\)/);
  assert.match(source, /publicPagePaths\.support/);
  assert.doesNotMatch(source, /\/settings\/profile|\/settings\/account|router\.push\('\/settings'\)/);
});

test('根导航不再登记“全部设置”、资料和账号中转页', async () => {
  const source = await readFile(new URL('../../app/_layout.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /settings\/(?:index|profile|account)"/);
  assert.match(source, /settings\/phone"/);
  assert.match(source, /Stack\.Protected guard=\{boot === 'signed-out'\}/);
  assert.match(source, /Stack\.Protected guard=\{boot === 'signed-in'\}/);
});

test('短信登录声明系统号码与验证码自动填充且不伪造一键登录按钮', async () => {
  const source = await readFile(new URL('../../app/(auth)/login.tsx', import.meta.url), 'utf8');

  assert.match(source, /autoComplete="tel"/);
  assert.match(source, /textContentType="oneTimeCode"/);
  assert.match(source, /useState\(false\).*agreementAccepted|agreementAccepted.*useState\(false\)/s);
  assert.match(source, /agreementAccepted && phoneValid/);
  assert.match(source, /publicPagePaths\.terms/);
  assert.match(source, /publicPagePaths\.privacy/);
  assert.doesNotMatch(source, /本机号码一键登录/);
});

test('账号删除在响应丢失后保留短期重放凭证', async () => {
  const screen = await readFile(new URL('../../app/account-deletion.tsx', import.meta.url), 'utf8');
  const storage = await readFile(new URL('./account-deletion-storage.ts', import.meta.url), 'utf8');

  assert.match(screen, /savePendingAccountDeletion/);
  assert.match(screen, /deletionIdempotencyKey: deletionKey\.current/);
  assert.match(screen, /reauth_token: resumable\.reauthToken/);
  assert.match(screen, /继续查询受理结果/);
  assert.match(storage, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(storage, /Number\.isFinite\(expiresAt\)/);
  assert.match(storage, /Date\.now\(\) >= expiresAt/);
  assert.match(storage, /sessionStorage/);
});
