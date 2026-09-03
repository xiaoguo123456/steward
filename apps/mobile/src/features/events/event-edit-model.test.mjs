import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { buildEventEditRequest, eventEditDraft, parseZonedLocalDateTime } from './event-edit-model.ts';

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

test('跨时区日程进入编辑态时保持 Event 当地分钟语义', () => {
  const draft = eventEditDraft({
    id: 'evt_1', type: 'event', title: '跨区评审', event_kind: 'schedule', all_day: false,
    start_at: '2026-09-08T02:00:45.000Z', end_at: '2026-09-08T03:30:20.000Z',
    timezone: 'Asia/Shanghai', recurrence: 'none', created_by: 'user', created_at: '', updated_at: '', version: 1,
  });
  assert.equal(draft.start, '2026-09-08 10:00');
  assert.equal(draft.end, '2026-09-08 11:30');
});

test('日程详情隐藏独立时区行，详情和确认卡不使用带秒的默认格式', async () => {
  const detail = await readFile(new URL('../../app/events/[id].tsx', import.meta.url), 'utf8');
  const confirmation = await readFile(new URL('../capture/assistant-capture-flow.tsx', import.meta.url), 'utf8');
  const personCreate = await readFile(new URL('../../app/people/[id]/event/new.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(detail, /<Row label="时区"/);
  assert.doesNotMatch(detail, /toLocaleString\('zh-CN'\)/);
  assert.doesNotMatch(confirmation, /toLocaleString\('zh-CN'\)/);
  assert.match(personCreate, /<TimeWheel/);
});
