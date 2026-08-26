export const TASK_LIST_COLOR_TOKENS = [
  'green',
  'blue',
  'orange',
  'purple',
  'pink',
  'gray',
] as const;

export type TaskListColorToken = (typeof TASK_LIST_COLOR_TOKENS)[number];

export const TASK_LIST_ICON_OPTIONS = [
  { id: 'inbox', label: '收件箱' },
  { id: 'work', label: '工作' },
  { id: 'home', label: '家庭' },
  { id: 'study', label: '学习' },
  { id: 'health', label: '健康' },
  { id: 'sport', label: '运动' },
  { id: 'finance', label: '财务' },
  { id: 'travel', label: '出行' },
  { id: 'calendar', label: '日程' },
  { id: 'idea', label: '灵感' },
  { id: 'important', label: '重要' },
  { id: 'general', label: '通用' },
] as const;

export type TaskListIconId = (typeof TASK_LIST_ICON_OPTIONS)[number]['id'];

type TaskListAppearanceSource = {
  id?: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  is_default?: boolean;
};

const CUSTOM_COLOR_ORDER: TaskListColorToken[] = [
  'blue',
  'orange',
  'purple',
  'pink',
  'gray',
  'green',
];

const keywordRules: { icon: TaskListIconId; keywords: string[] }[] = [
  { icon: 'work', keywords: ['工作', '项目', '办公', 'work', 'office', 'project'] },
  { icon: 'home', keywords: ['家庭', '家务', '居家', '生活', 'home', 'family'] },
  { icon: 'study', keywords: ['学习', '读书', '阅读', '课程', 'study', 'book', 'learn'] },
  { icon: 'health', keywords: ['健康', '医疗', '体检', '看病', 'health', 'medical'] },
  { icon: 'sport', keywords: ['运动', '健身', '跑步', '训练', 'sport', 'fitness', 'run'] },
  { icon: 'finance', keywords: ['财务', '账单', '记账', '理财', '报销', 'finance', 'money', 'bill'] },
  { icon: 'travel', keywords: ['旅行', '行程', '出差', '出行', 'travel', 'trip'] },
  { icon: 'calendar', keywords: ['日程', '计划', '安排', '预约', 'calendar', 'schedule'] },
  { icon: 'idea', keywords: ['灵感', '想法', '创意', 'idea'] },
  { icon: 'important', keywords: ['重要', '收藏', '心愿', '愿望', 'favorite', 'star'] },
];

const iconIds = new Set<string>(TASK_LIST_ICON_OPTIONS.map((option) => option.id));
const colorTokens = new Set<string>(TASK_LIST_COLOR_TOKENS);

function stableIndex(value: string, length: number) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

export function isTaskListIconId(value: string | null | undefined): value is TaskListIconId {
  return Boolean(value && iconIds.has(value));
}

export function isTaskListColorToken(
  value: string | null | undefined,
): value is TaskListColorToken {
  return Boolean(value && colorTokens.has(value));
}

/** 名称推荐只负责初始值；用户手动选择后不再覆盖。 */
export function suggestTaskListIcon(name: string): TaskListIconId {
  const normalized = name.trim().toLocaleLowerCase();
  if (!normalized) return 'general';
  return keywordRules.find((rule) => rule.keywords.some((keyword) => normalized.includes(keyword)))
    ?.icon ?? 'general';
}

/** 兼容旧数据：缺少外观字段时仍使用稳定、可区分的图标与颜色。 */
export function resolveTaskListAppearance(list: TaskListAppearanceSource): {
  icon: TaskListIconId;
  color: TaskListColorToken;
} {
  return {
    icon: isTaskListIconId(list.icon)
      ? list.icon
      : (list.is_default ? 'inbox' : suggestTaskListIcon(list.name)),
    color: isTaskListColorToken(list.color)
      ? list.color
      : (list.is_default
          ? 'green'
          : CUSTOM_COLOR_ORDER[stableIndex(list.id ?? list.name, CUSTOM_COLOR_ORDER.length)]),
  };
}

/** 新清单优先取当前未使用的颜色，全部用过后再稳定轮换。 */
export function nextTaskListColor(lists: TaskListAppearanceSource[]): TaskListColorToken {
  const used = new Set(lists.map((list) => resolveTaskListAppearance(list).color));
  return CUSTOM_COLOR_ORDER.find((color) => !used.has(color))
    ?? CUSTOM_COLOR_ORDER[lists.length % CUSTOM_COLOR_ORDER.length];
}
