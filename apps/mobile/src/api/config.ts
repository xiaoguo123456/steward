import Constants from 'expo-constants';
import { Platform } from 'react-native';

/** 后端默认端口，与 apps/backend 的 STEWARD_HTTP_ADDR 保持一致。 */
const DEFAULT_PORT = 8787;

/**
 * 解析后端基地址。
 *
 * 真机与模拟器不能用 localhost 访问开发机，因此从 Expo 的开发服务器地址
 * 推导出电脑在局域网中的 IP。显式配置 EXPO_PUBLIC_API_URL 时以它为准。
 */
export function resolveApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, '');
  }

  // Web 预览与后端同机，直接用 localhost。
  if (Platform.OS === 'web') {
    return `http://localhost:${DEFAULT_PORT}`;
  }

  const host = devServerHost();
  if (host) {
    return `http://${host}:${DEFAULT_PORT}`;
  }

  // Android 模拟器用 10.0.2.2 回指宿主机；iOS 模拟器与宿主机共享 localhost。
  return Platform.OS === 'android'
    ? `http://10.0.2.2:${DEFAULT_PORT}`
    : `http://localhost:${DEFAULT_PORT}`;
}

/** 从 Expo 开发服务器地址中取出主机名。 */
function devServerHost(): string | null {
  const candidates = [
    Constants.expoConfig?.hostUri,
    // 老版本 Expo 把地址放在 manifest 的不同字段里，这里做兼容。
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const host = candidate.split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return host;
    }
  }
  return null;
}
