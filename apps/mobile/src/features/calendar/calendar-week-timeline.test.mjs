import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWeekTimeline, buildWeekTimelineBlocks } from './calendar-week-timeline.ts';
import { formatMinuteDateTime } from '../../utils/date-time.ts';

const cells = [
  { date: '2026-08-30' },
  { date: '2026-08-31' },
  { date: '2026-09-01' },
  { date: '2026-09-02' },
  { date: '2026-09-03' },
  { date: '2026-09-04' },
  { date: '2026-09-05' },
];

function day(date, events = [], tasks = []) {
  return { date, events, tasks };
}

function event(id, title, startAt, endAt) {
  return {
    id,
    title,
    event_kind: 'schedule',
    all_day: false,
    start_at: startAt,
    end_at: endAt,
    timezone: 'UTC',
    recurrence: 'none',
  };
}

test('跨午夜日程会切分到相邻日期列，时间只显示到分钟', () => {
  const days = new Map([
    ['2026-09-03', day('2026-09-03', [event('evt_1', '跨午夜发布', '2026-09-03T15:30:20Z', '2026-09-04T01:00:45Z')])],
  ]);
  const timeline = buildWeekTimeline(cells, days, 'UTC');

  assert.deepEqual(timeline.timed.map(item => ({
    date: item.date,
    start: item.startMinute,
    end: item.endMinute,
    label: item.timeLabel,
  })), [
    { date: '2026-09-03', start: 930, end: 1440, label: '15:30–24:00' },
    { date: '2026-09-04', start: 0, end: 60, label: '00:00–01:00' },
  ]);
});

test('重叠事项使用稳定分栏，后续不重叠事项可复用列', () => {
  const days = new Map([
    ['2026-09-03', day('2026-09-03', [
      event('evt_1', '方案评审', '2026-09-03T09:00:00Z', '2026-09-03T11:00:00Z'),
      event('evt_2', '客户电话', '2026-09-03T09:30:00Z', '2026-09-03T10:00:00Z'),
      event('evt_3', '设计同步', '2026-09-03T10:00:00Z', '2026-09-03T12:00:00Z'),
    ])],
  ]);
  const timeline = buildWeekTimeline(cells, days, 'UTC');
  const byID = new Map(timeline.timed.map(item => [item.id, item]));

  assert.equal(byID.get('evt_1').column, 0);
  assert.equal(byID.get('evt_2').column, 1);
  assert.equal(byID.get('evt_3').column, 1);
  assert.equal(byID.get('evt_1').columnCount, 2);
  assert.equal(byID.get('evt_3').columnCount, 2);
});

test('全天日程和无时刻待办进入全天带，指定时区决定布局分钟', () => {
  const allDayEvent = {
    id: 'evt_all', title: '团建', event_kind: 'schedule', all_day: true,
    start_date: '2026-09-03', end_date: '2026-09-04', timezone: 'Asia/Shanghai', recurrence: 'none',
  };
  const timedEvent = event('evt_time', '早餐', '2026-09-03T00:15:00Z', '2026-09-03T01:00:00Z');
  const task = { id: 'tsk_1', title: '交材料', due_date: '2026-09-04' };
  const timedTask = { id: 'tsk_2', title: '提交提醒', due_at: '2026-09-04T02:05:38Z' };
  const days = new Map([
    ['2026-09-03', day('2026-09-03', [allDayEvent, timedEvent])],
    ['2026-09-04', day('2026-09-04', [], [task, timedTask])],
  ]);
  const timeline = buildWeekTimeline(cells, days, 'Asia/Shanghai');

  assert.deepEqual(timeline.allDay.map(item => `${item.id}:${item.date}`), [
    'evt_all:2026-09-03',
    'evt_all:2026-09-04',
    'tsk_1:2026-09-04',
  ]);
  assert.equal(timeline.timed.find(item => item.id === 'evt_time').startMinute, 8 * 60 + 15);
  assert.equal(timeline.timed.find(item => item.id === 'tsk_2').timeLabel, '10:05');
  assert.equal(formatMinuteDateTime('2026-09-03T07:00:59Z', 'Asia/Shanghai'), '2026/9/3 15:00');
});

