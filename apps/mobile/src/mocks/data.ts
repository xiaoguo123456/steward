export type TaskItem = {
  id: string;
  title: string;
  list: string;
  time: string;
  color: string;
  priority?: 'high' | 'medium' | 'low';
  completed?: boolean;
};

export const todayTasks: TaskItem[] = [
  {
    id: 'requirements-review',
    title: '完成产品需求评审文档',
    list: '工作',
    time: '10:00',
    color: '#3B82F6',
    priority: 'high',
  },
  {
    id: 'reply-email',
    title: '回复客户邮件',
    list: '工作',
    time: '11:30',
    color: '#3B82F6',
    priority: 'medium',
  },
  {
    id: 'workout',
    title: '健身 30 分钟',
    list: '健康',
    time: '19:00',
    color: '#10B981',
    priority: 'medium',
  },
  {
    id: 'flight',
    title: '购买下周出差机票',
    list: '生活',
    time: '无时间',
    color: '#F59E0B',
    priority: 'low',
  },
  {
    id: 'reading',
    title: '阅读《设计心理学》30 分钟',
    list: '学习',
    time: '21:00',
    color: '#8B5CF6',
  },
];

export const tomorrowTasks: TaskItem[] = [
  {
    id: 'trip-materials',
    title: '准备出差资料',
    list: '工作',
    time: '09:00',
    color: '#3B82F6',
    priority: 'high',
  },
  {
    id: 'utility-bill',
    title: '缴纳水电费',
    list: '生活',
    time: '18:00',
    color: '#F59E0B',
    priority: 'medium',
  },
];

export const unscheduledTasks: TaskItem[] = [
  {
    id: 'expense-receipts',
    title: '整理出差报销凭证',
    list: '工作',
    time: '未安排',
    color: '#3B82F6',
    priority: 'medium',
  },
  {
    id: 'car-service',
    title: '预约汽车保养',
    list: '生活',
    time: '未安排',
    color: '#F59E0B',
  },
  {
    id: 'product-ideas',
    title: '补充产品灵感清单',
    list: '收集箱',
    time: '未安排',
    color: '#10B981',
  },
  {
    id: 'reading-list',
    title: '整理下个月阅读清单',
    list: '收集箱',
    time: '未安排',
    color: '#10B981',
  },
  {
    id: 'cat-litter',
    title: '购买猫砂',
    list: '购物清单',
    time: '未安排',
    color: '#8B5CF6',
    priority: 'low',
  },
];

export const completedTasks: TaskItem[] = [
  {
    id: 'morning-run',
    title: '晨跑 5 公里',
    list: '健康',
    time: '',
    color: '#10B981',
    completed: true,
  },
  {
    id: 'desk',
    title: '整理工作台',
    list: '生活',
    time: '',
    color: '#F59E0B',
    completed: true,
  },
];

export const nextAgenda = {
  id: 'product-review-meeting',
  title: '产品需求评审',
  time: '10:00 — 11:30',
  location: '3 号会议室',
  relativeTime: '45 分钟后',
};

export const dailyBrief = {
  title: '下午有一段完整空档',
  summary: '14:00 后有 90 分钟空闲，适合处理“购买下周出差机票”。',
  source: '根据今天的任务与日程',
};

export const notes = [
  {
    id: 'requirements-meeting',
    title: '产品需求评审会议纪要',
    summary: '讨论了首页改版、任务流优化和 AI 悬浮球交互，形成三条待办。',
    time: '今天 14:30',
    tag: '工作',
    color: '#3B82F6',
    background: '#DBEAFE',
  },
  {
    id: 'design-psychology',
    title: '读书笔记：《设计心理学》',
    summary: '第三章「可视性」讲到：好的设计要让用户一眼看懂如何操作。',
    time: '昨天 21:00',
    tag: '学习',
    color: '#8B5CF6',
    background: '#EDE9FE',
  },
  {
    id: 'dali-trip',
    title: '大理三日游行程',
    summary: 'Day1 洱海骑行 · Day2 苍山徒步 · Day3 古城闲逛，附住宿清单。',
    time: '6月15日',
    tag: '生活',
    color: '#F59E0B',
    background: '#FEF3C7',
  },
  {
    id: 'ai-details',
    title: '灵感：AI 助手的交互细节',
    summary: '悬浮球支持语音、图片输入，回复用未读角标提醒并保持轻量。',
    time: '6月12日',
    tag: '灵感',
    color: '#EC4899',
    background: '#FCE7F3',
  },
];
