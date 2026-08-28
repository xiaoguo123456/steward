import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyOtaChanges } from './check-ota-safe-changes.mjs';

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
