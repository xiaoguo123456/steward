import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  distanceBetweenPoints,
  evaluateRoutePoint,
  formatAveragePace,
  formatAverageSpeed,
  formatDistanceKilometers,
} from './workout-location.ts';

function point(overrides = {}) {
  return {
    latitude: 39.9042,
    longitude: 116.4074,
    timestamp: 1_000,
    accuracy: 8,
    speed: null,
    ...overrides,
  };
}

test('大圆距离计算保持米级合理精度', () => {
  const meters = distanceBetweenPoints(
    point({ latitude: 0, longitude: 0 }),
    point({ latitude: 0.001, longitude: 0 }),
  );

  assert.ok(meters > 111 && meters < 112);
});

test('首个有效定位点开启路线线段', () => {
  assert.deepEqual(evaluateRoutePoint(undefined, point(), 'running'), {
    kind: 'new-segment',
    distanceMeters: 0,
  });
});

test('过滤低精度、原地漂移和不可能的瞬移', () => {
  const previous = point();

  assert.equal(
    evaluateRoutePoint(previous, point({ accuracy: 80, timestamp: 2_000 }), 'running').kind,
    'ignore',
  );
  assert.equal(
    evaluateRoutePoint(
      previous,
      point({ longitude: 116.407405, timestamp: 3_000 }),
      'running',
    ).kind,
    'ignore',
  );
  assert.deepEqual(
    evaluateRoutePoint(
      previous,
      point({ longitude: 116.4084, timestamp: 2_000 }),
      'running',
    ),
    { kind: 'ignore', reason: 'speed' },
  );
});

test('暂停或后台断档后开启新线段且不累加直线距离', () => {
  const decision = evaluateRoutePoint(
    point(),
    point({ longitude: 116.4084, timestamp: 32_000 }),
    'running',
  );

  assert.deepEqual(decision, { kind: 'new-segment', distanceMeters: 0 });
});

test('距离、平均配速与骑行均速格式化', () => {
  assert.equal(formatDistanceKilometers(5_240), '5.24');
  assert.equal(formatAveragePace(1_500, 5_000), `5'00\"`);
  assert.equal(formatAveragePace(10, 20), `--'--\"`);
  assert.equal(formatAverageSpeed(1_800, 10_000), '20.0');
});
