import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('“我的”直接收纳资料、手机号和退出登录，不再进入重复设置页', async () => {
  const source = await readFile(new URL('../../app/me.tsx', import.meta.url), 'utf8');

  assert.match(source, /title="我的"/);
  assert.match(source, /router\.push\('\/settings\/phone'\)/);
  assert.match(source, /label="退出登录"/);
  assert.match(source, /openPage\('privacy'\)/);
  assert.match(source, /openPage\('terms'\)/);
  assert.match(source, /openPage\('personalInformation'\)/);
  assert.match(source, /openPage\('thirdParties'\)/);
  assert.match(source, /router\.push\('\/account-deletion'\)/);
  assert.match(source, /router\.push\('\/settings\/captures'\)/);
  assert.match(source, /openPage\('support'\)/);
  assert.match(source, /router\.push\(publicPageRoute\(page\)\)/);
  assert.doesNotMatch(source, /专注设置|应用锁|settings\/app-lock/);
  assert.doesNotMatch(source, /\/settings\/profile|\/settings\/account|router\.push\('\/settings'\)/);
});

test('根导航不再登记“全部设置”、资料和账号中转页', async () => {
  const source = await readFile(new URL('../../app/_layout.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /settings\/(?:index|profile|account)"/);
  assert.match(source, /settings\/phone"/);
  assert.match(source, /Stack\.Screen name="public-page"/);
  assert.match(source, /Stack\.Protected guard=\{boot === 'signed-out'\}/);
  assert.match(source, /Stack\.Protected guard=\{boot === 'signed-in'\}/);
  assert.doesNotMatch(source, /AppLockProvider|settings\/app-lock/);
});

test('短信登录采用两阶段流程并保留系统自动填充语义', async () => {
  const source = await readFile(new URL('../../app/(auth)/login.tsx', import.meta.url), 'utf8');
  const shell = await readFile(
    new URL('../auth/components/auth-shell.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /autoComplete="tel"/);
  assert.match(source, /textContentType="oneTimeCode"/);
  assert.match(source, /const \[codeRequested, setCodeRequested\] = useState\(false\)/);
  assert.match(source, /\{codeRequested \? '登录' : '获取验证码'\}/);
  assert.match(source, /codeRequested \? \(/);
  assert.match(source, /useState\(false\).*agreementAccepted|agreementAccepted.*useState\(false\)/s);
  assert.match(source, /agreementAccepted && phoneValid/);
  assert.match(source, /openLegalPage\('terms'\)/);
  assert.match(source, /openLegalPage\('privacy'\)/);
  assert.match(source, /router\.push\(publicPageRoute\(page\)\)/);
  assert.match(shell, /assets\/images\/icon\.png/);
  assert.match(shell, />序事<\/Text>/);
  assert.doesNotMatch(shell, />清单<\/Text>/);
  assert.doesNotMatch(source, /手机号验证后即可继续/);
  assert.doesNotMatch(source, /手机号会在发送验证码时开始处理/);
  assert.doesNotMatch(source, /本机号码一键登录/);
});

test('账号删除在响应丢失后保留短期重放凭证', async () => {
  const screen = await readFile(new URL('../../app/account-deletion.tsx', import.meta.url), 'utf8');
  const storage = await readFile(new URL('./account-deletion-storage.ts', import.meta.url), 'utf8');

  assert.match(screen, /savePendingAccountDeletion/);
  assert.match(screen, /本次尚未提交账号删除/);
  assert.doesNotMatch(screen, /savePendingAccountDeletion\(resumable\)\.catch/);
  assert.match(screen, /deletionIdempotencyKey: deletionKey\.current/);
  assert.match(screen, /reauth_token: resumable\.reauthToken/);
  assert.match(screen, /继续查询受理结果/);
  assert.match(storage, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(storage, /Number\.isFinite\(expiresAt\)/);
  assert.match(storage, /Date\.now\(\) >= expiresAt/);
  assert.match(storage, /sessionStorage/);
});

test('旧账号迟到的 refresh 响应不会覆盖新账号会话', async () => {
  const source = await readFile(new URL('../../api/session.ts', import.meta.url), 'utf8');

  assert.match(source, /private generation = 0/);
  assert.match(source, /const sourceGeneration = this\.generation/);
  assert.match(source, /this\.generation !== sourceGeneration \|\| this\.session !== source/);
  assert.match(source, /this\.generation \+= 1/g);
  assert.match(source, /if \(this\.refreshing === request\)/);
  assert.match(source, /private persistence: Promise<void> = Promise\.resolve\(\)/);
  assert.match(source, /this\.persistence\.then\(operation, operation\)/);
});
