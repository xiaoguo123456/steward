import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { resolveAppName, resolveUpdateConfig } from './app.config.ts';

const projectId = '123e4567-e89b-42d3-a456-426614174000';

function readPngInfo(relativePath) {
  const data = readFileSync(new URL(relativePath, import.meta.url));
  assert.equal(data.subarray(1, 4).toString('ascii'), 'PNG', `${relativePath} 必须是 PNG`);
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
    colorType: data[25],
  };
}

test('原生配置移除应用锁权限、加入受控 H5 容器并统一移动端版本', () => {
  const app = JSON.parse(readFileSync(new URL('./app.json', import.meta.url), 'utf8'));
  const mobilePackage = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  const plugin = app.expo.plugins.find((item) => Array.isArray(item) && item[0] === 'expo-local-authentication');
  const icon = readPngInfo('./assets/images/icon.png');
  const foreground = readPngInfo('./assets/images/android-icon-foreground.png');
  const monochrome = readPngInfo('./assets/images/android-icon-monochrome.png');
  const storeIcon = readPngInfo('./assets/store/google-play-icon.png');
  const iconComposer = JSON.parse(
    readFileSync(new URL('./assets/expo.icon/icon.json', import.meta.url), 'utf8'),
  );

  assert.equal(plugin, undefined, '移除应用锁后不能继续声明生物识别权限');
  assert.equal(mobilePackage.dependencies['expo-local-authentication'], undefined);
  assert.equal(mobilePackage.dependencies['expo-web-browser'], undefined);
  assert.equal(mobilePackage.dependencies['react-native-webview'], '13.16.1');
  assert.equal(app.expo.name, '序事');
  assert.equal(resolveAppName('production', app.expo.name), '序事');
  assert.equal(resolveAppName('test', app.expo.name), '序事测试');
  assert.deepEqual(icon, { width: 1024, height: 1024, colorType: 2 });
  assert.deepEqual(foreground, { width: 1024, height: 1024, colorType: 6 });
  assert.deepEqual(monochrome, { width: 1024, height: 1024, colorType: 6 });
  assert.deepEqual(storeIcon, { width: 512, height: 512, colorType: 2 });
  assert.equal(iconComposer.groups[0].layers[0]['image-name'], 'sequence-path.png');
  assert.equal(app.expo.android.adaptiveIcon.backgroundColor, '#FCFCFA');
  assert.equal(app.expo.version, '1.0.0');
  assert.equal(app.expo.version, mobilePackage.version, 'Expo App 版本必须与移动端包版本一致');
  assert.equal(app.expo.android.versionCode, 2);
});

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
