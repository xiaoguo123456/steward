import type { ComponentProps } from 'react';

import type { AppIcon } from '@/components/ui/icon';

/**
 * 力量训练动作库。
 *
 * 这是平台内容，不是用户数据：所有人看到同一份。全部为徒手动作——
 * 产品没有问过用户家里有什么器械，凭空假设有哑铃只会让人做不了。
 *
 * **每个动作都必须写常见错误。** 动作要领告诉人怎么做对，常见错误告诉人
 * 哪里会伤到自己，后者更重要：菜谱写错顶多难吃，深蹲膝盖内扣伤的是半月板，
 * 而且不是当场就疼，是练几周之后才疼——那时候用户根本不会把它和这个 App
 * 联系起来。
 *
 * 组数次数是**通用建议**，不是针对某个人的训练计划。界面上必须这么说。
 */

export type MuscleGroup = 'legs' | 'glutes' | 'chest' | 'back' | 'core' | 'shoulders';

export const muscleGroupLabels: Record<MuscleGroup, string> = {
  legs: '腿部',
  glutes: '臀部',
  chest: '胸部',
  back: '背部',
  core: '核心',
  shoulders: '肩部',
};

/**
 * 难度只分两档。
 *
 * 分更多档需要评估用户的实际水平，而这个产品没有任何依据去评估——
 * 硬分五档只是给一个猜测套上精确的外壳。
 */
export type ExerciseLevel = 'beginner' | 'intermediate';

export const levelLabels: Record<ExerciseLevel, string> = {
  beginner: '入门',
  intermediate: '进阶',
};

/**
 * 一组怎么算完。
 *
 * 计次和计时不能混：平板支撑写「3 组 × 10 次」是没有意义的，
 * 它按秒算。原来的模型只有 reps，所以库里根本放不下静态支撑类动作。
 */
export type ExerciseMeasure =
  | { kind: 'reps'; reps: number }
  | { kind: 'duration'; seconds: number };

export type StrengthExercise = {
  id: string;
  title: string;
  groups: MuscleGroup[];
  level: ExerciseLevel;
  /** 怎么做对。 */
  cue: string;
  /** 最常见的错误做法。写清楚会伤到哪里，不要只说「姿势不对」。 */
  mistake: string;
  /** 建议组数。通用建议，不是个人计划。 */
  sets: number;
  measure: ExerciseMeasure;
  /** 更轻的替代动作。做不了原动作时给一条退路，而不是让人硬撑。 */
  easierId?: string;
  icon: ComponentProps<typeof AppIcon>['name'];
};

