import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMonthlyLedgerReport } from './ledger-report.ts';

test('月报只统计当前月真实记录并按周与分类聚合', () => {
  const report = buildMonthlyLedgerReport([
    { amount: 30, category: '餐饮', timestamp: new Date('2026-08-02T08:00:00+08:00'), type: 'expense' },
    { amount: 70, category: '餐饮', timestamp: new Date('2026-08-09T08:00:00+08:00'), type: 'expense' },
    { amount: 20, category: '交通', timestamp: new Date('2026-08-09T09:00:00+08:00'), type: 'expense' },
    { amount: 500, category: '工资', timestamp: new Date('2026-08-10T08:00:00+08:00'), type: 'income' },
    { amount: 999, category: '餐饮', timestamp: new Date('2026-07-31T08:00:00+08:00'), type: 'expense' },
  ], new Date('2026-08-18T12:00:00+08:00'));

  assert.equal(report.expense, 120);
  assert.equal(report.income, 500);
  assert.equal(report.balance, 380);
  assert.deepEqual(report.weeklySpend, [30, 90, 0]);
  assert.deepEqual(report.categoryReport, [
    { label: '餐饮', amount: 100, ratio: 100 / 120 },
    { label: '交通', amount: 20, ratio: 20 / 120 },
  ]);
});

test('没有支出时保持空统计，不编造趋势', () => {
  const report = buildMonthlyLedgerReport([], new Date('2026-08-03T12:00:00+08:00'));
  assert.equal(report.expense, 0);
  assert.equal(report.expenseCount, 0);
  assert.deepEqual(report.categoryReport, []);
  assert.deepEqual(report.weeklySpend, [0]);
});
