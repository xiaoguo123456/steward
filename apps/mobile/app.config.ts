import type { ConfigContext, ExpoConfig } from 'expo/config';

const TEST_PACKAGE = 'com.aisteward.mobile.test';
const PRODUCTION_PACKAGE = 'com.aisteward.mobile';

/** 根据构建环境生成可并存、可追溯的原生应用配置。 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = process.env.APP_VARIANT?.trim() || 'production';
  if (variant !== 'test' && variant !== 'production') {
    throw new Error(`APP_VARIANT 只允许 test 或 production，当前为 ${variant}`);
  }

  const versionCode = parseVersionCode(
    process.env.STEWARD_ANDROID_VERSION_CODE,
    config.android?.versionCode ?? 1,
  );
  const version = process.env.STEWARD_APP_VERSION?.trim() || config.version || '1.0.0';
  const isTest = variant === 'test';

  return {
    ...config,
    name: isTest ? '清单测试' : config.name || '清单',
    slug: config.slug || 'ai-steward',
    version,
    scheme: isTest ? 'aisteward-test' : config.scheme,
    android: {
      ...config.android,
      package: isTest ? TEST_PACKAGE : PRODUCTION_PACKAGE,
      versionCode,
    },
    extra: {
      ...config.extra,
      stewardEnvironment: variant,
      stewardBuildSha: process.env.STEWARD_BUILD_SHA?.trim() || 'local',
    },
  };
};

function parseVersionCode(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`STEWARD_ANDROID_VERSION_CODE 必须是正整数，当前为 ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`STEWARD_ANDROID_VERSION_CODE 超出安全整数范围，当前为 ${value}`);
  }
  return parsed;
}
