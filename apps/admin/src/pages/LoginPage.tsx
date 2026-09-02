import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { AdminApiError } from '@steward/admin-api-client';

import { useSession } from '@/api/session';

export function LoginPage() {
  const { signIn } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onFinish = async (values: { username: string; password: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      await signIn(values.username, values.password);
    } catch (err) {
      // 服务端对「用户名不存在」和「口令不对」返回同一个错误码，
      // 界面也不去区分——区分开等于告诉试探的人用户名已经猜对了。
      setError(err instanceof AdminApiError ? err.message : '登录失败，请稍后再试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: '#f5f5f5' }}>
      <Card style={{ width: 380 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          序事后台
        </Typography.Title>
        {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
        <Form layout="vertical" onFinish={onFinish} disabled={submitting}>
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item
            name="password"
            label="口令"
            rules={[{ required: true, message: '请输入口令' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}
