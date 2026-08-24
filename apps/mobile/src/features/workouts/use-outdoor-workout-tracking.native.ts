import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { OutdoorWorkoutMode } from './model';
import type { OutdoorWorkoutTracking } from './outdoor-workout-tracking.types';
import {
  evaluateRoutePoint,
  type WorkoutRoutePoint,
} from './workout-location';

const INITIAL_STATE: Omit<OutdoorWorkoutTracking, 'retry'> = {
  status: 'requesting',
  message: '正在请求定位权限…',
  routeSegments: [],
  distanceMeters: 0,
  action: null,
};

/** 只在运动页前台且处于记录状态时订阅定位。 */
export function useOutdoorWorkoutTracking({
  enabled,
  mode,
}: {
  enabled: boolean;
  mode: OutdoorWorkoutMode;
}): OutdoorWorkoutTracking {
  const [snapshot, setSnapshot] = useState(INITIAL_STATE);
  const [attempt, setAttempt] = useState(0);
  const routeSegmentsRef = useRef<WorkoutRoutePoint[][]>([]);
  const distanceMetersRef = useRef(0);
  const previousPointRef = useRef<WorkoutRoutePoint | undefined>(undefined);
  const hasStartedRef = useRef(false);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | undefined;

    if (!enabled) {
      previousPointRef.current = undefined;
      return undefined;
    }

    const publishStatus = (
      status: OutdoorWorkoutTracking['status'],
      message: string,
      action: OutdoorWorkoutTracking['action'] = null,
    ) => {
      if (cancelled) return;
      setSnapshot((current) => ({ ...current, status, message, action }));
    };

    const start = async () => {
      publishStatus('requesting', '正在检查定位权限…');

      try {
        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (cancelled) return;
        if (!servicesEnabled) {
          publishStatus('services-disabled', '系统定位尚未开启', 'settings');
          return;
        }

        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) {
          permission = await Location.requestForegroundPermissionsAsync();
        }
        if (cancelled) return;
        if (!permission.granted) {
          publishStatus(
            'permission-denied',
            '没有定位权限，暂不记录路线和距离',
            permission.canAskAgain ? 'retry' : 'settings',
          );
          return;
        }

        publishStatus('locating', '正在寻找 GPS 信号…');
        const nextSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: 3,
            timeInterval: 1000,
            mayShowUserSettingsDialog: true,
          },
          (location) => {
            if (cancelled) return;

            const point: WorkoutRoutePoint = {
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              timestamp: location.timestamp,
              accuracy: location.coords.accuracy,
              speed: location.coords.speed,
            };
            const accuracyMeters =
              point.accuracy === null ? undefined : Math.max(0, Math.round(point.accuracy));
            const decision = evaluateRoutePoint(previousPointRef.current, point, mode);

            if (decision.kind === 'ignore') {
              setSnapshot((current) => ({
                ...current,
                accuracyMeters,
                message:
                  decision.reason === 'accuracy' && !hasStartedRef.current
                    ? 'GPS 信号较弱，正在继续定位…'
                    : current.message,
              }));
              return;
            }

            const shouldStartSegment =
              decision.kind === 'new-segment' || previousPointRef.current === undefined;
            if (shouldStartSegment) {
              routeSegmentsRef.current = [...routeSegmentsRef.current, [point]];
            } else {
              const currentSegments = routeSegmentsRef.current;
              const lastIndex = currentSegments.length - 1;
              const lastSegment = currentSegments[lastIndex] ?? [];
              routeSegmentsRef.current = [
                ...currentSegments.slice(0, lastIndex),
                [...lastSegment, point],
              ];
              distanceMetersRef.current += decision.distanceMeters;
            }

            previousPointRef.current = point;
            hasStartedRef.current = true;
            setSnapshot({
              status: 'tracking',
              message:
                accuracyMeters === undefined
                  ? 'GPS 已连接'
                  : `GPS 已连接 · 精度约 ${accuracyMeters} 米`,
              routeSegments: routeSegmentsRef.current,
              currentPoint: point,
              distanceMeters: distanceMetersRef.current,
              accuracyMeters,
              action: null,
            });
          },
          () => publishStatus('error', '定位暂时不可用，请稍后重试', 'retry'),
        );
        if (cancelled) {
          nextSubscription.remove();
          return;
        }
        subscription = nextSubscription;
      } catch {
        publishStatus('error', '定位暂时不可用，请稍后重试', 'retry');
      }
    };

    void start();

    return () => {
      cancelled = true;
      subscription?.remove();
      previousPointRef.current = undefined;
    };
  }, [attempt, enabled, mode]);

  if (!enabled) {
    return {
      ...snapshot,
      status: 'paused',
      message: '轨迹记录已暂停',
      action: null,
      retry,
    };
  }

  return { ...snapshot, retry };
}
