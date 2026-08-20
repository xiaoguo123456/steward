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
  const summary = useAdminAICostSummary();
  const breakdown = useAdminAICostBreakdown({ group_by: 'date' });
  const prices = useAdminListAIPrices();
  const data = unwrap(summary.data)?.data;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        AI 与成本
      </Typography.Title>

      <PageState loading={summary.isPending} error={summary.error}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* 缺价的调用数不为 0 时，上面的金额一定偏低。
              必须让人看见这一点，否则会把一个不完整的数当成账单。 */}
          {data?.pricing_missing_calls ? (
            <Alert
              type="warning"
              showIcon
              message={`有 ${data.pricing_missing_calls} 天包含没有配置价格的调用`}
              description="这些调用的金额算不出来，因此下面的成本是偏低的。在「价格版本」里补上对应的服务商与模型即可自动重算。"
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
          error={breakdown.error}
          empty={(unwrap(breakdown.data)?.data.length ?? 0) === 0}
        >
          <Table
            rowKey="group_key"
            size="small"
            pagination={false}
            dataSource={unwrap(breakdown.data)?.data ?? []}
            columns={[
              { title: '日期', dataIndex: 'group_key' },
              { title: '调用', dataIndex: 'calls' },
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
          error={prices.error}
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
