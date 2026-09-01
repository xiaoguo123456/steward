import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTaskEditRequest } from './task-edit-model.ts';

const base = {
  title: '准备发布', description: '', priority: 'high', listId: 'tls_1', projectId: '',
  focusDate: '', dueKind: 'date', originalDueKind: 'date', dueValue: '2026-09-08', scheduledStart: '2026-09-07 09:00',
  scheduledEnd: '2026-09-07 10:30', estimatedMinutes: '90',
};

test('任务编辑请求保持日期截止语义并清空互斥字段', () => {
  const request = buildTaskEditRequest(base, 'Asia/Shanghai');
  assert.equal(request.due_date, '2026-09-08');
  assert.equal(request.due_at, undefined);
  assert.ok(request.clear.includes('due_at'));
  assert.equal(request.estimated_minutes, 90);
  assert.equal(request.scheduled_timezone, 'Asia/Shanghai');
});

test('计划结束不晚于开始时拒绝保存', () => {
  assert.throws(() => buildTaskEditRequest({ ...base, scheduledEnd: '2026-09-07 08:59' }, 'Asia/Shanghai'), /结束时间/);
});
