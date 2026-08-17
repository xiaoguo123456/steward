import type { ComponentProps } from 'react';

import { AppIcon } from '@/components/ui/icon';
import { colors } from '@/theme/tokens';

import type {
  OutdoorWorkoutMode,
  OutdoorWorkoutTarget,
  WorkoutGoal,
  WorkoutMode,
} from './model';

export type WorkoutModeDefinition = {
  id: WorkoutMode;
  label: string;
  cue: string;
  defaultGoal: string;
  detail: string;
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
    defaultGoal: '自由跑',
    detail: 'GPS 路线 · 实时配速',
  },
  {
    id: 'walking',
    label: '健走',
    cue: '轻松走，慢慢养成',
    defaultGoal: '自由走',
    detail: '步数 · 路线 · 时长',
  },
  {
    id: 'cycling',
    label: '骑行',
    cue: '记录速度与海拔',
    defaultGoal: '自由骑',
    detail: '速度 · 里程 · 海拔',
  },
  {
    id: 'strength',
    label: '力量训练',
    cue: '跟着动作完成每组',
    defaultGoal: '全身入门',
    detail: '6 个动作 · 约 25 分钟',
  },
];

export const outdoorWorkoutTargets: Record<OutdoorWorkoutMode, OutdoorWorkoutTarget[]> = {
  running: [
    {
      id: 'open',
      label: '自由',
      value: '自由跑',
      description: '不限距离和时长，按今天的状态结束',
    },
    {
      id: 'distance',
      label: '距离',
      unit: '公里',
      description: '达到目标后提醒你，也可以继续运动',
      defaultValue: 5,
      minimumValue: 0.5,
      maximumValue: 50,
      step: 0.5,
      presets: [3, 5, 10],
    },
    {
      id: 'duration',
      label: '时长',
      unit: '分钟',
      description: '按计划时长运动，结束前会语音提醒',
      defaultValue: 30,
      minimumValue: 5,
      maximumValue: 180,
      step: 5,
      presets: [20, 30, 45, 60],
    },
  ],
  walking: [
    {
      id: 'open',
      label: '自由',
      value: '自由走',
      description: '轻松走一走，不给今天增加压力',
    },
    {
      id: 'steps',
      label: '步数',
      unit: '步',
      description: '达到目标步数后提醒你，也可以继续走',
      defaultValue: 6000,
      minimumValue: 1000,
      maximumValue: 30000,
      step: 500,
      presets: [3000, 6000, 10000],
    },
    {
      id: 'distance',
      label: '距离',
      unit: '公里',
      description: '按距离养成稳定的健走习惯',
      defaultValue: 3,
      minimumValue: 0.5,
      maximumValue: 20,
      step: 0.5,
      presets: [1, 3, 5],
    },
    {
      id: 'duration',
      label: '时长',
      unit: '分钟',
      description: '达到目标时长后提醒你',
      defaultValue: 30,
      minimumValue: 5,
      maximumValue: 180,
      step: 5,
      presets: [20, 30, 45, 60],
    },
  ],
  cycling: [
    {
      id: 'open',
      label: '自由',
      value: '自由骑',
      description: '不限距离和时长，按路线自由骑行',
    },
    {
      id: 'distance',
      label: '距离',
      unit: '公里',
      description: '达到目标后提醒你，路线记录不会中断',
      defaultValue: 10,
      minimumValue: 1,
      maximumValue: 100,
      step: 1,
      presets: [10, 20, 30, 50],
    },
    {
      id: 'duration',
      label: '时长',
      unit: '分钟',
      description: '按计划时长骑行，结束前会提醒',
      defaultValue: 45,
      minimumValue: 10,
      maximumValue: 240,
      step: 5,
      presets: [30, 45, 60, 90],
    },
  ],
};

export const strengthWorkoutGoals: WorkoutGoal[] = [
  { id: 'beginner', label: '全身入门', value: '25 分钟' },
  { id: 'upper', label: '上肢激活', value: '20 分钟' },
  { id: 'lower', label: '下肢基础', value: '25 分钟' },
  { id: 'open', label: '自由训练', value: '自己安排' },
];

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

export const workoutAccent = {
  // 运动场景不维护独立的“运动系”中性色，统一继承首页视觉 Token。
  background: colors.background,
  ink: colors.text,
  muted: colors.textSecondary,
  hairline: colors.border,
  coral: colors.danger,
  coralSoft: '#FFF1EF',
  mapWater: '#DCEFFC',
  mapPark: '#DFF5E8',
  active: colors.primary,
} as const;