export const strengthExercises: StrengthExercise[] = [
  // ---- 下肢 ----
  {
    id: 'squat',
    title: '深蹲',
    groups: ['legs', 'glutes'],
    level: 'beginner',
    cue: '双脚与肩同宽，臀部向后向下坐，膝盖朝脚尖方向，背部保持挺直。',
    mistake: '膝盖向内扣。这会让膝关节内侧长期受剪切力，是最常见的深蹲伤源——下蹲时有意把膝盖顶向脚尖方向。',
    sets: 3,
    measure: { kind: 'reps', reps: 12 },
    easierId: 'wall-sit',
    icon: 'body-outline',
  },
  {
    id: 'lunge',
    title: '弓步蹲',
    groups: ['legs', 'glutes'],
    level: 'beginner',
    cue: '一脚向前迈出一大步，后膝缓慢向地面靠近，上身保持直立。',
    mistake: '前脚步幅太小，导致膝盖远超脚尖、压力全压在膝关节上。迈得够大，让前小腿接近垂直。',
    sets: 3,
    measure: { kind: 'reps', reps: 10 },
    easierId: 'glute-bridge',
    icon: 'accessibility-outline',
  },
  {
    id: 'glute-bridge',
    title: '臀桥',
    groups: ['glutes', 'core'],
    level: 'beginner',
    cue: '仰卧屈膝，脚跟发力把髋部抬到身体成一条斜线，顶端收紧臀部。',
    mistake: '用腰去顶而不是用臀发力，抬得过高变成腰部后仰。抬到躯干与大腿成一条线就够了。',
    sets: 3,
    measure: { kind: 'reps', reps: 15 },
    icon: 'body-outline',
  },
  {
    id: 'wall-sit',
    title: '靠墙静蹲',
    groups: ['legs'],
    level: 'beginner',
    cue: '背贴墙下滑到大腿接近水平，膝盖不超过脚尖，正常呼吸。',
    mistake: '蹲得过低让膝角小于九十度，膝关节压力骤增。腿抖是正常的，疼就要停。',
    sets: 3,
    measure: { kind: 'duration', seconds: 30 },
    icon: 'body-outline',
  },
  {
    id: 'split-squat',
    title: '保加利亚分腿蹲',
    groups: ['legs', 'glutes'],
    level: 'intermediate',
    cue: '后脚搭在椅面上，重心放在前腿，垂直下蹲再起身。',
    mistake: '重心后压到后腿，变成拉伸而不是训练。前脚要踩实，感觉前侧臀腿在发力。',
    sets: 3,
    measure: { kind: 'reps', reps: 8 },
    easierId: 'lunge',
    icon: 'accessibility-outline',
  },

  // ---- 上肢 ----
  {
    id: 'push-up',
    title: '俯卧撑',
    groups: ['chest', 'shoulders', 'core'],
    level: 'beginner',
    cue: '手掌略宽于肩，收紧核心让身体成一条直线，缓慢下放到胸部接近地面。',
    mistake: '塌腰或撅臀。腰会代偿受力，做多了腰疼。撑不住一条直线时改做跪姿版本。',
    sets: 3,
    measure: { kind: 'reps', reps: 10 },
    easierId: 'knee-push-up',
    icon: 'fitness-outline',
  },
  {
    id: 'knee-push-up',
    title: '跪姿俯卧撑',
    groups: ['chest', 'shoulders'],
    level: 'beginner',
    cue: '膝盖着地，从膝到肩保持一条直线，其余同标准俯卧撑。',
    mistake: '把臀部坐向脚跟，变成只用手臂撑。躯干和大腿要保持一条线。',
    sets: 3,
    measure: { kind: 'reps', reps: 12 },
    icon: 'fitness-outline',
  },
  {
    id: 'pike-push-up',
    title: '派克俯卧撑',
    groups: ['shoulders', 'chest'],
    level: 'intermediate',
    cue: '臀部高抬成倒 V 形，屈肘让头顶接近地面，再推起。',
    mistake: '为了做到次数而耸肩、颈部前伸。宁可少做几个，也要让肩稳定发力。',
    sets: 3,
    measure: { kind: 'reps', reps: 8 },
    easierId: 'push-up',
    icon: 'fitness-outline',
  },
  {
    id: 'superman',
    title: '超人式',
    groups: ['back', 'glutes'],
    level: 'beginner',
    cue: '俯卧，同时抬起手臂与双腿，停一秒再放下，目光看向地面。',
    mistake: '仰头看前方。颈椎会跟着过度后仰，做完脖子发紧——全程下巴微收，脖子跟着躯干走。',
    sets: 3,
    measure: { kind: 'reps', reps: 12 },
    icon: 'body-outline',
  },
  {
    id: 'bird-dog',
    title: '鸟狗式',
    groups: ['back', 'core'],
    level: 'beginner',
    cue: '四点支撑，伸出一侧手臂与对侧腿到与躯干齐平，稳住再换边。',
    mistake: '腰部塌下去或身体左右摇晃。抬之前先收紧核心，宁可抬低一点也要稳。',
    sets: 3,
    measure: { kind: 'reps', reps: 10 },
    icon: 'accessibility-outline',
  },

  // ---- 核心 ----
  {
    id: 'plank',
    title: '平板支撑',
    groups: ['core', 'shoulders'],
    level: 'beginner',
    cue: '前臂支撑，收紧腹部与臀部，让身体成一条直线，正常呼吸。',
    mistake: '塌腰和憋气。塌腰会把负荷全转到腰椎；憋气会让血压升高。撑不住就停，不要靠塌腰续时间。',
    sets: 3,
    measure: { kind: 'duration', seconds: 30 },
    easierId: 'knee-plank',
    icon: 'body-outline',
  },
  {
    id: 'knee-plank',
    title: '跪姿平板支撑',
    groups: ['core'],
    level: 'beginner',
    cue: '膝盖着地的平板支撑，从膝到肩保持一条直线。',
    mistake: '同样是塌腰。位置更低不代表可以放松腹部。',
    sets: 3,
    measure: { kind: 'duration', seconds: 30 },
    icon: 'body-outline',
  },
  {
    id: 'dead-bug',
    title: '死虫式',
    groups: ['core'],
    level: 'beginner',
    cue: '仰卧，腰部贴紧地面，缓慢伸出一侧手臂与对侧腿，再收回换边。',
    mistake: '腰部离开地面拱起来。一旦拱起就说明超出了核心能控制的幅度，动作幅度要收小。',
    sets: 3,
    measure: { kind: 'reps', reps: 10 },
    icon: 'body-outline',
  },
  {
    id: 'side-plank',
    title: '侧平板支撑',
    groups: ['core'],
    level: 'intermediate',
    cue: '侧卧用前臂支撑，髋部抬起让身体成一条直线，两侧各做。',
    mistake: '髋部下沉或身体前后翻转。肩肘垂直、髋部主动上顶，撑不住就换跪姿。',
    sets: 2,
    measure: { kind: 'duration', seconds: 20 },
    easierId: 'plank',
    icon: 'body-outline',
  },
];

