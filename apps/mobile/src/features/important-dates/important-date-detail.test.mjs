import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('./important-dates-content.tsx', import.meta.url),
  'utf8',
);

test('重要日详情统一使用编辑入口且不再提供日历快捷入口', () => {
  assert.match(source, /label="编辑重要日"/);
  assert.doesNotMatch(source, /更新日期|在日历中查看|onOpenCalendar|useRouter/);
});

test('一次性重要日保留标记已处理，年度重复重要日不显示该操作', () => {
  assert.match(source, /\{!item\.repeatYearly \? \(/);
  assert.match(source, /label=\{busy \? '正在处理…' : '标记已处理'\}/);
  assert.match(source, /if \(!response\.data\.important_date_handled_at\)/);
  assert.match(source, /if \(restored\.data\.important_date_handled_at\)/);
});
