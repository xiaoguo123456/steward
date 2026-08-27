import assert from 'node:assert/strict';
import test from 'node:test';

import { filterTasksByProjectScope } from './project-task-scope.ts';

const projects = [
  { id: 'active-1', status: 'active' },
  { id: 'paused-1', status: 'paused' },
  { id: 'done-1', status: 'completed' },
];

const tasks = [
  { id: 'task-active', project_id: 'active-1' },
  { id: 'task-paused', project_id: 'paused-1' },
  { id: 'task-done', project_id: 'done-1' },
  { id: 'task-unassigned' },
];

test('全部状态保留有关联和未关联项目的任务', () => {
  assert.deepEqual(
    filterTasksByProjectScope(tasks, projects, { status: null, projectId: null }).map(({ id }) => id),
    tasks.map(({ id }) => id),
  );
});

test('项目状态直接筛选关联任务', () => {
  assert.deepEqual(
    filterTasksByProjectScope(tasks, projects, { status: 'paused', projectId: null }).map(({ id }) => id),
    ['task-paused'],
  );
});

test('具体项目优先于状态范围', () => {
  assert.deepEqual(
    filterTasksByProjectScope(tasks, projects, { status: 'active', projectId: 'done-1' }).map(({ id }) => id),
    ['task-done'],
  );
});

