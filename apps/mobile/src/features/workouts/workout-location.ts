export type WorkoutTravelMode = 'running' | 'walking' | 'cycling';

export type WorkoutRoutePoint = {
  latitude: number;
  longitude: number;
  timestamp: number;
  accuracy: number | null;
  speed: number | null;
};

export type RoutePointDecision =
  | { kind: 'accept'; distanceMeters: number }
  | { kind: 'new-segment'; distanceMeters: 0 }
  | { kind: 'ignore'; reason: 'accuracy' | 'invalid' | 'jitter' | 'speed' | 'timestamp' };

const EARTH_RADIUS_METERS = 6_371_008.8;
const MAX_HORIZONTAL_ACCURACY_METERS = 50;
const MIN_RECORDED_DISTANCE_METERS = 2;
const MAX_POINT_GAP_MS = 30_000;

const MAX_SPEED_METERS_PER_SECOND: Record<WorkoutTravelMode, number> = {
  walking: 7,
  running: 12,
  cycling: 35,
};

/** 计算两个 WGS84 坐标间的大圆距离。 */
export function distanceBetweenPoints(
  first: Pick<WorkoutRoutePoint, 'latitude' | 'longitude'>,
  second: Pick<WorkoutRoutePoint, 'latitude' | 'longitude'>,
): number {
  const latitudeDelta = degreesToRadians(second.latitude - first.latitude);
  const longitudeDelta = degreesToRadians(second.longitude - first.longitude);
  const firstLatitude = degreesToRadians(first.latitude);
  const secondLatitude = degreesToRadians(second.latitude);
  const halfLatitude = Math.sin(latitudeDelta / 2);
  const halfLongitude = Math.sin(longitudeDelta / 2);
  const a =
    halfLatitude * halfLatitude +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * halfLongitude * halfLongitude;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 过滤精度不足、原地漂移和不可能的瞬移点；长时间断档后开启新线段，
 * 避免暂停或切到后台后用一条直线把两处位置错误连接起来。
 */
export function evaluateRoutePoint(
  previous: WorkoutRoutePoint | undefined,
  next: WorkoutRoutePoint,
  mode: WorkoutTravelMode,
): RoutePointDecision {
  if (!isValidRoutePoint(next)) return { kind: 'ignore', reason: 'invalid' };
  if (next.accuracy === null || next.accuracy > MAX_HORIZONTAL_ACCURACY_METERS) {
    return { kind: 'ignore', reason: 'accuracy' };
  }
  if (!previous) return { kind: 'new-segment', distanceMeters: 0 };

  const elapsedMs = next.timestamp - previous.timestamp;
  if (elapsedMs <= 0) return { kind: 'ignore', reason: 'timestamp' };
  if (elapsedMs > MAX_POINT_GAP_MS) return { kind: 'new-segment', distanceMeters: 0 };

  const distanceMeters = distanceBetweenPoints(previous, next);
  if (distanceMeters < MIN_RECORDED_DISTANCE_METERS) {
    return { kind: 'ignore', reason: 'jitter' };
  }

  const calculatedSpeed = distanceMeters / (elapsedMs / 1000);
  if (calculatedSpeed > MAX_SPEED_METERS_PER_SECOND[mode]) {
    return { kind: 'ignore', reason: 'speed' };
  }

  return { kind: 'accept', distanceMeters };
}

export function formatDistanceKilometers(distanceMeters: number): string {
  return (Math.max(0, distanceMeters) / 1000).toFixed(2);
}

export function averagePaceSecondsPerKilometer(
  elapsedSeconds: number,
  distanceMeters: number,
): number | undefined {
  if (elapsedSeconds <= 0 || distanceMeters < 50) return undefined;
  return elapsedSeconds / (distanceMeters / 1000);
}

export function formatAveragePace(elapsedSeconds: number, distanceMeters: number): string {
  const pace = averagePaceSecondsPerKilometer(elapsedSeconds, distanceMeters);
  if (pace === undefined || !Number.isFinite(pace)) return `--'--\"`;

  const rounded = Math.max(0, Math.round(pace));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}'${String(seconds).padStart(2, '0')}\"`;
}

export function formatAverageSpeed(elapsedSeconds: number, distanceMeters: number): string {
  if (elapsedSeconds <= 0 || distanceMeters < 50) return '--.-';
  const kilometersPerHour = (distanceMeters / 1000) / (elapsedSeconds / 3600);
  return Number.isFinite(kilometersPerHour) ? kilometersPerHour.toFixed(1) : '--.-';
}

function isValidRoutePoint(point: WorkoutRoutePoint): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Number.isFinite(point.timestamp) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}
