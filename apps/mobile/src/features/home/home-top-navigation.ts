export type HomeTopTabId = 'today' | 'memories' | 'relationships' | 'mood';

export const HOME_TOP_TABS: readonly { id: HomeTopTabId; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'memories', label: '时光' },
  { id: 'mood', label: '心情' },
  { id: 'relationships', label: '亲友' },
];
