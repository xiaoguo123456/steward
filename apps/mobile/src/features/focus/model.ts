export type FocusMode = 'pomodoro' | 'stopwatch';

export type FocusQuality = 'smooth' | 'normal' | 'distracted';

export type FocusTaskReference = {
  id: string;
  title: string;
  list: string;
  color: string;
  time?: string;
  temporary?: boolean;
};

export type FocusThought = {
  id: string;
  content: string;
  capturedAtSeconds: number;
};

export type FocusRecord = {
  id: string;
  task: FocusTaskReference | null;
  mode: FocusMode;
  plannedSeconds?: number;
  elapsedSeconds: number;
  completedAt: string;
  taskCompleted: boolean;
  quality: FocusQuality | null;
  thoughts: FocusThought[];
};

export type NewFocusRecord = Omit<FocusRecord, 'id'>;

export function formatFocusClock(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}`;
}

export function formatFocusDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  if (safeSeconds < 60) return `${safeSeconds} 秒`;

  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours === 0) return `${minutes} 分钟`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分钟`;
}

export function isSameLocalDay(value: string, target = new Date()) {
  const date = new Date(value);
  return (
    date.getFullYear() === target.getFullYear() &&
    date.getMonth() === target.getMonth() &&
    date.getDate() === target.getDate()
  );
}
