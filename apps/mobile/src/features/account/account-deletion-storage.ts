import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type AccountDeletionCredential = {
  requestId: string;
  statusToken: string;
  acceptedAt: string;
  backupExpiresAt: string;
};

export type PendingAccountDeletion = {
  reauthToken: string;
  deletionIdempotencyKey: string;
  expiresAt: string;
};

const KEY = 'steward.account-deletion.status';
const PENDING_KEY = 'steward.account-deletion.pending';
let webCredential: AccountDeletionCredential | null = null;
let webPending: PendingAccountDeletion | null = null;

export async function loadAccountDeletionCredential(): Promise<AccountDeletionCredential | null> {
  if (Platform.OS === 'web') {
    try {
      const raw = globalThis.sessionStorage?.getItem(KEY);
      return raw ? parseCredential(raw) : webCredential;
    } catch {
      return webCredential;
    }
  }
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? parseCredential(raw) : null;
  } catch {
    return null;
  }
}

export async function saveAccountDeletionCredential(value: AccountDeletionCredential): Promise<void> {
  if (Platform.OS === 'web') {
    webCredential = value;
    try {
      globalThis.sessionStorage?.setItem(KEY, JSON.stringify(value));
    } catch {
      // 隐私模式可能禁用 Web Storage；本次页面仍保留内存副本并展示可复制凭证。
    }
    return;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(value), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadPendingAccountDeletion(): Promise<PendingAccountDeletion | null> {
  const raw = Platform.OS === 'web'
    ? readWebValue(PENDING_KEY)
    : await SecureStore.getItemAsync(PENDING_KEY).catch(() => null);
  const pending = raw ? parsePending(raw) : webPending;
  const expiresAt = pending ? Date.parse(pending.expiresAt) : Number.NaN;
  if (!pending || !Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
    await clearPendingAccountDeletion();
    return null;
  }
  return pending;
}

export async function savePendingAccountDeletion(value: PendingAccountDeletion): Promise<void> {
  if (Platform.OS === 'web') {
    webPending = value;
    try {
      globalThis.sessionStorage?.setItem(PENDING_KEY, JSON.stringify(value));
    } catch {
      // 隐私模式可能禁用 Web Storage；当前页面仍保留内存副本用于响应丢失重放。
    }
    return;
  }
  await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(value), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearPendingAccountDeletion(): Promise<void> {
  webPending = null;
  if (Platform.OS === 'web') {
    try {
      globalThis.sessionStorage?.removeItem(PENDING_KEY);
    } catch {
      // 内存副本已经清除。
    }
    return;
  }
  await SecureStore.deleteItemAsync(PENDING_KEY).catch(() => undefined);
}

function readWebValue(key: string): string | null {
  try {
    return globalThis.sessionStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function parseCredential(raw: string): AccountDeletionCredential | null {
  try {
    const value = JSON.parse(raw) as Partial<AccountDeletionCredential>;
    return value.requestId && value.statusToken && value.acceptedAt && value.backupExpiresAt
      ? (value as AccountDeletionCredential)
      : null;
  } catch {
    return null;
  }
}

function parsePending(raw: string): PendingAccountDeletion | null {
  try {
    const value = JSON.parse(raw) as Partial<PendingAccountDeletion>;
    return value.reauthToken && value.deletionIdempotencyKey && value.expiresAt
      ? (value as PendingAccountDeletion)
      : null;
  } catch {
    return null;
  }
}
