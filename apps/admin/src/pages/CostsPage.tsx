import { ReportRange, useReportRange } from '@/components/ReportRange';
import { Alert, Card, Col, Row, Space, Statistic, Table, Typography } from 'antd';
import {
  unwrap,
  useAdminAICostBreakdown,
  useAdminAICostSummary,
  useAdminListAIPrices,
} from '@steward/admin-api-client';

import { Money } from '@/components/Money';
import { PageState } from '@/components/PageState';

export function CostsPage() {
  const { range, setRange, timezone } = useReportRange();
  const summary = useAdminAICostSummary(range);
  const breakdown = useAdminAICostBreakdown({ ...range, group_by: 'date' });
  const prices = useAdminListAIPrices();
  const data = unwrap(summary.data)?.data;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        AI 与成本
      </Typography.Title>
      <ReportRange value={range} onChange={setRange} timezone={timezone} />

      <PageState loading={summary.isPending} error={summary.error} onRetry={() => void summary.refetch()}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* 缺价的调用数不为 0 时，上面的金额一定偏低。
              必须让人看见这一点，否则会把一个不完整的数当成账单。 */}
          {data?.pricing_missing_calls ? (
            <Alert
              type="warning"
              showIcon
              message="有调用缺少计价，当前金额不完整"
              description="缺价调用未计入完整成本。请通过已授权的价格管理接口补齐价格，并核对重算结果；当前页面仅查看价格版本。"
            />
          ) : null}

          <Row gutter={16}>
            <Col span={6}>
              <Card>
                <Typography.Text type="secondary">总成本</Typography.Text>
                <div style={{ fontSize: 24, marginTop: 4 }}>
                  <Money value={data?.cost} />
                </div>
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="输入 token" value={data?.input_tokens ?? 0} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="缓存输入 token" value={data?.cached_input_tokens ?? 0} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="输出 token" value={data?.output_tokens ?? 0} />
              </Card>
            </Col>
          </Row>
        </Space>
      </PageState>

      <Card title="按日期">
        <PageState
          loading={breakdown.isPending}
          error={breakdown.error} onRetry={() => void breakdown.refetch()}
          empty={(unwrap(breakdown.data)?.data.length ?? 0) === 0}
        >
          <Table
            rowKey="group_key"
            size="small"
            pagination={false}
            dataSource={unwrap(breakdown.data)?.data ?? []}
            columns={[
              { title: '日期', dataIndex: 'group_key' },
              { title: '成本', render: (_: unknown, r) => <Money value={r.cost} /> },
            ]}
          />
        </PageState>
      </Card>

      <Card
        title="价格版本"
        extra={
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            改价是新增一个版本，不覆盖旧值——历史账目按当时的价格计算
          </Typography.Text>
        }
      >
        <PageState
          loading={prices.isPending}
          error={prices.error} onRetry={() => void prices.refetch()}
          empty={(unwrap(prices.data)?.data.length ?? 0) === 0}
          emptyText="还没有配置任何价格。在此之前所有成本都会显示为「价格缺失」。"
        >
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={unwrap(prices.data)?.data ?? []}
            columns={[
              { title: '服务商', dataIndex: 'provider' },
              { title: '模型', dataIndex: 'model' },
              { title: '用量单位', dataIndex: 'usage_unit' },
              { title: '单位大小', dataIndex: 'unit_size' },
              { title: '单价（USD）', dataIndex: 'unit_price_usd' },
              {
                title: '生效自',
                dataIndex: 'effective_from',
                render: (v: string) => new Date(v).toLocaleDateString('zh-CN'),
              },
              {
                title: '失效于',
                dataIndex: 'effective_until',
                render: (v?: string | null) =>
                  v ? new Date(v).toLocaleDateString('zh-CN') : '仍生效',
              },
            ]}
          />
        </PageState>
      </Card>
    </Space>
  );
}
