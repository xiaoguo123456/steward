import {
  useCreateRecord,
  useListRecords,
  useListTrackers,
  type Record as TrackerRecord,
  type RecordValue,
  type TrackerBuiltinKey,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';

/**
 * 内置记录项的数据层。
 *
 * 运动、专注与记账不是新的领域类型：它们各自对应一个内置 Tracker，
 * 每次保存就是一条 Record。用户在「打卡」页能看到同样的数据。
 *
 * 记录项按需创建：按 builtin_key 查询时服务端顺带建好，
 * 客户端不硬编码 ID，也不靠名称匹配（用户可以改名）。
 */
export function useBuiltinTracker(key: TrackerBuiltinKey, options?: { limit?: number }) {
  const queryClient = useQueryClient();

  const trackers = useListTrackers({ builtin_key: key });
  const tracker = trackers.data?.data[0];

  const records = useListRecords(
    { tracker_id: tracker?.id, limit: options?.limit ?? 50 },
    { query: { enabled: Boolean(tracker) } },
  );

  const create = useCreateRecord({
    mutation: {
      onSuccess: () => {
        void records.refetch();
        // 打卡页与首页的统计都会变，精确失效不如整体失效清楚。
        void queryClient.invalidateQueries();
      },
    },
  });

  return {
    tracker,
    records: records.data?.data ?? [],
    loading: trackers.isLoading || records.isLoading,
    saving: create.isPending,
    error: create.error,

    /**
     * 保存一条记录。
     *
     * timestamp 用发生时刻而不是保存时刻：用户可能跑完步过一会儿才点保存，
     * 记录应当落在他实际运动的那个时间点上。
     */
    save: (values: Record<string, number | string | undefined>, timestamp: Date) => {
      if (!tracker) return;
      create.mutate({
        data: {
          tracker_id: tracker.id,
          timestamp: timestamp.toISOString(),
          values: toRecordValues(tracker.fields.map((f) => f.key), values),
        },
      });
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
