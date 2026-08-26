import type { WorkoutRoutePoint } from './workout-location';

export type OutdoorTrackingStatus =
  | 'requesting'
  | 'locating'
  | 'tracking'
  | 'paused'
  | 'permission-denied'
  | 'services-disabled'
  | 'error'
  | 'unsupported';

export type OutdoorWorkoutTracking = {
  status: OutdoorTrackingStatus;
  hasFix: boolean;
  message: string;
  routeSegments: WorkoutRoutePoint[][];
  currentPoint?: WorkoutRoutePoint;
  distanceMeters: number;
  accuracyMeters?: number;
  action: 'retry' | 'settings' | null;
  retry: () => void;
};
