import assert from 'node:assert/strict';
import test from 'node:test';

import { recentCompletedPeriods } from './review-period.ts';

test('周一默认选择刚结束的完整自然周', () => {
  const periods = recentCompletedPeriods(3, new Date(2026, 7, 24, 12));

  assert.deepEqual(
    periods.map((period) => period.weekOf),
    ['2026-08-17', '2026-08-10', '2026-08-03'],
  );
  assert.deepEqual(
    periods.map((period) => period.label),
    ['上周', '2 周前', '3 周前'],
  );
});

test('周日仍不把尚未结束的当前周当作复盘周期', () => {
  const [period] = recentCompletedPeriods(1, new Date(2026, 7, 30, 12));
  assert.equal(period.weekOf, '2026-08-17');
});

test('跨年时正确返回上一自然周', () => {
  const [period] = recentCompletedPeriods(1, new Date(2026, 0, 5, 12));
  assert.equal(period.weekOf, '2025-12-29');
});
