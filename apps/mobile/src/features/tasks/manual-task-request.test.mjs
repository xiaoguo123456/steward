import assert from 'node:assert/strict';
import test from 'node:test';

import { buildManualTaskRequest } from './manual-task-request.ts';

test('手动表单预选加入今天只写入 focus_date，不伪造今天截止', () => {
  assert.deepEqual(buildManualTaskRequest({
    title: '  整理照片  ',
    description: '',
    priority: 'normal',
    listId: 'list-default',
    focusDate: '2026-08-28',
  }), {
    title: '整理照片',
    priority: 'normal',
    list_id: 'list-default',
    focus_date: '2026-08-28',
  });
});

test('手动设置截止日期时保留用户时区和自选提醒时间', () => {
  assert.deepEqual(buildManualTaskRequest({
    title: '交报告',
    description: '  发给项目组  ',
    priority: 'high',
    listId: 'list-work',
    dueDate: '2026-08-29',
    dueTimezone: 'Asia/Singapore',
    reminders: [{ kind: 'absolute_local', local_time: '18:30', days_before: 0 }],
  }), {
    title: '交报告',
    description: '发给项目组',
    priority: 'high',
    list_id: 'list-work',
    due_date: '2026-08-29',
    due_timezone: 'Asia/Singapore',
    reminders: [{ kind: 'absolute_local', local_time: '18:30', days_before: 0 }],
  });
});

test('从亲友详情创建任务时保留人物关联且不改变清单归属', () => {
  assert.deepEqual(buildManualTaskRequest({
    title: '给妈妈买药',
    description: '',
    priority: 'normal',
    listId: 'list-family',
    personId: 'per-mom',
  }), {
    title: '给妈妈买药',
    priority: 'normal',
    list_id: 'list-family',
    person_id: 'per-mom',
  });
});
