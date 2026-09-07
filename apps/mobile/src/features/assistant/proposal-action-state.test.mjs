import assert from 'node:assert/strict';
import test from 'node:test';
import { proposalActionState } from './proposal-action-state.ts';

test('不足两条子任务时仍可拒绝，但不能确认', () => {
  assert.deepEqual(proposalActionState('task_split', false, [{ selected: true, title: '步骤' }]), {
    rejectDisabled: false, confirmDisabled: true,
  });
});
test('已选子任务的空标题必须修正，不能被提交过滤', () => {
  const tasks = ['收集', '整理', '  '].map((title) => ({ selected: true, title }));
  assert.equal(proposalActionState('task_split', false, tasks).confirmDisabled, true);
  tasks[2].selected = false;
  assert.equal(proposalActionState('task_split', false, tasks).confirmDisabled, false);
});
test('请求中禁用两个动作，普通建议无需子任务', () => {
  assert.deepEqual(proposalActionState('task_create', true, []), { rejectDisabled: true, confirmDisabled: true });
  assert.deepEqual(proposalActionState('task_create', false, []), { rejectDisabled: false, confirmDisabled: false });
});
