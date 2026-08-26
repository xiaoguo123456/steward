import type { OutdoorWorkoutMode } from './model';

export type WorkoutGoal =
  | { kind: 'distance'; meters: number }
  | { kind: 'duration'; seconds: number };

/** 将准备页的展示值还原为本次会话使用的确定性目标。 */
export function parseWorkoutGoal(value?: string): WorkoutGoal | undefined {
  if (!value) return undefined;

  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;

  if (value.includes('公里')) {
    return { kind: 'distance', meters: amount * 1000 };
  }
  if (value.includes('分钟')) {
    return { kind: 'duration', seconds: Math.round(amount * 60) };
  }
  return undefined;
}

export function createWorkoutStartAnnouncement(mode: OutdoorWorkoutMode): string {
  return `GPS 信号已连接。三、二、一，开始${workoutAction(mode)}。`;
}

export function createWorkoutPauseAnnouncement(): string {
  return '运动已暂停。';
}

export function createWorkoutResumeAnnouncement(): string {
  return '继续运动。';
}

export function createWorkoutGoalAnnouncement(goal: WorkoutGoal): string {
  return goal.kind === 'distance'
    ? '距离目标已完成，可以继续运动。'
    : '时长目标已完成，可以继续运动。';
}

export function createKilometerAnnouncement({
  completedKilometers,
  elapsedSeconds,
  kilometerSeconds,
  mode,
}: {
  completedKilometers: number;
  elapsedSeconds: number;
  kilometerSeconds: number;
  mode: OutdoorWorkoutMode;
}): string {
  const distance = `${Math.max(1, Math.floor(completedKilometers))} 公里`;
  const totalTime = formatSpokenDuration(elapsedSeconds);

  if (mode === 'cycling') {
    const averageSpeed = averageSpeedKilometersPerHour(elapsedSeconds, completedKilometers * 1000);
    return `已骑行 ${distance}。总用时 ${totalTime}，平均速度每小时 ${averageSpeed} 公里。`;
  }

  return `已完成 ${distance}。本公里配速 ${formatSpokenPace(kilometerSeconds)}，总用时 ${totalTime}。`;
}

export function createWorkoutFinishAnnouncement({
  distanceMeters,
  elapsedSeconds,
}: {
  distanceMeters: number;
  elapsedSeconds: number;
}): string {
  const duration = formatSpokenDuration(elapsedSeconds);
  if (distanceMeters < 50) {
    return `运动结束。本次运动用时 ${duration}。`;
  }

  const kilometers = (distanceMeters / 1000).toFixed(2);
  return `运动结束。本次运动 ${kilometers} 公里，用时 ${duration}。`;
}

export function formatSpokenDuration(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分`);
  if (remainder > 0 || parts.length === 0) parts.push(`${remainder}秒`);
  return parts.join('');
}

function formatSpokenPace(value: number): string {
  const seconds = Math.max(1, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}分` : `${minutes}分${remainder}秒`;
}

function averageSpeedKilometersPerHour(elapsedSeconds: number, distanceMeters: number): string {
  if (elapsedSeconds <= 0 || distanceMeters <= 0) return '0';
  return ((distanceMeters / 1000) / (elapsedSeconds / 3600)).toFixed(1);
}

function workoutAction(mode: OutdoorWorkoutMode): string {
  if (mode === 'cycling') return '骑行';
  if (mode === 'walking') return '健走';
  return '跑步';
}
