import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Web 不调用仅 iOS 可用的降低透明度接口', async () => {
  const source = await readFile(new URL('../../app/(tabs)/_layout.tsx', import.meta.url), 'utf8');
  const platformGuard = source.indexOf("if (Platform.OS !== 'ios') return;");
  const apiCall = source.indexOf('void getReducedTransparency()');

  assert.notEqual(platformGuard, -1);
  assert.notEqual(apiCall, -1);
  assert.ok(platformGuard < apiCall);
});
