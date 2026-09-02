import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('确认交互在 Web 使用原生 confirm，原生端使用 Alert 回调', async () => {
  const source = await readFile(new URL('./confirm-action.ts', import.meta.url), 'utf8');

  assert.match(source, /Platform\.OS === 'web'/);
  assert.match(source, /globalThis\.confirm/);
  assert.match(source, /Alert\.alert/);
  assert.match(source, /onDismiss: \(\) => resolve\(false\)/);
});

test('有破坏性的入口统一使用可等待的确认交互', async () => {
  const paths = [
    '../../app/events/[id].tsx',
    '../../app/memories/[id].tsx',
    '../../app/mood-journal/[id].tsx',
    '../../app/notes/[id].tsx',
    '../../app/people/[id]/edit.tsx',
    '../../app/settings/captures.tsx',
    '../../app/tasks/[id].tsx',
    '../../features/important-dates/important-dates-content.tsx',
    '../../features/plan/task-list-sheets.tsx',
  ];

  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /confirmAction/);
  }
});

test('AI 任务候选允许用户检查并修正所属清单', async () => {
  const source = await readFile(
    new URL('../../features/capture/capture-candidate-editor.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /useListTaskLists/);
  assert.match(source, /label="所属清单"/);
  assert.match(source, /setField\('list_id', value\)/);
});
