import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyOtaChanges, isProjectSlugCorrection } from './check-ota-safe-changes.mjs';

test('只允许移动端源码、生成客户端源码和专用 OTA 资源', () => {
  const result = classifyOtaChanges([
    'apps/mobile/src/app/me.tsx',
    'packages/api-client/src/index.ts',
    'apps/mobile/assets/updates/guide.png',
    'docs/部署说明.md',
  ]);

  assert.deepEqual(result.blocked, []);
  assert.deepEqual(result.included, [
    'apps/mobile/src/app/me.tsx',
    'packages/api-client/src/index.ts',
    'apps/mobile/assets/updates/guide.png',
  ]);
});

test('依赖、应用配置和普通原生资源变化必须重新构建', () => {
  const result = classifyOtaChanges([
    'apps/mobile/package.json',
    'apps/mobile/app.config.ts',
    'apps/mobile/assets/images/icon.png',
    'pnpm-lock.yaml',
  ]);

  assert.deepEqual(result.included, []);
  assert.deepEqual(result.blocked, [
    'apps/mobile/package.json',
    'apps/mobile/app.config.ts',
    'apps/mobile/assets/images/icon.png',
    'pnpm-lock.yaml',
  ]);
});


test('项目别名纠正不会放行夹带的原生配置变更', () => {
  const before = { expo: { slug: 'ai-steward', android: { package: 'com.aisteward.mobile' }, runtimeVersion: { policy: 'appVersion' } } };
  const after = structuredClone(before);
  after.expo.slug = 'steward';
  assert.equal(isProjectSlugCorrection(before, after), true);
  assert.deepEqual(classifyOtaChanges(['apps/mobile/app.json'], (revision) => revision === 'base' ? before : after).blocked, []);
  for (const change of [
    (config) => { config.expo.android.package = 'other.app'; },
    (config) => { config.expo.runtimeVersion = '2.0.0'; },
    (config) => { config.expo.updates = { enabled: false }; },
    (config) => { config.expo.plugins = ['another-plugin']; },
    (config) => { config.expo.slug = 'other'; },
  ]) {
    const unsafe = structuredClone(after);
    change(unsafe);
    assert.equal(isProjectSlugCorrection(before, unsafe), false);
    assert.deepEqual(classifyOtaChanges(['apps/mobile/app.json'], (revision) => revision === 'base' ? before : unsafe).blocked, ['apps/mobile/app.json']);
  }
  assert.deepEqual(classifyOtaChanges(['apps/mobile/app.json']).blocked, ['apps/mobile/app.json']);
});
