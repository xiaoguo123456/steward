import type { ConfigContext, ExpoConfig } from 'expo/config';

const TEST_PACKAGE = 'com.aisteward.mobile.test';
const PRODUCTION_PACKAGE = 'com.aisteward.mobile';
const EXPO_PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UpdateEnvironment = {
  STEWARD_EXPO_PROJECT_ID?: string;
  STEWARD_EXPO_UPDATES_CERTIFICATE?: string;
  STEWARD_REQUIRE_EXPO_UPDATES?: string;
};

export type StewardVariant = 'test' | 'production';

/** 用户可见品牌名与构建变体绑定，避免测试包和生产包混淆。 */
export function resolveAppName(variant: StewardVariant, configuredName?: string): string {
  return variant === 'test' ? '序事测试' : configuredName || '序事';
}

export function resolveUpdateConfig(
  variant: StewardVariant,
  env: UpdateEnvironment,
): {
  projectId: string | undefined;
  runtimeVersion: NonNullable<ExpoConfig['runtimeVersion']>;
  updates: NonNullable<ExpoConfig['updates']>;
} {
  const projectId = env.STEWARD_EXPO_PROJECT_ID?.trim();
  const certificate = env.STEWARD_EXPO_UPDATES_CERTIFICATE?.trim();
  const required = env.STEWARD_REQUIRE_EXPO_UPDATES === '1';

  if (projectId && !EXPO_PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error('STEWARD_EXPO_PROJECT_ID 必须是有效的 Expo Project ID');
  }
  if ((projectId && !certificate) || (!projectId && certificate)) {
    throw new Error('Expo Project ID 与更新签名证书必须同时配置');
  }
  if (certificate?.startsWith('/') || /^[A-Za-z]:[\\/]/.test(certificate ?? '')) {
    throw new Error('更新签名证书必须使用 apps/mobile 下的相对路径');
  }
  if (required && (!projectId || !certificate)) {
    throw new Error('当前构建要求启用 OTA，但缺少 Expo Project ID 或更新签名证书');
  }

  const channel = variant === 'test' ? 'steward-test' : 'steward-production';
  const updates: NonNullable<ExpoConfig['updates']> =
    projectId && certificate
      ? {
          enabled: true,
          url: `https://u.expo.dev/${projectId}`,
          requestHeaders: { 'expo-channel-name': channel },
          checkAutomatically: 'ON_LOAD',
          fallbackToCacheTimeout: 0,
          useEmbeddedUpdate: true,
          codeSigningCertificate: certificate,
          codeSigningMetadata: {
            keyid: 'main',
            alg: 'rsa-v1_5-sha256',
          },
        }
      : {
          enabled: false,
        };

  return {
    projectId,
    runtimeVersion: { policy: 'appVersion' },
    updates,
  };
}

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
  const updateConfig = resolveUpdateConfig(variant, {
    STEWARD_EXPO_PROJECT_ID: process.env.STEWARD_EXPO_PROJECT_ID,
    STEWARD_EXPO_UPDATES_CERTIFICATE: process.env.STEWARD_EXPO_UPDATES_CERTIFICATE,
    STEWARD_REQUIRE_EXPO_UPDATES: process.env.STEWARD_REQUIRE_EXPO_UPDATES,
  });

  return {
    ...config,
    name: resolveAppName(variant, config.name),
    slug: config.slug || 'ai-steward',
    version,
    scheme: isTest ? 'aisteward-test' : config.scheme,
    runtimeVersion: updateConfig.runtimeVersion,
    updates: updateConfig.updates,
    android: {
      ...config.android,
      package: isTest ? TEST_PACKAGE : PRODUCTION_PACKAGE,
      versionCode,
    },
    extra: {
      ...config.extra,
      stewardEnvironment: variant,
      stewardBuildSha: process.env.STEWARD_BUILD_SHA?.trim() || 'local',
      ...(updateConfig.projectId
        ? {
            eas: {
              ...(typeof config.extra?.eas === 'object' ? config.extra.eas : {}),
              projectId: updateConfig.projectId,
            },
          }
        : {}),
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
