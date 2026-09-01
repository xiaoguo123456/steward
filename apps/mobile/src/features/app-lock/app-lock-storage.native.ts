import * as SecureStore from 'expo-secure-store';

import { appLockStorageKey } from './model';

export async function readAppLockEnabled(accountId: string): Promise<boolean> {
  return (await SecureStore.getItemAsync(appLockStorageKey(accountId))) === '1';
}

export async function writeAppLockEnabled(accountId: string, enabled: boolean): Promise<void> {
  const key = appLockStorageKey(accountId);
  if (!enabled) {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  await SecureStore.setItemAsync(key, '1', {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
