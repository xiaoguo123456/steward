export const workoutModeValues = ['running', 'walking', 'cycling', 'strength'] as const;

export type WorkoutMode = (typeof workoutModeValues)[number];
export type OutdoorWorkoutMode = Exclude<WorkoutMode, 'strength'>;

export type WorkoutGoal = {
  id: string;
  label: string;
  value: string;
};

export type WorkoutTargetKind = 'open' | 'distance' | 'duration';

export type OpenWorkoutTarget = {
  id: 'open';
  label: string;
  value: string;
  description: string;
};

export type NumericWorkoutTarget = {
  id: Exclude<WorkoutTargetKind, 'open'>;
  label: string;
  unit: string;
  description: string;
  defaultValue: number;
  minimumValue: number;
  maximumValue: number;
  step: number;
  presets: number[];
};

export type OutdoorWorkoutTarget = OpenWorkoutTarget | NumericWorkoutTarget;

export function isWorkoutMode(value: string | undefined): value is WorkoutMode {
  return workoutModeValues.includes(value as WorkoutMode);
}
export function getWorkoutMode(value: string | undefined): WorkoutMode {
  return isWorkoutMode(value) ? value : 'running';
}

export function isOutdoorWorkoutMode(mode: WorkoutMode): mode is OutdoorWorkoutMode {
  return mode !== 'strength';
}

export function formatWorkoutDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const paddedMinutes = `${minutes}`.padStart(2, '0');
  const paddedSeconds = `${seconds}`.padStart(2, '0');

  return hours > 0
    ? `${`${hours}`.padStart(2, '0')}:${paddedMinutes}:${paddedSeconds}`
    : `${paddedMinutes}:${paddedSeconds}`;
}
