import type { ComponentProps } from 'react';

import { AppIcon } from '@/components/ui/icon';
import { colors } from '@/theme/tokens';

import type { WorkoutGoal, WorkoutMode } from './model';

export type WorkoutModeDefinition = {
  id: WorkoutMode;
  label: string;
  cue: string;
  icon: ComponentProps<typeof AppIcon>['name'];
};

export type WorkoutHistoryItem = {
  id: string;
  mode: WorkoutMode;
  title: string;
  date: string;
  primary: string;
  secondary: string;
  duration: string;
};

export type StrengthExercise = {
  id: string;
  title: string;
  cue: string;
  sets: number;
  reps: number;
  icon: ComponentProps<typeof AppIcon>['name'];
};

export const workoutModes: WorkoutModeDefinition[] = [
  {
    id: 'running',
    label: '户外跑步',
    cue: '记录路线与配速',
    icon: 'walk',
  },
  {
    id: 'walking',
    label: '健走',
    cue: '轻松走，慢慢养成',
    icon: 'footsteps-outline',
  },
  {
    id: 'cycling',
    label: '骑行',
    cue: '记录速度与海拔',
    icon: 'bicycle-outline',
  },
  {
    id: 'strength',
    label: '力量训练',
    cue: '跟着动作完成每组',
    icon: 'barbell-outline',
  },
];

export const workoutGoals: Record<WorkoutMode, WorkoutGoal[]> = {
  running: [
    { id: 'open', label: '不限目标', value: '自由跑' },
    { id: 'distance-3', label: '距离', value: '3 公里' },
    { id: 'distance-5', label: '距离', value: '5 公里' },
    { id: 'time-30', label: '时间', value: '30 分钟' },
  ],
  walking: [
    { id: 'open', label: '不限目标', value: '自由走' },
    { id: 'steps-6000', label: '步数', value: '6000 步' },
    { id: 'time-30', label: '时间', value: '30 分钟' },
    { id: 'distance-3', label: '距离', value: '3 公里' },
  ],
  cycling: [
    { id: 'open', label: '不限目标', value: '自由骑' },
    { id: 'distance-10', label: '距离', value: '10 公里' },
    { id: 'time-45', label: '时间', value: '45 分钟' },
    { id: 'distance-20', label: '距离', value: '20 公里' },
  ],
  strength: [
    { id: 'beginner', label: '全身入门', value: '25 分钟' },
    { id: 'upper', label: '上肢激活', value: '20 分钟' },
    { id: 'lower', label: '下肢基础', value: '25 分钟' },
    { id: 'open', label: '自由训练', value: '自己安排' },
  ],
};

export const strengthExercises: StrengthExercise[] = [
  {
    id: 'squat',
    title: '深蹲',
    cue: '膝盖朝脚尖方向，保持背部挺直',
    sets: 3,
    reps: 12,
    icon: 'body-outline',
  },
  {
    id: 'push-up',
    title: '俯卧撑',
    cue: '身体保持一条直线，慢慢下放',
    sets: 3,
    reps: 10,
    icon: 'fitness-outline',
  },
  {
    id: 'lunge',
    title: '弓步蹲',
    cue: '前脚踩稳，后膝缓慢靠近地面',
    sets: 3,
    reps: 10,
    icon: 'accessibility-outline',
  },
  {
    id: 'bridge',
    title: '臀桥',
    cue: '收紧核心，把髋部抬到自然高度',
    sets: 3,
    reps: 12,
    icon: 'trending-up-outline',
  },
  {
    id: 'row',
    title: '俯身划船',
    cue: '肩胛向后收，手肘贴近身体',
    sets: 3,
    reps: 12,
    icon: 'barbell-outline',
  },
  {
    id: 'plank',
    title: '平板支撑',
    cue: '收紧腹部，不要塌腰',
    sets: 3,
    reps: 30,
    icon: 'remove-outline',
  },
];

export const recentWorkouts: WorkoutHistoryItem[] = [
  {
    id: 'run-0617',
    mode: 'running',
    title: '户外跑步',
    date: '昨天 19:24',
    primary: '3.26 公里',
    secondary: `平均配速 06'34\"`,
    duration: '21:26',
  },
  {
    id: 'strength-0615',
    mode: 'strength',
    title: '全身入门',
    date: '6月15日 20:10',
    primary: '6 个动作',
    secondary: '完成 17 组',
    duration: '27:08',
  },
  {
    id: 'walk-0613',
    mode: 'walking',
    title: '晚间健走',
    date: '6月13日 18:42',
    primary: '4.12 公里',
    secondary: '6218 步',
    duration: '48:16',
  },
  {
    id: 'cycle-0609',
    mode: 'cycling',
    title: '周末骑行',
    date: '6月9日 08:16',
    primary: '12.80 公里',
    secondary: '均速 18.4 km/h',
    duration: '41:44',
  },
  {
    id: 'run-0606',
    mode: 'running',
    title: '户外跑步',
    date: '6月6日 07:32',
    primary: '5.02 公里',
    secondary: `平均配速 06'18\"`,
    duration: '31:37',
  },
];

export const weeklyWorkoutDays = [
  { label: '一', state: 'done' },
  { label: '二', state: 'done' },
  { label: '三', state: 'current' },
  { label: '四', state: 'idle' },
  { label: '五', state: 'planned' },
  { label: '六', state: 'idle' },
  { label: '日', state: 'idle' },
] as const;

export const workoutAccent = {
  background: '#F7F9F7',
  ink: '#17201B',
  muted: '#66736C',
  hairline: '#E4EAE6',
  coral: '#F26B5E',
  coralSoft: '#FFF1EF',
  mapWater: '#DCEFFC',
  mapPark: '#DFF5E8',
  active: colors.primary,
} as const;
