import { Button, Card, Form, Input, Select, Space, Table, Tag, Typography } from 'antd';
import {
  useAdminListUsers, type AdminUserSummary,
  unwrap,
} from '@steward/admin-api-client';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Freshness } from '@/components/Freshness';
import { Money } from '@/components/Money';
import { PageState } from '@/components/PageState';

type Filters = {
  user_id?: string;
  phone?: string;
  account_status?: 'active' | 'suspended';
};

export function UsersPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>({});
  // 游标分页：每一页的游标压在栈里，「上一页」就是弹出来。
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors[cursors.length - 1];

  const query = useAdminListUsers({ ...filters, cursor, limit: 20 });
  const rows = unwrap(query.data)?.data ?? [];

  const columns = [
    {
      title: '用户 ID',
      dataIndex: 'id',
      render: (id: string) => (
        <Typography.Text copyable style={{ fontSize: 12 }}>
          {id}
        </Typography.Text>
      ),
    },
    { title: '手机号', dataIndex: 'masked_phone' },
    {
      title: '状态',
      dataIndex: 'account_status',
      render: (status: string) =>
        status === 'suspended' ? <Tag color="red">已暂停</Tag> : <Tag color="green">正常</Tag>,
    },
    {
      title: '初始化',
      dataIndex: 'initialized',
      render: (done: boolean) => (done ? '已完成' : '未完成'),
    },
    {
      title: '注册时间',
      dataIndex: 'created_at',
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '最近活跃',
      dataIndex: 'last_active_at',
      // 从来没活跃过时显示「—」而不是某个默认日期。
      render: (value?: string | null) =>
        value ? new Date(value).toLocaleDateString('zh-CN') : '—',
    },
    { title: '30 日活跃天数', dataIndex: 'active_days_30d' },
    {
      title: '30 日 AI 成本',
      dataIndex: 'ai_cost_30d',
      render: (_: unknown, row: AdminUserSummary) => <Money value={row.ai_cost_30d} />,
    },
    {
      title: '',
      render: (_: unknown, row: AdminUserSummary) => (
        <Button type="link" size="small" onClick={() => navigate(`/users/${row.id}`)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        用户
      </Typography.Title>

      <Card size="small">
        <Form
          layout="inline"
          onFinish={(values: Filters) => {
            setCursors([]);
            setFilters(values);
          }}
        >
          <Form.Item name="user_id" label="用户 ID">
            <Input allowClear placeholder="精确匹配" style={{ width: 260 }} />
          </Form.Item>
          {/* 手机号只支持精确查询：服务端比对的是 HMAC，库里没有明文。
              模糊搜索等于提供一个把号码一位一位试出来的接口。 */}
          <Form.Item name="phone" label="手机号" tooltip="只支持完整号码精确查询">
            <Input allowClear placeholder="完整号码" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="account_status" label="状态">
            <Select
              allowClear
              style={{ width: 120 }}
              options={[
                { value: 'active', label: '正常' },
                { value: 'suspended', label: '已暂停' },
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            查询
          </Button>
        </Form>
      </Card>

      <Freshness value={unwrap(query.data)?.freshness} />

      <PageState
        loading={query.isPending}
        error={query.error}
        empty={rows.length === 0}
        emptyText="没有符合条件的用户"
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Table rowKey="id" dataSource={rows} columns={columns} pagination={false} size="small" />
          <Space>
            <Button disabled={cursors.length === 0} onClick={() => setCursors((c) => c.slice(0, -1))}>
              上一页
            </Button>
            <Button
              disabled={!unwrap(query.data)?.page.next_cursor}
              onClick={() =>
                setCursors((c) => [...c, unwrap(query.data)!.page.next_cursor as string])
              }
            >
              下一页
            </Button>
          </Space>
        </Space>
      </PageState>
    </Space>
  );
}
