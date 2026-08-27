import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const consumers = [
  '../../app/(tabs)/notes.tsx',
  '../../app/features/exercise/history.tsx',
  '../../app/features/recipes/index.tsx',
  '../../features/projects/project-scope-bar.tsx',
];

test('内容筛选统一复用 FilterChip', async () => {
  for (const relativePath of consumers) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(source, /<FilterChip\b/, `${relativePath} 没有复用 FilterChip`);
  }
});

test('FilterChip 使用统一的轻量选中样式', async () => {
  const source = await readFile(new URL('./filter-chip.tsx', import.meta.url), 'utf8');

  assert.match(source, /minHeight:\s*34/);
  assert.match(source, /backgroundColor:\s*colors\.surfaceSubtle/);
  assert.match(source, /backgroundColor:\s*colors\.primarySoft/);
  assert.match(source, /color:\s*colors\.primaryStrong/);
  assert.doesNotMatch(source, /backgroundColor:\s*colors\.primary[,\n]/);
});
