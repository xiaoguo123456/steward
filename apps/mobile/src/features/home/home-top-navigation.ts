export type HomeTopTabId = 'today' | 'memories' | 'relationships' | 'inspiration' | 'mood';

export const HOME_TOP_TABS: readonly { id: HomeTopTabId; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'memories', label: '时光' },
  { id: 'relationships', label: '亲友' },
  { id: 'inspiration', label: '灵感' },
  { id: 'mood', label: '心情' },
];
