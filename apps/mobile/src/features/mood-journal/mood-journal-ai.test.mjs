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
  const reflection = await readFile(new URL('../../app/mood-journal/reflections/[period].tsx', import.meta.url), 'utf8');
  assert.match(reflection, /period === 'week'/);
  assert.match(reflection, /entry_ids: selected/);
  assert.match(reflection, /source_entry_ids\.map/);
  assert.match(reflection, /exclude_from_ai/);
  assert.match(reflection, /mostFrequentMood/);
  assert.match(reflection, /NavHeader title="心情回望"/);
  assert.match(reflection, /仅分析你勾选的日记/);
  assert.doesNotMatch(reflection, /每篇日记，汇成|较常出现|常出现的感受|未选择或未同意时/);
  assert.doesNotMatch(reflection, /\.toSorted\(/);
});

test('心情首页只保留一个本月回望入口', async () => {
  const content = await readFile(new URL('./mood-journal-content.tsx', import.meta.url), 'utf8');
  assert.match(content, /本月回望/);
  assert.match(content, /mood-journal\/reflections\/\[period\]/);
  assert.doesNotMatch(content, /心情花园|查看花园|mood-journal\/garden/);
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
