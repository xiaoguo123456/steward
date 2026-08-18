import { Platform } from 'react-native';

const WEB_DOCK_POSITION_KEY = 'ai-steward.ai-fab-dock-position';

export type AiFabDockSide = 'left' | 'right';

export type AiFabDockPosition = {
  side: AiFabDockSide;
  verticalRatio: number;
};

const defaultDockPosition: AiFabDockPosition = { side: 'right', verticalRatio: 1 };

function readInitialDockPosition(): AiFabDockPosition {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return defaultDockPosition;
  }

  try {
    const value = window.localStorage.getItem(WEB_DOCK_POSITION_KEY);
    if (!value) {
      return defaultDockPosition;
    }

    const parsed = JSON.parse(value) as Partial<AiFabDockPosition>;
    if (
      (parsed.side !== 'left' && parsed.side !== 'right')
      || typeof parsed.verticalRatio !== 'number'
      || !Number.isFinite(parsed.verticalRatio)
    ) {
      return defaultDockPosition;
    }

    return {
      side: parsed.side,
      verticalRatio: Math.min(1, Math.max(0, parsed.verticalRatio)),
    };
  } catch {
    return defaultDockPosition;
  }
}

function persistWebDockPosition(position: AiFabDockPosition) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(WEB_DOCK_POSITION_KEY, JSON.stringify(position));
  } catch {
    // 浏览器禁用本地存储时仍保留当前页面内的拖动结果。
  }
}

const listeners = new Set<() => void>();
let dockPosition = readInitialDockPosition();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function subscribeAiFabDockPosition(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAiFabDockPosition() {
  return dockPosition;
}

function saveAiFabDockPosition(side: AiFabDockSide, verticalRatio: number) {
  const nextRatio = Math.min(1, Math.max(0, verticalRatio));

  if (dockPosition.side === side && Math.abs(dockPosition.verticalRatio - nextRatio) < 0.001) {
    return;
  }

  dockPosition = { side, verticalRatio: nextRatio };
  persistWebDockPosition(dockPosition);
  listeners.forEach((listener) => listener());
}

export function scheduleAiFabDockPositionSave(
  side: AiFabDockSide,
  verticalRatio: number,
  delay: number,
) {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  if (delay === 0) {
    saveTimer = null;
    saveAiFabDockPosition(side, verticalRatio);
    return;
  }

  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveAiFabDockPosition(side, verticalRatio);
  }, delay);
}
