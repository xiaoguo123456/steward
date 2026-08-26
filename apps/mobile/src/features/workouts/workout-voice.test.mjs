import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createKilometerAnnouncement,
  createWorkoutFinishAnnouncement,
  createWorkoutGoalAnnouncement,
  createWorkoutStartAnnouncement,
  formatSpokenDuration,
  parseWorkoutGoal,
} from './workout-voice.ts';

test('从准备页展示值解析距离与时长目标', () => {
  assert.deepEqual(parseWorkoutGoal('5.0 公里'), { kind: 'distance', meters: 5_000 });
  assert.deepEqual(parseWorkoutGoal('30 分钟'), { kind: 'duration', seconds: 1_800 });
  assert.equal(parseWorkoutGoal('自由跑'), undefined);
});

test('播报时间使用自然中文单位', () => {
  assert.equal(formatSpokenDuration(0), '0秒');
  assert.equal(formatSpokenDuration(370), '6分10秒');
  assert.equal(formatSpokenDuration(3_661), '1小时1分1秒');
});

test('跑步整公里播报包含距离、本公里配速和总用时', () => {
  assert.equal(
    createKilometerAnnouncement({
      completedKilometers: 2,
      elapsedSeconds: 750,
      kilometerSeconds: 380,
      mode: 'running',
    }),
    '已完成 2 公里。本公里配速 6分20秒，总用时 12分30秒。',
  );
});

test('骑行整公里播报使用平均速度', () => {
  assert.equal(
    createKilometerAnnouncement({
      completedKilometers: 10,
      elapsedSeconds: 1_800,
      kilometerSeconds: 180,
      mode: 'cycling',
    }),
    '已骑行 10 公里。总用时 30分，平均速度每小时 20.0 公里。',
  );
});

test('开始、目标和结束播报保持简短', () => {
  assert.equal(createWorkoutStartAnnouncement('walking'), 'GPS 信号已连接。三、二、一，开始健走。');
  assert.equal(
    createWorkoutGoalAnnouncement({ kind: 'distance', meters: 3_000 }),
    '距离目标已完成，可以继续运动。',
  );
  assert.equal(
    createWorkoutFinishAnnouncement({ distanceMeters: 3_120, elapsedSeconds: 1_205 }),
    '运动结束。本次运动 3.12 公里，用时 20分5秒。',
  );
});
