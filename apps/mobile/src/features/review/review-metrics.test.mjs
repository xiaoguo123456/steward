import assert from 'node:assert/strict';
import test from 'node:test';

import { groupReviewMetrics } from './review-metrics.ts';

test('复盘指标按任务三项与记录两项稳定分组', () => {
  const groups = groupReviewMetrics([
    { key: 'records_logged' },
    { key: 'tasks_overdue' },
    { key: 'notes_created' },
    { key: 'tasks_completed' },
    { key: 'tasks_created' },
  ]);

  assert.deepEqual(
    groups.map((group) => group.map((metric) => metric.key)),
    [
      ['tasks_completed', 'tasks_created', 'tasks_overdue'],
      ['notes_created', 'records_logged'],
    ],
  );
});

test('新增指标按每行最多三项保留在固定指标之后', () => {
  const groups = groupReviewMetrics([
    { key: 'tasks_completed' },
    { key: 'events_attended' },
    { key: 'projects_active' },
    { key: 'focus_sessions' },
    { key: 'habits_active' },
  ]);

  assert.deepEqual(
    groups.map((group) => group.map((metric) => metric.key)),
    [
      ['tasks_completed'],
      ['events_attended', 'projects_active', 'focus_sessions'],
      ['habits_active'],
    ],
  );
});
