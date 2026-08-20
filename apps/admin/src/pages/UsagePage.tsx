import { Card, Col, Row, Space, Statistic, Table, Typography } from 'antd';
import {
  useAdminGetFunnel, useAdminUsageOverview,
  unwrap,
} from '@steward/admin-api-client';

import { Freshness } from '@/components/Freshness';
import { PageState } from '@/components/PageState';

export function UsagePage() {
  const overview = useAdminUsageOverview();
  const funnel = useAdminGetFunnel('onboarding');
  const data = unwrap(overview.data)?.data;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        使用分析
      </Typography.Title>
      <Freshness value={unwrap(overview.data)?.freshness} />

      <PageState loading={overview.isPending} error={overview.error}>
        <Row gutter={16}>
          <Col span={8}>
            <Card>
              <Statistic title="日活" value={data?.dau ?? 0} />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic title="周活" value={data?.wau ?? 0} />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic title="月活" value={data?.mau ?? 0} />
            </Card>
          </Col>
        </Row>
      </PageState>

      <Card title="功能使用">
        <PageState
          loading={overview.isPending}
          error={overview.error}
          empty={(data?.feature_usage.length ?? 0) === 0}
        >
          <Table
            rowKey="feature"
            size="small"
            pagination={false}
            dataSource={data?.feature_usage ?? []}
            columns={[
              { title: '功能', dataIndex: 'feature' },
              { title: '次数', dataIndex: 'events' },
            ]}
          />
        </PageState>
      </Card>

      <Card title="新用户漏斗">
        <PageState
          loading={funnel.isPending}
          error={funnel.error}
          empty={(unwrap(funnel.data)?.data.length ?? 0) === 0}
        >
          <Table
            rowKey="name"
            size="small"
            pagination={false}
            dataSource={unwrap(funnel.data)?.data ?? []}
            columns={[
              { title: '步骤', dataIndex: 'name' },
              { title: '人数', dataIndex: 'users' },
              {
                title: '相对上一步',
                dataIndex: 'conversion_from_previous',
                // 分母为 0 时服务端返回空，这里显示「—」**而不是 0%**：
                // 没有样本和转化率为零是两回事。
                render: (v?: number | null) =>
                  v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`,
              },
              {
                title: '相对起点',
                dataIndex: 'conversion_from_start',
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
