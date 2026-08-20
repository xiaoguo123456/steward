import { Alert, Card, Space, Table, Tag, Typography } from 'antd';
import {
  useAdminGetProviders, useAdminGetQueues,
  unwrap,
} from '@steward/admin-api-client';

import { PageState } from '@/components/PageState';

export function OpsPage() {
  const queues = useAdminGetQueues();
  const providers = useAdminGetProviders();

  // 最老的待执行任务等太久，说明消费侧停了——任务数不高也一样。
  const stuck = (unwrap(queues.data)?.data ?? []).filter(
    (q) => (q.oldest_available_age_seconds ?? 0) > 600,
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        运行中心
      </Typography.Title>

      {stuck.length ? (
        <Alert
          type="error"
          showIcon
          message="有队列的任务积压超过十分钟"
          description={`${stuck.map((q) => q.queue).join('、')} —— 任务数不高也可能是消费侧停了，先确认 Worker 是否在运行。`}
        />
      ) : null}

      <Card title="队列">
        <PageState
          loading={queues.isPending}
          error={queues.error}
          empty={(unwrap(queues.data)?.data.length ?? 0) === 0}
          emptyText="还没有任何任务记录"
        >
          <Table
            rowKey="queue"
            size="small"
            pagination={false}
            dataSource={unwrap(queues.data)?.data ?? []}
            columns={[
              { title: '队列', dataIndex: 'queue' },
              { title: '待执行', dataIndex: 'available' },
              { title: '执行中', dataIndex: 'running' },
              { title: '已排期', dataIndex: 'scheduled' },
              { title: '可重试', dataIndex: 'retryable' },
              {
                title: '已丢弃',
                dataIndex: 'discarded',
                render: (v: number) => (v > 0 ? <Tag color="red">{v}</Tag> : v),
              },
              {
                title: '最老待执行',
                dataIndex: 'oldest_available_age_seconds',
                render: (v?: number | null) =>
                  v === null || v === undefined ? '—' : `${Math.round(v / 60)} 分钟`,
              },
            ]}
          />
        </PageState>
      </Card>

      <Card title="外部服务">
        <PageState
          loading={providers.isPending}
          error={providers.error}
          empty={(unwrap(providers.data)?.data.length ?? 0) === 0}
          emptyText="还没有配置任何服务商价格，因此这里看不到服务商"
        >
          <Table
            rowKey="name"
            size="small"
            pagination={false}
            dataSource={unwrap(providers.data)?.data ?? []}
            columns={[
              { title: '名称', dataIndex: 'name' },
              { title: '类型', dataIndex: 'kind' },
              {
                title: '成功率',
                dataIndex: 'success_rate',
                // 服务端算不出来时返回空。**显示「—」而不是 0%**：
                // 0% 会被当成「这个服务挂了」。
                render: (v?: number | null) =>
                  v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`,
              },
            ]}
          />
        </PageState>
      </Card>
    </Space>
  );
}
