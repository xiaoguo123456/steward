import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../app/tasks/[id].tsx', import.meta.url), 'utf8');

test('任务详情不展示内嵌 AI 操作和来源说明', () => {
  const removedCopy = [
    'AI 操作',
    'AI 帮我拆',
    '智能安排',
    'AI 只生成待确认建议',
    '这条任务由 AI 从一次输入整理生成',
  ];

  for (const copy of removedCopy) {
    assert.equal(source.includes(copy), false, `任务详情不应包含“${copy}”`);
  }
  assert.equal(source.includes("taskAction: 'split'"), false);
  assert.equal(source.includes("taskAction: 'schedule'"), false);
});
