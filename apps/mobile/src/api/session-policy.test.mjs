import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { shouldRefreshAccessToken } from './session-policy.ts';

test('Access Token 到期前一分钟开始静默续期', () => {
  const now = Date.parse('2026-09-02T12:00:00.000Z');

  assert.equal(shouldRefreshAccessToken('2026-09-02T12:00:30.000Z', now), true);
  assert.equal(shouldRefreshAccessToken('2026-09-02T12:02:00.000Z', now), false);
  assert.equal(shouldRefreshAccessToken('invalid-date', now), true);
});

test('只有明确的鉴权错误才清除长期登录态', async () => {
  const source = await readFile(new URL('./session.ts', import.meta.url), 'utf8');

  assert.match(source, /if \(isUnauthenticated\(error\)\) \{[\s\S]*await this\.signOut\(\)/);
  assert.match(source, /throw error/);
});
