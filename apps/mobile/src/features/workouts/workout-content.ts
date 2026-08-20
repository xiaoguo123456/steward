// 运动模块的界面内容与配色。
//
// 这里的东西不是假数据：四种运动方式、户外目标选项、配色都是产品内容，
// 和用户数据无关，所有人看到同一份。真正的运动记录是内置「运动」Tracker
// 下的 Record，见 use-workout-history.ts。
//
// 力量训练的动作库与训练计划在 strength-library.ts——它需要目标肌群、
// 难度、常见错误这些字段，和这里的界面配置不是一类东西。
//
// （这个文件原来叫 mock-data.ts，名字会让人以为里面是待替换的占位数据。）

import { colors } from '@/theme/tokens';

import type {
  OutdoorWorkoutMode,
  OutdoorWorkoutTarget,
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
