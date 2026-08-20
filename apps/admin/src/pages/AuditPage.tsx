import { Button, Card, Space, Table, Tag, Typography } from 'antd';
import {
  useAdminListAuditLogs,
  unwrap,
} from '@steward/admin-api-client';
import { useState } from 'react';

import { PageState } from '@/components/PageState';

export function AuditPage() {
  const [cursors, setCursors] = useState<string[]>([]);
  const query = useAdminListAuditLogs({ cursor: cursors[cursors.length - 1], limit: 20 });
  const rows = unwrap(query.data)?.data ?? [];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        操作审计
      </Typography.Title>
      <Typography.Text type="secondary">
        每一次管理操作都会留下记录，且和业务变更在同一个事务里提交——
        操作成功了，记录一定在。
      </Typography.Text>

      <Card>
        <PageState
          loading={query.isPending}
          error={query.error}
          empty={rows.length === 0}
          emptyText="还没有执行过任何管理操作"
        >
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={rows}
              columns={[
                {
                  title: '时间',
                  dataIndex: 'occurred_at',
                  render: (v: string) => new Date(v).toLocaleString('zh-CN'),
                },
                {
                  title: '操作者',
                  dataIndex: 'actor_username',
                  // 空串表示这条写在补上 actor 之前，当时没记。
                  // 必须显式写「未记录」——留空会被读成「系统自己做的」。
                  render: (v: string) =>
                    v ? v : <Typography.Text type="secondary">未记录</Typography.Text>,
                },
                { title: '操作', dataIndex: 'action' },
                {
                  title: '结果',
                  dataIndex: 'outcome',
                  render: (v: string) =>
                    v === 'succeeded' ? <Tag color="green">成功</Tag> : <Tag color="red">失败</Tag>,
                },
                {
                  title: '对象',
                  dataIndex: 'target_id',
                  render: (v?: string | null) =>
                    v ? (
                      <Typography.Text copyable style={{ fontSize: 12 }}>
                        {v}
                      </Typography.Text>
                    ) : (
                      '—'
                    ),
                },
                { title: '原因', dataIndex: 'reason_code', render: (v?: string | null) => v ?? '—' },
                { title: '说明', dataIndex: 'reason_text', render: (v?: string | null) => v ?? '—' },
                {
                  title: 'Request ID',
                  dataIndex: 'request_id',
                  render: (v: string) => (
                    <Typography.Text copyable style={{ fontSize: 12 }}>
                      {v}
                    </Typography.Text>
                  ),
                },
              ]}
            />
            <Space>
              <Button
                disabled={cursors.length === 0}
                onClick={() => setCursors((c) => c.slice(0, -1))}
              >
                上一页
              </Button>
              <Button
                disabled={!unwrap(query.data)?.page.next_cursor}
                onClick={() => setCursors((c) => [...c, unwrap(query.data)!.page.next_cursor as string])}
              >
                下一页
              </Button>
            </Space>
          </Space>
        </PageState>
      </Card>
    </Space>
  );
}
