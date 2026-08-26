import { useCallback, useMemo } from 'react';

import type { OutdoorWorkoutMode } from './model';
import type { OutdoorWorkoutTracking } from './outdoor-workout-tracking.types';

/** Web 预览不声称能记录原生 GPS；真机由 .native.ts 实现。 */
export function useOutdoorWorkoutTracking({
  enabled,
}: {
  enabled: boolean;
  mode: OutdoorWorkoutMode;
  recording: boolean;
}): OutdoorWorkoutTracking {
  const retry = useCallback(() => undefined, []);

  return useMemo(
    () => ({
      status: enabled ? ('unsupported' as const) : ('paused' as const),
      hasFix: false,
      message: enabled ? '请在 Android 或 iPhone 安装包中记录 GPS 路线' : '轨迹记录已暂停',
      routeSegments: [],
      distanceMeters: 0,
      action: null,
      retry,
    }),
    [enabled, retry],
  );
}
