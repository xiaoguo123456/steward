import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** 保存在设备上的令牌对。 */
export type StoredSession = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
};

const KEY = 'steward.session';

/**
 * 令牌存储。
 *
 * 原生端使用系统钥匙串；Web 预览没有等价的安全存储，
 * 因此只放在内存里——刷新页面即退出登录，避免把令牌写进 localStorage。
 */
let webSession: StoredSession | null = null;

export async function loadSession(): Promise<StoredSession | null> {
  if (Platform.OS === 'web') {
    return webSession;
  }
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    // 钥匙串不可用时按未登录处理，不阻断应用启动。
    return null;
  }
}

export async function saveSession(session: StoredSession): Promise<void> {
  if (Platform.OS === 'web') {
    webSession = session;
    return;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  if (Platform.OS === 'web') {
    webSession = null;
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}
