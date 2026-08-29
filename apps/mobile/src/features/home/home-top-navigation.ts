export type HomeTopTabId = 'today' | 'memories' | 'music' | 'footprints' | 'mood';

export type PlannedHomeTopTabId = Exclude<HomeTopTabId, 'today' | 'mood'>;

export const HOME_TOP_TABS: readonly { id: HomeTopTabId; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'memories', label: '时光' },
  { id: 'music', label: '音乐' },
  { id: 'footprints', label: '足迹' },
  { id: 'mood', label: '心情' },
];

export const HOME_FEATURE_PREVIEWS: Record<
  PlannedHomeTopTabId,
  { title: string; message: string }
> = {
  memories: {
    title: '时光正在准备',
    message: '以后可以在这里按日期整理主动选择的照片与生活记录；当前不会读取相册。',
  },
  music: {
    title: '音乐正在准备',
    message: '以后可以在这里生成适合专注、运动和回忆的生活配乐；当前不会播放或生成音频。',
  },
  footprints: {
    title: '足迹正在准备',
    message: '以后可以在这里查看旅行地图与城市故事；当前不会申请定位或读取位置。',
  },
};
