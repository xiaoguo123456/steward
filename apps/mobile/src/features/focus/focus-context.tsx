import { type PropsWithChildren, createContext, useCallback, useContext, useMemo } from 'react';

import { useBootState } from '@/api/provider';
import {
  numberOf,
  textOf,
  useBuiltinTracker,
} from '@/features/trackers/use-builtin-tracker';

import type { FocusMode, FocusQuality, FocusRecord, NewFocusRecord } from './model';

/**
 * 专注记录的数据层。
 *
 * 专注不是新的领域类型：它是内置的「专注」Tracker，每次保存一条 Record。
 * 打卡首页不重复展示，复盘与统计仍读取同一份数据。
 *
 * 只有用户点「保存专注记录」时才写入。进行中的计时、暂存的想法都留在
 * 页面里，不自动创建 Note、Task 或 Capture。
 */

type FocusPrototypeValue = {
  records: FocusRecord[];
  saveRecord: (record: NewFocusRecord) => void;
  saving: boolean;
};

const FocusPrototypeContext = createContext<FocusPrototypeValue | null>(null);

export function FocusPrototypeProvider({ children }: PropsWithChildren) {
  const boot = useBootState();
  const tracker = useBuiltinTracker('focus', {
    limit: 50,
    // 这个 Provider 挂在根布局，登录页也会渲染。没有会话时请求用户数据会
    // 返回 401，进而触发清缓存和登录路由重建，形成无限闪烁循环。
    enabled: boot === 'signed-in',
  });

  const saveRecord = useCallback(
    (record: NewFocusRecord) => {
      tracker.save(
        {
          // 服务端字段单位是分钟；秒级精度对「今天专注了多久」没有意义。
          duration_min: Math.max(1, Math.round(record.elapsedSeconds / 60)),
          mode: record.mode,
          task_title: record.task?.title,
          quality: record.quality ?? undefined,
        },
        new Date(record.completedAt),
      );
    },
    [tracker],
  );

  const records = useMemo<FocusRecord[]>(
    () =>
      tracker.records.map((row) => ({
        id: row.id,
        task: taskReferenceOf(row.values.find((v) => v.key === 'task_title')?.text_value),
        mode: (textOf(row, 'mode') as FocusMode | undefined) ?? 'pomodoro',
        elapsedSeconds: (numberOf(row, 'duration_min') ?? 0) * 60,
        completedAt: row.timestamp,
        // 任务是否完成由 Task 自己管，不在专注记录里复制一份状态。
        taskCompleted: false,
        quality: (textOf(row, 'quality') as FocusQuality | undefined) ?? null,
        // 暂存的想法只属于当次会话，不落库。
        thoughts: [],
      })),
    [tracker.records],
  );

  const value = useMemo(
    () => ({ records, saveRecord, saving: tracker.saving }),
    [records, saveRecord, tracker.saving],
  );

  return (
    <FocusPrototypeContext.Provider value={value}>
      {children}
    </FocusPrototypeContext.Provider>
  );
}

/** 记录里只存了任务标题，展示时还原成最小引用。 */
function taskReferenceOf(title: string | null | undefined): FocusRecord['task'] {
  if (!title) return null;
  return { id: '', title, list: '', color: '' };
}

export function useFocusPrototype() {
  const value = useContext(FocusPrototypeContext);
  if (!value) {
    throw new Error('useFocusPrototype 必须在 FocusPrototypeProvider 中使用');
  }
  return value;
}
