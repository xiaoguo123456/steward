import { useMemo } from 'react';

import {
  numberOf,
  textOf,
  useBuiltinTracker,
} from '@/features/trackers/use-builtin-tracker';
import { formatRelativeTime } from '@/utils/format';

import type { WorkoutHistoryItem } from './workout-content';
import { getWorkoutMode, type WorkoutMode } from './model';

/**
 * 运动历史。
 *
 * 运动记录就是内置「运动」Tracker 下的 Record。打卡首页不重复展示，
 * 复盘与统计仍读取同一份数据，不存在第二份运动数据。
 */
export function useWorkoutHistory(limit = 20) {
  const workout = useBuiltinTracker('workout', { limit });

  const items = useMemo<WorkoutHistoryItem[]>(
    () =>
      workout.records.map((row) => {
        const mode = getWorkoutMode(textOf(row, 'mode'));
        const distance = numberOf(row, 'distance_km');
        const steps = numberOf(row, 'steps');
        const minutes = numberOf(row, 'duration_min') ?? 0;
        return {
          id: row.id,
          mode,
          title: modeTitles[mode],
          date: formatRelativeTime(row.timestamp),
          primary: distance !== undefined ? `${distance.toFixed(2)} 公里` : `${minutes} 分钟`,
          secondary: steps !== undefined ? `${steps} 步` : modeTitles[mode],
          duration: formatDuration(minutes),
        };
      }),
    [workout.records],
  );

  return { items, loading: workout.loading };
}

const modeTitles: Record<WorkoutMode, string> = {
  running: '户外跑步',
  walking: '健走',
  cycling: '骑行',
  strength: '力量训练',
};

/** 记录只存到分钟：秒级精度对「这周练了多久」没有意义。 */
function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours > 0) return `${hours}:${String(rest).padStart(2, '0')}`;
  return `${rest} 分钟`;
}
