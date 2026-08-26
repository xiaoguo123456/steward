import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTripRequest,
  parseTripDescription,
  validateTripDraft,
} from './trip-form.ts';

const validDraft = {
  title: '北京周末行',
  destination: '北京',
  startDate: '2026-09-05',
  endDate: '2026-09-07',
  notes: '带身份证\n提前值机',
};

test('新建行程固定创建 trip 类型项目并保留注意事项', () => {
  assert.deepEqual(buildTripRequest(validDraft), {
    title: '北京周末行',
    description: '北京\n带身份证\n提前值机',
    start_date: '2026-09-05',
    target_date: '2026-09-07',
    project_kind: 'trip',
  });
});

test('目的地与注意事项可以从项目描述稳定还原', () => {
  assert.deepEqual(parseTripDescription('北京\n带身份证\n提前值机'), {
    destination: '北京',
    notes: '带身份证\n提前值机',
  });
});

test('结束日期早于开始日期时禁止创建', () => {
  assert.equal(
    validateTripDraft({ ...validDraft, endDate: '2026-09-04' }),
    '结束日期不能早于开始日期',
  );
  assert.equal(validateTripDraft(validDraft), null);
});
