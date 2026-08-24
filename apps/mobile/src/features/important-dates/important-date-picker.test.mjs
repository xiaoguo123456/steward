import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createImportantDateYearOptions,
  getDaysInMonth,
  updateImportantDatePart,
} from './important-date-picker.ts';

test('月份天数覆盖大小月与闰年', () => {
  assert.equal(getDaysInMonth(2026, 1), 31);
  assert.equal(getDaysInMonth(2026, 4), 30);
  assert.equal(getDaysInMonth(2024, 2), 29);
  assert.equal(getDaysInMonth(2025, 2), 28);
});

test('切换年月时把无效日期收敛到当月最后一天', () => {
  assert.equal(updateImportantDatePart('2026-01-31', 'month', 2), '2026-02-28');
  assert.equal(updateImportantDatePart('2024-02-29', 'year', 2025), '2025-02-28');
});

test('年份选项覆盖历史日期和未来日期', () => {
  const years = createImportantDateYearOptions(2026);
  assert.equal(years[0], 1900);
  assert.equal(years.at(-1), 2126);
});
