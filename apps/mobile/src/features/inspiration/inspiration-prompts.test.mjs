import assert from 'node:assert/strict';
import test from 'node:test';

import { selectDailyPrompt, selectDailyPrompts } from './inspiration-prompts.ts';

test('同一天稳定返回同一个今日问题', () => {
  assert.equal(selectDailyPrompt('2026-08-28'), selectDailyPrompt('2026-08-28'));
});

test('无效日期仍返回可用问题', () => {
  assert.match(selectDailyPrompt('invalid'), /[？?]$/);
});

test('每天稳定给出四个不同的灵感方向', () => {
  const first = selectDailyPrompts('2026-08-28');
  const second = selectDailyPrompts('2026-08-28');

  assert.deepEqual(first, second);
  assert.equal(first.length, 4);
  assert.equal(new Set(first.map((prompt) => prompt.id)).size, 4);
  assert.ok(first.every((prompt) => prompt.theme && prompt.question && prompt.nudge));
});
