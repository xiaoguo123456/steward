import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('首页头像入口使用按钮语义和 44dp 最小触控尺寸', async () => {
  const source = await readFile(new URL('../../app/(tabs)/today.tsx', import.meta.url), 'utf8');

  assert.match(source, /accessibilityLabel="打开我的"\s+accessibilityRole="button"/);
  assert.match(source, /avatar:\s*{[^}]*width:\s*44,[^}]*height:\s*44,/s);
});

test('Capture 图片删除入口通过 hitSlop 扩展到 44dp', async () => {
  const source = await readFile(new URL('../../app/capture/new.tsx', import.meta.url), 'utf8');
  const label = 'accessibilityLabel={`删除图片 ${index + 1}`}';
  const buttonStart = source.indexOf(label);
  assert.notEqual(buttonStart, -1, '缺少图片删除入口');
  const removeButton = source.slice(buttonStart, buttonStart + 240);

  assert.match(removeButton, /accessibilityRole="button"/);
  assert.match(removeButton, /hitSlop=\{9\}/);
  assert.match(source, /removeImage:\s*{[^}]*width:\s*26,[^}]*height:\s*26,/s);
});
