import { Alert, Card, Col, Row, Space, Statistic, Typography } from 'antd';
import {
  useAdminDashboardSummary, useAdminDashboardTrends,
  unwrap,
} from '@steward/admin-api-client';
import ReactECharts from 'echarts-for-react';

import { Freshness } from '@/components/Freshness';
import { Money } from '@/components/Money';
import { PageState } from '@/components/PageState';

export function DashboardPage() {
  const summary = useAdminDashboardSummary();
  const trends = useAdminDashboardTrends();
  const data = unwrap(summary.data)?.data;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        总览
      </Typography.Title>

      <PageState loading={summary.isPending} error={summary.error}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Freshness value={data?.freshness} />

          {/* 部分数据源失败时保留其他模块，并明确标出哪一块没取到。
              整页报错的话，一个模块查不出来会让人连用户数都看不到。 */}
          {data?.failed_sections?.length ? (
            <Alert
              type="warning"
              showIcon
              message={`以下模块暂时取不到数据：${data.failed_sections.join('、')}`}
              description="其余模块的数字仍然可用。"
            />
          ) : null}

          <Row gutter={16}>
            <Col span={6}>
              <Card>
                <Statistic title="总用户" value={data?.users.total ?? 0} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="日活" value={data?.users.dau ?? 0} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="周活" value={data?.users.wau ?? 0} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="月活" value={data?.users.mau ?? 0} />
              </Card>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={6}>
              <Card>
                <Statistic title="Capture 提交" value={data?.usage.capture_submitted ?? 0} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic title="Assistant 轮次" value={data?.usage.assistant_turns ?? 0} />
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Typography.Text type="secondary">AI 成本</Typography.Text>
                <div style={{ fontSize: 24, marginTop: 4 }}>
                  <Money value={data?.ai.cost} />
                </div>
                {data?.ai.pricing_missing_calls ? (
                  <Typography.Text type="warning" style={{ fontSize: 12 }}>
                    有 {data.ai.pricing_missing_calls} 天含缺价调用，实际更高
                  </Typography.Text>
                ) : null}
              </Card>
            </Col>
            <Col span={6}>
              <Card>
                <Statistic
                  title="队列待办"
                  value={data?.runtime.queue_available ?? 0}
                  suffix={
                    data?.runtime.discarded_jobs
                      ? `／已丢弃 ${data.runtime.discarded_jobs}`
                      : undefined
                  }
                />
              </Card>
            </Col>
          </Row>

          <Card title="趋势">
            <PageState
              loading={trends.isPending}
              error={trends.error}
              empty={(unwrap(trends.data)?.data.length ?? 0) === 0}
              emptyText="这段时间还没有聚合出数据"
            >
              <ReactECharts
                style={{ height: 320 }}
                option={{
                  tooltip: { trigger: 'axis' },
                  legend: { data: ['活跃用户', 'Capture 提交', 'Assistant 轮次'] },
                  xAxis: {
                    type: 'category',
                    data: unwrap(trends.data)?.data.map((p) => p.date) ?? [],
                  },
                  yAxis: { type: 'value' },
                  series: [
                    {
                      name: '活跃用户',
                      type: 'line',
                      data: unwrap(trends.data)?.data.map((p) => p.active_users) ?? [],
                    },
                    {
                      name: 'Capture 提交',
                      type: 'line',
                      data: unwrap(trends.data)?.data.map((p) => p.capture_submitted) ?? [],
                    },
                    {
                      name: 'Assistant 轮次',
                      type: 'line',
                      data: unwrap(trends.data)?.data.map((p) => p.assistant_turns) ?? [],
                    },
                  ],
                }}
              />
            </PageState>
          </Card>
        </Space>
      </PageState>
    </Space>
  );
}
