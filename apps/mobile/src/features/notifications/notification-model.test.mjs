import assert from 'node:assert/strict';
import test from 'node:test';

import { groupNotifications, mergeNotifications, notificationDestination } from './notification-model.ts';

test('通知来源进入对应正式详情路由', () => {
  assert.deepEqual(notificationDestination('task', 'tsk_1'), { pathname: '/tasks/[id]', params: { id: 'tsk_1' } });
  assert.deepEqual(notificationDestination('event', 'evt_1'), { pathname: '/events/[id]', params: { id: 'evt_1' } });
  assert.deepEqual(notificationDestination('project', 'prj_1'), { pathname: '/projects/[id]', params: { id: 'prj_1' } });
  assert.deepEqual(notificationDestination('review', 'rev_1'), { pathname: '/features/[slug]', params: { slug: 'review' } });
});

test('通知按设备本地今天和更早分组，并保持服务端顺序', () => {
  const items = [notification('new', '2026-09-01T08:00:00+08:00'), notification('old', '2026-08-31T23:59:00+08:00')];
  const groups = groupNotifications(items, new Date('2026-09-01T12:00:00+08:00'));
  assert.deepEqual(groups.map((group) => [group.title, group.items.map((item) => item.id)]), [['今天', ['new']], ['更早', ['old']]]);
});

test('分页结果按 id 去重并让新快照覆盖旧状态', () => {
  const old = notification('same', '2026-09-01T08:00:00Z');
  const read = { ...old, read_at: '2026-09-01T08:01:00Z' };
  assert.deepEqual(mergeNotifications([old], [read]), [read]);
});

function notification(id, occurredAt) {
  return { id, type: 'task_due', title: id, body: '任务到期提醒', source_type: 'task', source_id: `source_${id}`, occurred_at: occurredAt, read_at: null, source_deleted: false };
}
