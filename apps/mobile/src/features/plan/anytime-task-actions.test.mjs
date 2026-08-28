import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAddToTodayRequest,
  buildSetTaskDateRequest,
} from './anytime-task-actions.ts';

test('加入今天只写入 focus_date', () => {
  assert.deepEqual(buildAddToTodayRequest('2026-08-28'), {
    focus_date: '2026-08-28',
  });
});

test('设置日期同时保留 date-only 语义和用户时区', () => {
  assert.deepEqual(buildSetTaskDateRequest('2026-09-01', 'Asia/Shanghai'), {
    due_date: '2026-09-01',
    due_timezone: 'Asia/Shanghai',
  });
});
