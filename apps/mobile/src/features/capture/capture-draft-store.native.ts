import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import {
  deleteDatabaseAsync,
  openDatabaseAsync,
  type SQLiteDatabase,
} from 'expo-sqlite';

import type { LocalMedia } from './use-media-upload';
import {
  createDraftPart,
  type CaptureDraft,
  type CaptureDraftPart,
} from './capture-draft-model';

type DraftRow = {
  payload: string;
};

const databaseCache = new Map<string, Promise<SQLiteDatabase>>();

export async function saveCaptureDraft(accountId: string, draft: CaptureDraft): Promise<void> {
  assertAccount(accountId, draft);
  const db = await databaseFor(accountId);
  const next = { ...draft, updatedAt: new Date().toISOString() };
  await db.runAsync(
    `INSERT INTO capture_drafts (id, account_id, status, updated_at, payload)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       account_id = excluded.account_id,
       status = excluded.status,
       updated_at = excluded.updated_at,
       payload = excluded.payload`,
    next.id,
    accountId,
    next.status,
    next.updatedAt,
    JSON.stringify(next),
  );
}

export async function getCaptureDraft(accountId: string, draftId: string): Promise<CaptureDraft | null> {
  const db = await databaseFor(accountId);
  const row = await db.getFirstAsync<DraftRow>(
    'SELECT payload FROM capture_drafts WHERE id = ? AND account_id = ?',
    draftId,
    accountId,
  );
  return row ? parseDraft(row.payload, accountId) : null;
}

export async function listCaptureDrafts(accountId: string): Promise<CaptureDraft[]> {
  const db = await databaseFor(accountId);
  const rows = await db.getAllAsync<DraftRow>(
    'SELECT payload FROM capture_drafts WHERE account_id = ? ORDER BY updated_at DESC',
    accountId,
  );
  return rows.map((row) => parseDraft(row.payload, accountId));
}

export async function persistDraftMedia(
  accountId: string,
  draftId: string,
  item: LocalMedia,
  position: number,
): Promise<CaptureDraftPart> {
  const accountHash = await hashAccount(accountId);
  const directory = new Directory(Paths.document, 'capture-drafts', accountHash, draftId);
  directory.create({ idempotent: true, intermediates: true });

  const source = new File(item.uri);
  const extension = source.extension || extensionFor(item.contentType);
  const destination = new File(directory, `${Crypto.randomUUID()}${extension}`);
  await source.copy(destination);

  return createDraftPart({
    kind: item.kind,
    uri: destination.uri,
    contentType: item.contentType,
    byteSize: destination.size ?? item.byteSize,
    position,
  });
}

export async function deleteCaptureDraft(accountId: string, draftId: string): Promise<void> {
  const db = await databaseFor(accountId);
  await db.runAsync('DELETE FROM capture_drafts WHERE id = ? AND account_id = ?', draftId, accountId);
  const directory = new Directory(Paths.document, 'capture-drafts', await hashAccount(accountId), draftId);
  if (directory.exists) directory.delete();
}

export async function releaseCaptureDraftFiles(accountId: string, draftId: string): Promise<void> {
  const directory = new Directory(Paths.document, 'capture-drafts', await hashAccount(accountId), draftId);
  if (directory.exists) directory.delete();
}

export async function deleteAccountCaptureDrafts(accountId: string): Promise<void> {
  const accountHash = await hashAccount(accountId);
  const cached = databaseCache.get(accountHash);
  if (cached) {
    await (await cached).closeAsync();
    databaseCache.delete(accountHash);
  }
  await deleteDatabaseAsync(databaseName(accountHash)).catch(() => undefined);
  await SecureStore.deleteItemAsync(keyName(accountHash));
  const directory = new Directory(Paths.document, 'capture-drafts', accountHash);
  if (directory.exists) directory.delete();
}

async function databaseFor(accountId: string): Promise<SQLiteDatabase> {
  if (!accountId) throw new Error('打开草稿库前必须确定当前账号');
  const accountHash = await hashAccount(accountId);
  let opening = databaseCache.get(accountHash);
  if (!opening) {
    opening = openEncryptedDatabase(accountHash).catch((error) => {
      databaseCache.delete(accountHash);
      throw error;
    });
    databaseCache.set(accountHash, opening);
  }
  return opening;
}

async function openEncryptedDatabase(accountHash: string): Promise<SQLiteDatabase> {
  const db = await openDatabaseAsync(databaseName(accountHash));
  const key = await databaseKey(accountHash);
  await db.execAsync(`PRAGMA key = '${key}'`);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS capture_drafts (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS capture_drafts_account_updated_idx
      ON capture_drafts (account_id, updated_at DESC);
  `);
  return db;
}

async function databaseKey(accountHash: string): Promise<string> {
  const name = keyName(accountHash);
  const existing = await SecureStore.getItemAsync(name);
  if (existing) return existing;
  const bytes = await Crypto.getRandomBytesAsync(32);
  const key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(name, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

async function hashAccount(accountId: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, accountId);
}

function databaseName(accountHash: string): string {
  return `capture-${accountHash.slice(0, 32)}.db`;
}

function keyName(accountHash: string): string {
  return `steward.capture.db-key.${accountHash}`;
}

function parseDraft(payload: string, accountId: string): CaptureDraft {
  const draft = JSON.parse(payload) as CaptureDraft;
  assertAccount(accountId, draft);
  return draft;
}

function assertAccount(accountId: string, draft: CaptureDraft) {
  if (!accountId || draft.accountId !== accountId) {
    throw new Error('拒绝跨账号读写 Capture 草稿');
  }
}

function extensionFor(contentType: string): string {
  if (contentType === 'image/png') return '.png';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/heic') return '.heic';
  if (contentType.startsWith('audio/')) return '.m4a';
  return '.jpg';
}