test('多日定时日程进入跨天横条，续日详情保留原实体和准确时间', () => {
  const trip = event('trip', '出差', '2026-09-02T08:00:00Z', '2026-09-04T18:00:00Z');
  const days = new Map([['2026-09-02', day('2026-09-02', [trip])]]);
  const timeline = buildWeekTimeline(cells, days, 'UTC');
  assert.equal(timeline.timed.length, 0);
  assert.equal(timeline.allDay.length, 0);
  assert.deepEqual(timeline.spanning[0], {
    id: 'trip', type: 'event', title: '出差', dayIndex: 3, daySpan: 3, row: 0,
    timeLabel: '2026/9/2 08:00 至 2026/9/4 18:00',
  });
  assert.equal(timeline.agendaByDate.get('2026-09-03').events[0], trip);
  assert.equal(timeline.agendaByDate.get('2026-09-05').events.length, 0);
  assert.equal(trip.all_day, false);
  assert.equal(timeline.initialMinute, 480);
});

test('跨天横条午夜结束不占次日，重叠横条分行，任务同样可读', () => {
  const task = { id: 'task', title: '准备材料', scheduled_start_at: '2026-09-02T00:00:00Z', scheduled_end_at: '2026-09-04T00:00:00Z' };
  const days = new Map([
    ['2026-09-02', day('2026-09-02', [event('trip', '差旅', '2026-09-02T08:00:00Z', '2026-09-04T18:00:00Z')], [task])],
    ['2026-09-03', day('2026-09-03', [], [task])],
  ]);
  const timeline = buildWeekTimeline(cells, days, 'UTC');
  assert.equal(timeline.spanning.find(item => item.id === 'task').daySpan, 2);
  assert.equal(timeline.spanning.find(item => item.id === 'task').row, 1);
  assert.equal(timeline.agendaByDate.get('2026-09-03').tasks.length, 1);
  assert.equal(timeline.agendaByDate.get('2026-09-04').tasks.length, 0);
});

test('短跨午夜保留时间轴但不将首屏定位到凌晨，当天长日程不截短', () => {
  const days = new Map([['2026-09-03', day('2026-09-03', [
    event('night', '夜间会议', '2026-09-03T23:00:00Z', '2026-09-04T01:00:00Z'),
    event('long', '培训', '2026-09-03T08:00:00Z', '2026-09-03T20:00:00Z'),
  ])]]);
  const timeline = buildWeekTimeline(cells, days, 'UTC');
  assert.equal(timeline.spanning.length, 0);
  assert.equal(timeline.timed.filter(item => item.id === 'night').length, 2);
  assert.equal(timeline.agendaByDate.get('2026-09-04').events[0].id, 'night');
  assert.equal(timeline.timed.find(item => item.id === 'long').endMinute, 1200);
  assert.equal(timeline.initialMinute, 480);
});

test('窄列重叠簇聚合且保留全部入口，宽列并排，不重叠事项不聚合', () => {
  const days = new Map([['2026-09-03', day('2026-09-03', [
    event('a', '会议一', '2026-09-03T09:00:00Z', '2026-09-03T11:00:00Z'),
    event('b', '会议二', '2026-09-03T10:00:00Z', '2026-09-03T12:00:00Z'),
    event('c', '下午安排', '2026-09-03T14:00:00Z', '2026-09-03T15:00:00Z'),
  ])]]);
  const { timed } = buildWeekTimeline(cells, days, 'UTC');
  const narrow = buildWeekTimelineBlocks(timed, 48);
  assert.deepEqual(narrow.map(block => block.items.map(item => item.id)), [['a', 'b'], ['c']]);
  assert.equal(narrow[0].startMinute, 540);
  assert.equal(narrow[0].endMinute, 720);
  const wide = buildWeekTimelineBlocks(timed, 100);
  assert.equal(wide.length, 3);
  assert.equal(wide[0].columnCount, 2);
  assert.equal(wide[1].column, 1);
});
