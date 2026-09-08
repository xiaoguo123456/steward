import { Alert, Button, Card, Checkbox, Form, Input, Space, Tabs, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { AdminApiError, adminRequestPhoneCode, adminResetPassword, adminPhoneCodeResponseSchema, adminResetPasswordResponseSchema, unwrap } from '@steward/admin-api-client';
import { useSession } from '@/api/session';

type Mode = 'sms' | 'password' | 'reset' | 'setup';
type Values = { phone: string; code?: string; password?: string; newPassword?: string; confirmPassword?: string };

export function LoginPage() {
  const { signIn } = useSession();
  const [form] = Form.useForm<Values>();
  const [mode, setMode] = useState<Mode>('sms');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sending, setSending] = useState(false);
  const [consent, setConsent] = useState(false);
  const [challenge, setChallenge] = useState<{ id: string; phone: string; purpose: 'login' | 'password_reset' } | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const busy = useRef(false);
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const requiresCode = mode !== 'password';
  const settingPassword = mode === 'reset' || mode === 'setup';

  useEffect(() => {
    if (retryAt <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  const changeMode = (next: Mode) => {
    if (busy.current) return;
    setMode(next); setError(null); setNotice(null); setChallenge(null);
    form.setFieldsValue({ code: '', password: '', newPassword: '', confirmPassword: '' });
  };
  const showError = (err: unknown) => setError(err instanceof AdminApiError ? err.message : '网络连接失败，请检查网络后重试。');
  const sendCode = async () => {
    if (busy.current || remaining > 0) return;
    if (!consent) { setError('请先确认手机号验证用途及隐私说明。'); return; }
    let phone: string;
    try { phone = (await form.validateFields(['phone'])).phone.trim(); } catch { return; }
    busy.current = true; setSending(true); setError(null); setNotice(null);
    const purpose = mode === 'reset' ? 'password_reset' : 'login';
    try {
      const data = adminPhoneCodeResponseSchema.parse(unwrap(await adminRequestPhoneCode({ phone, purpose, consent_accepted: true }, { signal: AbortSignal.timeout(20_000) }))).data;
      if (!data) throw new Error('响应为空');
      setChallenge({ id: data.challenge_id, phone, purpose });
      const sentAt = Date.now(); setNow(sentAt); setRetryAt(sentAt + data.resend_after_seconds * 1000);
      setNotice('如该号码已获管理员授权，将收到验证码，5 分钟内有效。');
    } catch (err) { showError(err); }
    finally { busy.current = false; setSending(false); }
  };

  const onFinish = async (values: Values) => {
    if (busy.current) return;
    const phone = values.phone.trim();
    if (requiresCode && (!challenge || challenge.phone !== phone || challenge.purpose !== (mode === 'reset' ? 'password_reset' : 'login'))) {
      setError('请先获取本次操作的验证码。'); return;
    }
    busy.current = true; setSubmitting(true); setError(null); setNotice(null);
    try {
      if (mode === 'reset') {
        adminResetPasswordResponseSchema.parse(unwrap(await adminResetPassword({ phone, challenge_id: challenge!.id, code: values.code!, new_password: values.newPassword! }, { signal: AbortSignal.timeout(20_000) })));
        setMode('password'); setChallenge(null);
        form.setFieldsValue({ code: '', password: '', newPassword: '', confirmPassword: '' });
        setNotice('密码已更新，所有旧登录已退出。请用新密码登录。');
      } else {
        await signIn(mode === 'password' ? { phone, method: 'password', password: values.password } : {
          phone, method: 'sms', challenge_id: challenge!.id, code: values.code,
          ...(mode === 'setup' ? { new_password: values.newPassword } : {}),
        });
      }
    } catch (err) {
      if (err instanceof AdminApiError && err.code === 'ADMIN_PASSWORD_SETUP_REQUIRED') {
        setMode('setup'); setNotice('手机号已验证。首次登录请设置密码，以后也可以用验证码登录。');
      } else { showError(err); }
    } finally { busy.current = false; setSubmitting(false); }
  };

  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: 'calc(100dvh - 16px)', boxSizing: 'border-box', background: '#f5f5f5', padding: 24 }}>
      <Card style={{ width: '100%', maxWidth: 420 }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>序事后台</Typography.Title>
        <Typography.Paragraph type="secondary">仅限已授权的管理员访问</Typography.Paragraph>
        {settingPassword ? <Typography.Title level={4}>{mode === 'setup' ? '设置登录密码' : '重设密码'}</Typography.Title> :
          <Tabs activeKey={mode} onChange={(next) => changeMode(next as Mode)} items={[{ key: 'sms', label: '验证码登录', disabled: sending || submitting }, { key: 'password', label: '密码登录', disabled: sending || submitting }]} />}
        {error && <Alert role="alert" type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
        {notice && <Alert role="status" type="info" showIcon message={notice} style={{ marginBottom: 16 }} />}
        <Form form={form} layout="vertical" onFinish={onFinish} disabled={submitting || sending} onValuesChange={(changed) => {
          if ('phone' in changed) { setChallenge(null); setError(null); setNotice(null); form.setFieldValue('code', ''); }
        }}>
          <Form.Item name="phone" label="手机号" rules={[{ required: true, message: '请输入管理员手机号' }, { pattern: /^1[3-9][0-9]{9}$/, message: '请输入 11 位手机号' }]}>
            <Input autoComplete="username" inputMode="tel" maxLength={11} readOnly={mode === 'setup'} autoFocus />
          </Form.Item>
          {requiresCode && <Form.Item name="code" label="验证码" hidden={mode === 'setup'} rules={[{ required: true, message: '请输入验证码' }, { pattern: /^\d{6}$/, message: '请输入 6 位验证码' }]}>
            <Input autoComplete="one-time-code" inputMode="numeric" maxLength={6} suffix={mode !== 'setup' ? <Button type="link" size="small" onClick={() => void sendCode()} disabled={remaining > 0 || !consent} loading={sending}>{remaining > 0 ? `${remaining} 秒后重发` : '获取验证码'}</Button> : undefined} />
          </Form.Item>}
          {mode === 'password' && <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}><Input.Password autoComplete="current-password" maxLength={128} /></Form.Item>}
          {settingPassword && <>
            <Form.Item name="newPassword" label="新密码" rules={[{ required: true, message: '请设置密码' }, { min: 12, max: 128, message: '密码需为 12–128 个字符' }, { validator: (_, value: string) => !value || value.trim() ? Promise.resolve() : Promise.reject(new Error('密码不能全为空格')) }]} extra="至少 12 个字符，建议使用密码管理器生成。">
              <Input.Password autoComplete="new-password" maxLength={128} />
            </Form.Item>
            <Form.Item name="confirmPassword" label="确认新密码" dependencies={['newPassword']} rules={[{ required: true, message: '请再次输入密码' }, { validator: (_, value: string) => !value || value === form.getFieldValue('newPassword') ? Promise.resolve() : Promise.reject(new Error('两次输入的密码不一致')) }]}><Input.Password autoComplete="new-password" maxLength={128} /></Form.Item>
          </>}
          {requiresCode && mode !== 'setup' && <div style={{ marginBottom: 20 }}><Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)}>我已了解手机号仅用于后台身份验证，验证码通过阿里云短信发送，并已阅读<a href="/legal/privacy" target="_blank" rel="noreferrer">隐私说明</a>。</Checkbox></div>}
          <Button type="primary" htmlType="submit" block loading={submitting}>{mode === 'reset' ? '确认重设密码' : mode === 'setup' ? '设置密码并登录' : '登录'}</Button>
        </Form>
        <Space style={{ marginTop: 16 }}><Button type="link" style={{ padding: 0 }} disabled={submitting || sending} onClick={() => changeMode(settingPassword ? 'sms' : 'reset')}>{settingPassword ? '返回登录' : '忘记密码'}</Button></Space>
      </Card>
    </main>
  );
}