const byId = new Map(strengthExercises.map((item) => [item.id, item]));

export function getExercise(id: string): StrengthExercise | undefined {
  return byId.get(id);
}

/**
 * 训练计划：目标 → 具体练什么。
 *
 * 之前这四个目标是摆设——不管选哪个，练的都是同一套固定动作。
 * 选「上肢激活」却在做深蹲，比没有这个选项更糟。
 */
export type StrengthPlan = {
  id: string;
  label: string;
  /** 大致时长，界面上展示用。 */
  duration: string;
  summary: string;
  exerciseIds: string[];
};

export const strengthPlans: StrengthPlan[] = [
  {
    id: 'beginner',
    label: '全身入门',
    duration: '约 20 分钟',
    summary: '上下肢与核心各一部分，第一次练从这里开始。',
    exerciseIds: ['squat', 'knee-push-up', 'glute-bridge', 'plank'],
  },
  {
    id: 'upper',
    label: '上肢激活',
    duration: '约 18 分钟',
    summary: '胸、肩、背为主，配一个核心收尾。',
    exerciseIds: ['push-up', 'pike-push-up', 'superman', 'bird-dog'],
  },
  {
    id: 'lower',
    label: '下肢基础',
    duration: '约 20 分钟',
    summary: '腿和臀为主，最后加一组静态支撑。',
    exerciseIds: ['squat', 'lunge', 'glute-bridge', 'wall-sit'],
  },
  {
    id: 'core',
    label: '核心稳定',
    duration: '约 15 分钟',
    summary: '腹部与下背，动作幅度小但要稳。',
    exerciseIds: ['plank', 'dead-bug', 'bird-dog', 'side-plank'],
  },
];

export function getPlan(id: string | undefined): StrengthPlan {
  return strengthPlans.find((plan) => plan.id === id) ?? strengthPlans[0];
}

/** 一份计划里的动作。查不到的 id 直接跳过，不让界面崩在一个拼错的字符串上。 */
export function planExercises(plan: StrengthPlan): StrengthExercise[] {
  return plan.exerciseIds
    .map((id) => byId.get(id))
    .filter((item): item is StrengthExercise => Boolean(item));
}

/** 「3 组 × 12 次」或「3 组 × 30 秒」。 */
export function describeVolume(exercise: StrengthExercise): string {
  return `${exercise.sets} 组 × ${describeMeasure(exercise.measure)}`;
}

export function describeMeasure(measure: ExerciseMeasure): string {
  return measure.kind === 'reps' ? `${measure.reps} 次` : `${measure.seconds} 秒`;
}
