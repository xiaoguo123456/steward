import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('保存后追问只在保存后的详情页主动触发', async () => {
  const create = await readFile(new URL('../../app/mood-journal/new.tsx', import.meta.url), 'utf8');
  const detail = await readFile(new URL('../../app/mood-journal/[id].tsx', import.meta.url), 'utf8');
  assert.match(create, /followUp: '1'/);
  assert.match(detail, /generateMoodJournalFollowUp/);
  assert.match(detail, /entry\.exclude_from_ai/);
});

test('周月回望要求逐篇选择并展示来源', async () => {
  const garden = await readFile(new URL('../../app/mood-journal/garden.tsx', import.meta.url), 'utf8');
  assert.match(garden, /period === 'week'/);
  assert.match(garden, /entry_ids: selected/);
  assert.match(garden, /source_entry_ids\.map/);
  assert.match(garden, /exclude_from_ai/);
});

test('心情草稿按平台隔离且 Web 不持久化敏感正文', async () => {
  const editor = await readFile(new URL('./mood-editor.tsx', import.meta.url), 'utf8');
  const webStorage = await readFile(new URL('./mood-draft-storage.web.ts', import.meta.url), 'utf8');
  const nativeStorage = await readFile(new URL('./mood-draft-storage.native.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(editor, /expo-secure-store|SecureStore/);
  assert.match(editor, /readMoodDraft/);
  assert.match(webStorage, /new Map/);
  assert.doesNotMatch(webStorage, /localStorage|sessionStorage|expo-secure-store/);
  assert.match(nativeStorage, /expo-secure-store/);
  assert.match(nativeStorage, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
});

test('心情 AI 单独同意在 Web 与原生都能结束等待', async () => {
  const polish = await readFile(new URL('./use-mood-journal-polish.ts', import.meta.url), 'utf8');
  const reflection = await readFile(new URL('./use-mood-journal-ai-consent.ts', import.meta.url), 'utf8');
  const confirmation = await readFile(new URL('../../components/ui/confirm-action.ts', import.meta.url), 'utf8');

  for (const source of [polish, reflection]) {
    assert.match(source, /confirmAction/);
  }
  assert.match(confirmation, /Platform\.OS === 'web'/);
  assert.match(confirmation, /globalThis\.confirm/);
  assert.match(confirmation, /Alert\.alert/);
});
