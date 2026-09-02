import {
  BarChartOutlined,
  DashboardOutlined,
  DollarOutlined,
  FileProtectOutlined,
  MonitorOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Layout, Menu, Space, Tag, Typography, Button } from 'antd';
import type { PropsWithChildren } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useSession } from '@/api/session';

const items = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '总览' },
  { key: '/users', icon: <TeamOutlined />, label: '用户' },
  { key: '/usage', icon: <BarChartOutlined />, label: '使用分析' },
  { key: '/costs', icon: <DollarOutlined />, label: 'AI 与成本' },
  { key: '/ops', icon: <MonitorOutlined />, label: '运行中心' },
  { key: '/audit', icon: <FileProtectOutlined />, label: '操作审计' },
];

export function AdminLayout({ children }: PropsWithChildren) {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, signOut } = useSession();

  // 用户详情页也要让「用户」这一项保持选中。
  const selected = items
    .map((item) => item.key)
    .filter((key) => location.pathname.startsWith(key));

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider width={200} theme="light">
        <div style={{ padding: '20px 16px 12px', fontWeight: 600 }}>序事后台</div>
        <Menu
          mode="inline"
          items={items}
          selectedKeys={selected}
          onClick={({ key }) => navigate(key)}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{
            background: '#fff',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 16,
          }}
        >
          {/* 非 production 常驻显示环境标识。
              没有它的话，在生产上误操作和在本地操作看起来一模一样。 */}
          {session?.environment !== 'production' ? (
            <Tag color="orange">{session?.environment ?? '未知环境'}</Tag>
          ) : null}
          <Space size={12}>
            <Typography.Text type="secondary">
              报表时区 {session?.reporting_timezone}
            </Typography.Text>
            <Typography.Text>{session?.username}</Typography.Text>
            <Button size="small" onClick={() => void signOut()}>
              退出
            </Button>
          </Space>
        </Layout.Header>
        <Layout.Content style={{ padding: 24, minWidth: 1024 }}>{children}</Layout.Content>
      </Layout>
    </Layout>
  );
}
