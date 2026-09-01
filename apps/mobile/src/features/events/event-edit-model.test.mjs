import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEventEditRequest, parseZonedLocalDateTime } from './event-edit-model.ts';

test('全天日程切换会清空定时时刻并使用当地提醒', () => {
  const request = buildEventEditRequest({
    title: '评审会', allDay: true, start: '2026-09-08', end: '', timezone: 'Asia/Shanghai',
    location: '', participants: '小林，小周', projectId: '', note: '', reminderEnabled: true, reminderOption: '10m', reminderTime: '09:00',
  });
  assert.equal(request.start_date, '2026-09-08');
  assert.deepEqual(request.participants, ['小林', '小周']);
  assert.deepEqual(request.reminders, [{ kind: 'absolute_local', days_before: 0, local_time: '09:00' }]);
  assert.ok(request.clear.includes('start_at'));
});

test('定时日程结束时间必须晚于开始时间', () => {
  assert.throws(() => buildEventEditRequest({
    title: '评审会', allDay: false, start: '2026-09-08 10:00', end: '2026-09-08 09:00', timezone: 'Asia/Shanghai',
    location: '', participants: '', projectId: '', note: '', reminderEnabled: false, reminderOption: '10m', reminderTime: '09:00',
  }), /结束时间/);
});

test('定时时间按 Event 时区转换为绝对时刻', () => {
  assert.equal(parseZonedLocalDateTime('2026-09-08 10:00', 'Asia/Shanghai'), '2026-09-08T02:00:00.000Z');
});
