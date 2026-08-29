import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyConflictChoice,
  initialCandidateSelection,
  unresolvedCandidateFields,
  updateCandidateField,
  updateRecordCandidateValue,
} from './capture-confirmation-model.ts';

test('服务端未默认勾选的候选仍可由用户主动选择', () => {
  const selection = initialCandidateSelection([
    { id: 'a', candidate_type: 'task', action: 'create', selected: true, payload: { task: { title: 'A' } } },
    { id: 'b', candidate_type: 'note', action: 'create', selected: false, payload: { note: { content: '' } } },
  ]);
  assert.deepEqual(selection, { a: true, b: false });
  selection.b = true;
  assert.equal(selection.b, true);
});

test('用户补齐缺失字段后允许确认，删空必填字段会重新阻塞', () => {
  const candidate = {
    id: 'task-1',
    candidate_type: 'task',
    action: 'create',
    selected: false,
    payload: { task: { title: '', due_date: null } },
    missing_fields: ['title', 'due_date'],
  };
  let payload = candidate.payload;
  assert.deepEqual(unresolvedCandidateFields(candidate, payload), ['title', 'due_date']);
  payload = updateCandidateField(payload, 'task', 'title', '提交材料');
  payload = updateCandidateField(payload, 'task', 'due_date', '2026-09-02');
  assert.deepEqual(unresolvedCandidateFields(candidate, payload), []);
});

test('行程安排的嵌套缺失字段可以在确认页补齐', () => {
  const candidate = {
    id: 'event-1',
    candidate_type: 'event',
    action: 'create',
    selected: false,
    payload: {
      event: {
        title: '高铁去上海',
        all_day: false,
        start_at: '2026-09-02T09:00:00+08:00',
        itinerary_details: {
          kind: 'transport',
          booking_status: 'ticketed',
          attachment_media_ids: [],
          origin: null,
          destination: '上海虹桥',
        },
      },
    },
    missing_fields: ['itinerary_details.origin'],
  };
  const payload = updateCandidateField(
    candidate.payload,
    'event',
    'itinerary_details.origin',
    '北京南',
  );
  assert.equal(payload.event.itinerary_details.origin, '北京南');
  assert.deepEqual(unresolvedCandidateFields(candidate, payload), []);
});

test('冲突选项和 Record 字段会写回确认 payload', () => {
  const task = applyConflictChoice(
    { task: { title: '开会', due_date: '2026-09-01' } },
    'task',
    'date',
    '2026-09-03',
  );
  assert.equal(task.changed, true);
  assert.equal(task.payload.task.due_date, '2026-09-03');

  const record = updateRecordCandidateValue(
    { record: { tracker_ref: 'trk_1', timestamp: '2026-08-29T10:00:00Z', values: [{ key: 'amount', number_value: 10 }] } },
    'amount',
    '28.5',
  );
  assert.equal(record.record.values[0].number_value, 28.5);

  const completed = updateRecordCandidateValue(
    {
      record: {
        tracker_ref: 'trk_1',
        timestamp: '2026-08-29T10:00:00Z',
        values: [{ key: 'direction' }],
      },
    },
    'direction',
    'expense',
    'text',
  );
  assert.equal(completed.record.values[0].text_value, 'expense');
});

test('Record 中尚未填写的字段会继续阻塞确认', () => {
  const candidate = {
    id: 'record-1',
    candidate_type: 'record',
    action: 'create',
    selected: false,
    payload: {
      record: {
        tracker_ref: 'trk_1',
        timestamp: '2026-08-29T10:00:00Z',
        values: [{ key: 'amount', number_value: 28.5 }, { key: 'category' }],
      },
    },
  };
  assert.deepEqual(unresolvedCandidateFields(candidate, candidate.payload), ['category']);
});
