import type { OutdoorTrackingStatus } from '../outdoor-workout-tracking.types';
import type { WorkoutRoutePoint } from '../workout-location';

export type RouteMapProps = {
  routeSegments: WorkoutRoutePoint[][];
  currentPoint?: WorkoutRoutePoint;
  distanceMeters: number;
  trackingStatus: OutdoorTrackingStatus;
  statusMessage: string;
  locationMessageBottomInset?: number;
  actionLabel?: string;
  onAction?: () => void;
};
