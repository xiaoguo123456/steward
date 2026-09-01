import {
  errorMessage,
  useCreateNote,
  useGenerateWeeklyReview,
  useGetOperation,
  useGetWeeklyReview,
  useListProposals,
  type ReviewMetric,
  type ReviewSource,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { hasReviewableMetrics } from '@/features/review/review-metrics';

/**
 * 每周复盘的数据层。
 *
 * 两条边界要守住：
 *
 *  1. **指标由服务端按固定口径算**，客户端不重算也不补零。Provider 不可用时
 *     指标照样完整，只是没有小结。
 *  2. **AI 只输出有来源的内容**。契约里的 suggestion 是「一句话 + 它的依据」，
 *     没有来源的结论在服务端就被丢掉了，这里不会收到。
 *
 * 界面上的「下周建议」需要「具体字段变化 + 确认加入计划」，那正是 Action
 * Proposal 的形状，因此直接复用它，而不是另造一套。
 */

/** 界面用的观察条目：一句话加上它的依据。 */
export type ReviewObservation = {
  id: string;
  text: string;
  sources: { label: string; resourceType: string; resourceId: string }[];
};

export function useWeeklyReview(weekOf: string) {
  const queryClient = useQueryClient();
  const [operationId, setOperationId] = useState('');

  const review = useGetWeeklyReview({ week_of: weekOf });

  // 待确认建议是全局的，不按周过滤：一条「把任务延到下周」的建议
  // 不属于某一周，用户在哪看到都该能确认。
  const proposals = useListProposals({ status: ['pending'] });

  const generate = useGenerateWeeklyReview({
    mutation: { onSuccess: (result) => setOperationId(result.data.operation_id) },
  });

  const operation = useGetOperation(operationId, {
    query: {
      enabled: Boolean(operationId),
      refetchInterval: (query) => {
        const status = query.state.data?.data.status;
        return status === 'succeeded' || status === 'failed' || status === 'cancelled'
          ? false
          : 900;
      },
    },
  });

  const generateStatus = operation.data?.data.status;
  const settled =
    generateStatus === 'succeeded' || generateStatus === 'failed' || generateStatus === 'cancelled';
  const generating = Boolean(operationId) && !settled;

  // 生成结束后重新拉一次复盘。refetch 不是 setState，放在 effect 里没问题。
  useEffect(() => {
    if (!operationId || !settled) return;
    void review.refetch();
    // review 是查询对象，每次渲染都是新引用，不放进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationId, settled]);

  const data = review.data?.data;
  const metrics = data?.metrics ?? [];

  const observations = useMemo<ReviewObservation[]>(
    () =>
      (data?.suggestions ?? []).map((item) => ({
        id: item.id,
        text: item.text,
        sources: item.source_refs.map(toSourceLabel),
      })),
    [data?.suggestions],
  );

  const saveReflection = useCreateNote({
    mutation: { onSuccess: () => void queryClient.invalidateQueries() },
  });

  // 失败提示全部派生：存一份状态就要负责在每条成功路径上清掉它，
  // 少清一处就会留下一条不该出现的红字。
  const failure =
    (review.error ? errorMessage(review.error, '本周复盘暂时无法读取，请重试。') : null) ??
    (generateStatus === 'failed'
      ? errorMessage(operation.data?.data.error, '这次没能生成小结，指标仍然可用。')
      : null) ??
    (generate.error ? errorMessage(generate.error, '生成小结失败，请稍后再试。') : null) ??
    (saveReflection.error ? errorMessage(saveReflection.error, '补充没能保存。') : null);

  return {
    review: data,
    loading: review.isLoading,
    metrics,
    hasReviewableData: hasReviewableMetrics(metrics),
    headline: data?.headline ?? null,
    narrative: data?.narrative ?? null,
    highlights: data?.highlights ?? [],
    observations,
    proposals: proposals.data?.data ?? [],
    failure,

    generating,
    generate: () => generate.mutate({ data: { week_of: weekOf } }),

    /**
     * 把个人感受存成一篇笔记。
     *
     * 复盘本身是派生快照，往里面塞用户手写的内容会让它不再可重建。
     * 笔记是用户自己的正式内容，存在那里才找得回来。
     */
    saveReflection: async (text: string) => {
      if (!data) throw new Error('复盘尚未加载完成。');
      await saveReflection.mutateAsync({
        data: {
          title: `复盘补充 · ${data.period_start} 至 ${data.period_end}`,
          content: { format: 'plain_text', text },
          tags: ['复盘'],
        },
      });
    },
    savingReflection: saveReflection.isPending,
    reflectionSaved: saveReflection.isSuccess,

    refetch: async () => {
      await Promise.all([review.refetch(), proposals.refetch()]);
    },
  };
}

/** 指标格式化：服务端给的是数值加单位，这里只负责拼展示文本。 */
export function formatMetric(metric: ReviewMetric): string {
  const value = Number.isInteger(metric.value)
    ? String(metric.value)
    : metric.value.toFixed(1);
  return metric.unit ? `${value} ${metric.unit}` : value;
}

/** 与上周的差值。没有对比数据时返回空，不显示 0。 */
export function formatDelta(metric: ReviewMetric): string | null {
  if (metric.delta_vs_previous === undefined || metric.delta_vs_previous === null) return null;
  if (metric.delta_vs_previous === 0) return '与上周持平';
  const sign = metric.delta_vs_previous > 0 ? '+' : '';
  return `较上周 ${sign}${metric.delta_vs_previous}`;
}

function toSourceLabel(source: ReviewSource) {
  return {
    label: source.title,
    resourceType: source.resource_type,
    resourceId: source.resource_id,
  };
}
