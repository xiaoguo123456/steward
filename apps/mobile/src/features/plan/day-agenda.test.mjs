import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { GetTodayResponse, GetTodayQueryParams } from '../../../../../packages/api-client/src/generated/views/views.zod.ts';
import { register } from 'node:module';

register(new URL('../../../../../tools/typescript-extension-loader.mjs', import.meta.url));
const { agendaEventTime, dayAgendaCount, dayAgendaItems } = await import('./day-agenda.ts');

const fixture = JSON.parse(readFileSync(new URL('../../../../../packages/contracts/fixtures/today-agenda.response.json', import.meta.url), 'utf8')).data;

test('只有上班日程时列表与数字均为一项，不显示空状态', () => {
  assert.equal(dayAgendaCount(fixture), 1);
  assert.equal(dayAgendaItems(fixture)[0].event.title, '上班');
  assert.equal(dayAgendaItems(fixture)[0].kind, 'event');
});

test('逾期任务与日程同时出现，任务总数不能覆盖事项总数', () => {
  const task = { task: { id: 'tsk_overdue', title: '逾期事项' }, group: 'overdue' };
  const view = { ...fixture, tasks: [task] };
  const items = dayAgendaItems(view);
  assert.equal(dayAgendaCount(view), 2);
  assert.deepEqual(items.map(item => item.kind), ['task', 'event']);
  assert.equal(items[0].item, task);
});

test('展开上限适用于任务和日程的总和，展开不会遗漏或重复', () => {
  const view = { tasks: [], events: Array.from({ length: 6 }, (_, i) => ({ ...fixture.events[0], id: `evt_${i}` })) };
  const items = dayAgendaItems(view);
  assert.equal(items.slice(0, 4).length, 4);
  assert.equal(items.length - items.slice(0, 4).length, 2);
  assert.equal(new Set(items.map(item => item.key)).size, 6);
  assert.equal(dayAgendaCount(view), items.length);
});

test('混合结果保留服务端的任务分组和日程时间顺序', () => {
  const tasks = ['due', 'scheduled', 'manual'].map(id => ({ task: { id }, group: id }));
  const events = ['all_day', 'morning', 'evening'].map(id => ({ ...fixture.events[0], id }));
  const items = dayAgendaItems({ tasks, events });
  assert.deepEqual(items.filter(item => item.kind === 'task').map(item => item.item.task.id), ['due', 'scheduled', 'manual']);
  assert.deepEqual(items.filter(item => item.kind === 'event').map(item => item.event.id), ['all_day', 'morning', 'evening']);
});

test('空数据和未加载数据不产生占位事项', () => {
  assert.equal(dayAgendaCount(), 0);
  assert.deepEqual(dayAgendaItems(), []);
  assert.deepEqual(dayAgendaItems({ tasks: [], events: [] }), []);
});


test('日程按账号时区显示分钟，跨日和全天语义明确', () => {
  const event = fixture.events[0];
  assert.equal(agendaEventTime(event, 'Asia/Shanghai', '2026-09-11'), '09:30');
  assert.equal(agendaEventTime({ ...event, end_at: '2026-09-11T10:00:59+08:00' }, 'Asia/Shanghai', '2026-09-11'), '09:30–10:00');
  assert.equal(agendaEventTime({ ...event, start_at: '2026-09-10T23:00:00+08:00', end_at: '2026-09-11T10:00:00+08:00' }, 'Asia/Shanghai', '2026-09-11'), '2026/9/10 23:00–10:00');
  assert.equal(agendaEventTime({ ...event, all_day: true }, 'Asia/Shanghai', '2026-09-11'), '全天');
});


test('日程样例符合正式响应契约，新参数保留旧请求兼容性', () => {
  const response = { data: fixture, meta: { request_id: 'req_test' } };
  assert.equal(GetTodayResponse.safeParse(response).success, true);
  assert.equal(GetTodayQueryParams.parse({}).day_offset, 0);
  assert.equal(GetTodayQueryParams.parse({ day_offset: 1 }).day_offset, 1);
  for (const day_offset of [-1, 2, 0.5]) assert.equal(GetTodayQueryParams.safeParse({ day_offset }).success, false);
});
