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
