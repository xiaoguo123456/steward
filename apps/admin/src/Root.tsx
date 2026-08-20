import { Spin } from 'antd';
import { Navigate, Route, Routes } from 'react-router-dom';

import { useSession } from '@/api/session';
import { AdminLayout } from '@/layouts/AdminLayout';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { UsersPage } from '@/pages/UsersPage';
import { UserDetailPage } from '@/pages/UserDetailPage';
import { UsagePage } from '@/pages/UsagePage';
import { CostsPage } from '@/pages/CostsPage';
import { OpsPage } from '@/pages/OpsPage';
import { AuditPage } from '@/pages/AuditPage';

export function Root() {
  const { session, loading } = useSession();

  if (loading) {
    // 启动时先问服务端 Cookie 还在不在。这段时间既不能显示登录页
    // （已登录的人会看到一次闪烁），也不能显示内容页（未登录的人会看到空壳）。
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <Spin size="large" tip="正在确认登录状态…" />
      </div>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <AdminLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/users/:userId" element={<UserDetailPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/costs" element={<CostsPage />} />
        <Route path="/ops" element={<OpsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/login" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AdminLayout>
  );
}
