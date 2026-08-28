import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('“我的”直接收纳资料、手机号和退出登录，不再进入重复设置页', async () => {
  const source = await readFile(new URL('../../app/me.tsx', import.meta.url), 'utf8');

  assert.match(source, /title="我的"/);
  assert.match(source, /router\.push\('\/settings\/phone'\)/);
  assert.match(source, /label="退出登录"/);
  assert.doesNotMatch(source, /\/settings\/profile|\/settings\/account|router\.push\('\/settings'\)/);
});

test('根导航不再登记“全部设置”、资料和账号中转页', async () => {
  const source = await readFile(new URL('../../app/_layout.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /settings\/(?:index|profile|account)"/);
  assert.match(source, /settings\/phone"/);
});

test('短信登录声明系统号码与验证码自动填充且不伪造一键登录按钮', async () => {
  const source = await readFile(new URL('../../app/(auth)/login.tsx', import.meta.url), 'utf8');

  assert.match(source, /autoComplete="tel"/);
  assert.match(source, /textContentType="oneTimeCode"/);
  assert.doesNotMatch(source, /本机号码一键登录/);
});
