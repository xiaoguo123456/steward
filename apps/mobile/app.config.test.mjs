import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveUpdateConfig } from './app.config.ts';

const projectId = '123e4567-e89b-42d3-a456-426614174000';

test('本地未配置远程更新时只使用安装包内置版本', () => {
  const config = resolveUpdateConfig('test', {});

  assert.deepEqual(config.runtimeVersion, { policy: 'appVersion' });
  assert.deepEqual(config.updates, { enabled: false });
  assert.equal(config.projectId, undefined);
});

test('测试与生产构建固定使用隔离的更新频道', () => {
  const env = {
    STEWARD_EXPO_PROJECT_ID: projectId,
    STEWARD_EXPO_UPDATES_CERTIFICATE: '.expo-updates/certificate.pem',
    STEWARD_REQUIRE_EXPO_UPDATES: '1',
  };

  const testConfig = resolveUpdateConfig('test', env);
  const productionConfig = resolveUpdateConfig('production', env);

  assert.equal(testConfig.updates.enabled, true);
  assert.equal(testConfig.updates.requestHeaders['expo-channel-name'], 'steward-test');
  assert.equal(
    productionConfig.updates.requestHeaders['expo-channel-name'],
    'steward-production',
  );
  assert.equal(productionConfig.updates.url, `https://u.expo.dev/${projectId}`);
  assert.equal(productionConfig.updates.codeSigningMetadata.keyid, 'main');
});

test('要求启用 OTA 时拒绝缺失或不完整配置', () => {
  assert.throws(
    () => resolveUpdateConfig('production', { STEWARD_REQUIRE_EXPO_UPDATES: '1' }),
    /缺少 Expo Project ID 或更新签名证书/,
  );
  assert.throws(
    () => resolveUpdateConfig('production', { STEWARD_EXPO_PROJECT_ID: projectId }),
    /必须同时配置/,
  );
  assert.throws(
    () =>
      resolveUpdateConfig('production', {
        STEWARD_EXPO_PROJECT_ID: 'not-a-project-id',
        STEWARD_EXPO_UPDATES_CERTIFICATE: '.expo-updates/certificate.pem',
      }),
    /有效的 Expo Project ID/,
  );
  assert.throws(
    () =>
      resolveUpdateConfig('production', {
        STEWARD_EXPO_PROJECT_ID: projectId,
        STEWARD_EXPO_UPDATES_CERTIFICATE: '/private/tmp/certificate.pem',
      }),
    /必须使用 apps\/mobile 下的相对路径/,
  );
});
