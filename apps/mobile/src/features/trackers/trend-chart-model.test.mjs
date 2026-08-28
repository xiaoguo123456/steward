import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTrendScale,
  getDateLabelIndexes,
  selectTrendPoints,
} from './trend-chart-model.ts';

const field = {
  key: 'weight',
  label: '体重',
  type: 'number',
  required: true,
  unit: 'kg',
};

function record(id, timestamp, value) {
  return {
    id,
    timestamp,
    values: [{ key: 'weight', number_value: value }],
  };
}

test('趋势数据保留 Record 粒度，按范围过滤并按发生时间升序排列', () => {
  const now = Date.parse('2026-08-28T12:00:00+08:00');
  const points = selectTrendPoints(
    [
      record('new', '2026-08-28T08:00:00+08:00', 72.1),
      record('old', '2026-08-20T08:00:00+08:00', 73),
      record('middle', '2026-08-25T08:00:00+08:00', 72.6),
      record('zero', '2026-08-26T08:00:00+08:00', 0),
    ],
    field,
    'week',
    now,
  );

  assert.deepEqual(
    points.map((point) => [point.id, point.value]),
    [
      ['middle', 72.6],
      ['zero', 0],
      ['new', 72.1],
    ],
  );
});

test('趋势数据忽略文本值、无效时间与非有限数值', () => {
  const now = Date.parse('2026-08-28T12:00:00+08:00');
  const points = selectTrendPoints(
    [
      {
        id: 'text',
        timestamp: '2026-08-27T08:00:00+08:00',
        values: [{ key: 'weight', text_value: '七十二' }],
      },
      record('invalid-date', 'not-a-date', 72),
      record('infinite', '2026-08-27T08:00:00+08:00', Number.POSITIVE_INFINITY),
    ],
    field,
    'month',
    now,
  );

  assert.deepEqual(points, []);
});

test('正数和负数序列都包含零基线，跨零序列保持正确方向', () => {
  const positive = createTrendScale([2, 8]);
  assert.equal(positive.zeroPosition, 1);
  assert.ok(positive.positionOf(8) < positive.positionOf(2));

  const negative = createTrendScale([-8, -2]);
  assert.equal(negative.zeroPosition, 0);
  assert.ok(negative.positionOf(-2) < negative.positionOf(-8));

  const mixed = createTrendScale([-4, 6]);
  assert.ok(mixed.zeroPosition > 0 && mixed.zeroPosition < 1);
  assert.ok(mixed.positionOf(6) < mixed.zeroPosition);
  assert.ok(mixed.positionOf(-4) > mixed.zeroPosition);
});

test('全零序列仍生成有限刻度和位于底部的零值', () => {
  const scale = createTrendScale([0, 0]);

  assert.equal(scale.minimum, 0);
  assert.equal(scale.maximum, 0);
  assert.equal(scale.zeroPosition, 1);
  assert.ok(scale.ticks.every((tick) => Number.isFinite(tick.position)));
});

test('月视图减少日期密度并保留首尾，周视图逐条标注', () => {
  const points = Array.from({ length: 8 }, (_, index) => ({
    id: String(index),
    timestamp: `2026-08-${String(20 + index).padStart(2, '0')}T08:00:00+08:00`,
    value: index,
  }));

  assert.deepEqual([...getDateLabelIndexes(points, 'week')], [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual([...getDateLabelIndexes(points, 'month')], [0, 7, 2, 4, 6]);
});
