import {
  listRecords,
  useCreateRecord,
  useListTrackers,
  type Record as TrackerRecord,
  type RecordValue,
  type TrackerBuiltinKey,
} from '@steward/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { collectCursorPages } from './record-pagination';

type BuiltinTrackerOptions = {
  enabled?: boolean;
  from?: string;
  limit?: number;
  loadAll?: boolean;
  to?: string;
};

/**
 * 内置记录项的数据层。
 *
 * 运动、专注与记账不是新的领域类型：它们各自对应一个内置 Tracker，
 * 每次保存就是一条 Record。打卡首页不重复展示，复盘与统计仍读取同一份数据。
 *
 * 记录项按需创建：按 builtin_key 查询时服务端顺带建好，
 * 客户端不硬编码 ID，也不靠名称匹配（用户可以改名）。
 */
export function useBuiltinTracker(
  key: TrackerBuiltinKey,
  options?: BuiltinTrackerOptions,
) {
  const queryClient = useQueryClient();
  const enabled = options?.enabled ?? true;
  const limit = options?.limit ?? 50;

  const trackers = useListTrackers(
    { builtin_key: key },
    { query: { enabled } },
  );
  const tracker = trackers.data?.data[0];

  const records = useQuery({
    enabled: enabled && Boolean(tracker),
    queryKey: [
      'builtin-tracker-records',
      tracker?.id ?? key,
      limit,
      options?.from ?? null,
      options?.to ?? null,
      options?.loadAll ?? false,
    ],
    queryFn: async ({ signal }) => {
      if (!tracker) return [];
      return collectCursorPages<TrackerRecord>(
        (cursor) => listRecords(
          {
            cursor,
            from: options?.from,
            limit,
            to: options?.to,
            tracker_id: tracker.id,
          },
          { signal },
        ),
        options?.loadAll,
      );
    },
  });

  const create = useCreateRecord({
    mutation: {
      onSuccess: () => {
        void records.refetch();
        // 打卡页与首页的统计都会变，精确失效不如整体失效清楚。
        void queryClient.invalidateQueries();
      },
    },
  });

  const buildCreateRequest = (
    values: Record<string, number | string | undefined>,
    timestamp: Date,
    note?: string,
  ) => {
    if (!tracker) return null;
    const trimmed = note?.trim();
    return {
      data: {
        tracker_id: tracker.id,
        timestamp: timestamp.toISOString(),
        values: toRecordValues(tracker.fields.map((field) => field.key), values),
        ...(trimmed ? { note: trimmed } : {}),
      },
    };
  };

  return {
    tracker,
    records: records.data ?? [],
    loading: trackers.isLoading || records.isLoading,
    failed: trackers.isError || records.isError,
    queryError: trackers.error ?? records.error,
    saving: create.isPending,
    error: create.error,
    refetch: async () => {
      await trackers.refetch();
      if (tracker) await records.refetch();
    },

    /**
     * 保存一条记录。
     *
     * timestamp 用发生时刻而不是保存时刻：用户可能跑完步过一会儿才点保存，
     * 记录应当落在他实际运动的那个时间点上。
     */
    save: (
      values: Record<string, number | string | undefined>,
      timestamp: Date,
      note?: string,
    ) => {
      const request = buildCreateRequest(values, timestamp, note);
      if (request) create.mutate(request);
    },

    /** 需要等待保存结果的表单使用此入口，失败时保留用户输入。 */
    saveAsync: async (
      values: Record<string, number | string | undefined>,
      timestamp: Date,
      note?: string,
    ) => {
      const request = buildCreateRequest(values, timestamp, note);
      if (!request) throw new Error('记录项尚未加载完成，请稍后重试。');
      return create.mutateAsync(request);
    },
  };
}

/**
 * 把扁平的键值对映射成契约的 RecordValue。
 *
 * 只发送记录项真正定义过的字段：服务端会拒绝未知字段，
 * 与其让请求整个失败，不如在这里就丢掉。
 */
function toRecordValues(
  knownKeys: string[],
  values: Record<string, number | string | undefined>,
): RecordValue[] {
  const out: RecordValue[] = [];
  for (const key of knownKeys) {
    const value = values[key];
    if (value === undefined || value === '') continue;
    out.push(
      typeof value === 'number'
        ? { key, number_value: value }
        : { key, text_value: value },
    );
  }
  return out;
}

/** 从一条记录里按 key 取数值。 */
export function numberOf(record: TrackerRecord, key: string): number | undefined {
  return record.values.find((v) => v.key === key)?.number_value ?? undefined;
}

/** 从一条记录里按 key 取文本。 */
export function textOf(record: TrackerRecord, key: string): string | undefined {
  return record.values.find((v) => v.key === key)?.text_value ?? undefined;
}
