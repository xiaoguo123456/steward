export type HomeTopTabId = 'today' | 'memories' | 'relationships' | 'mood';

export const HOME_TOP_TABS: readonly { id: HomeTopTabId; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'memories', label: '时光' },
  { id: 'mood', label: '心情' },
  { id: 'relationships', label: '亲友' },
];

export function isHomeTopTabId(value: string | undefined): value is HomeTopTabId {
  return value === 'today'
    || value === 'memories'
    || value === 'relationships'
    || value === 'mood';
}

/** App 初次进入首页默认显示“今天”；明确的页内回跳参数可以指定分区。 */
export function resolveHomeEntryTab(value: string | undefined): HomeTopTabId {
  return isHomeTopTabId(value) ? value : 'today';
}
