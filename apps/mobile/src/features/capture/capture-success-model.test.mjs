import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeCaptureResources } from './capture-success-model.ts';

test('保存摘要只统计带 ID 的真实业务资源并去重', () => {
  const summary = summarizeCaptureResources([
    { type: 'capture', id: 'capture-1' },
    { type: 'task', id: 'task-1' },
    { type: 'task', id: 'task-1' },
    { type: 'event', id: 'event-1' },
    { type: 'today', id: null },
  ]);

  assert.deepEqual(summary, {
    count: 2,
    text: '1 项任务、1 项日程',
  });
});

test('服务端没有返回具体资源时使用已确认候选数量兜底', () => {
  assert.deepEqual(summarizeCaptureResources([], 3), {
    count: 3,
    text: '3 项内容',
  });
});
