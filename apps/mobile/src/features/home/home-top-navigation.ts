export type HomeTopTabId = 'today' | 'memories' | 'relationships' | 'footprints' | 'mood';

export type PlannedHomeTopTabId = Exclude<HomeTopTabId, 'today' | 'memories' | 'mood'>;

export const HOME_TOP_TABS: readonly { id: HomeTopTabId; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'memories', label: '时光' },
  { id: 'relationships', label: '亲友' },
  { id: 'footprints', label: '足迹' },
  { id: 'mood', label: '心情' },
];

export const HOME_FEATURE_PREVIEWS: Record<
  PlannedHomeTopTabId,
  { title: string; message: string }
> = {
  relationships: {
    title: '亲友正在准备',
    message: '以后可以在这里整理重要的人、共同经历与关心提醒；当前不会读取通讯录、保存人物资料或调用 AI。',
  },
  footprints: {
    title: '足迹正在准备',
    message: '以后可以在这里查看旅行地图与城市故事；当前不会申请定位或读取位置。',
  },
};
