import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApiError, adminLoginBodySchema, adminLoginResponseSchema, adminPhoneCodeBodySchema, adminPhoneCodeResponseSchema, adminResetPasswordBodySchema } from '@steward/admin-api-client';
import fixture from '../../../../../packages/contracts/fixtures/admin-auth.flow.json';
import { LoginPage } from '../LoginPage';

const mock = vi.hoisted(() => ({ signIn: vi.fn(), send: vi.fn(), reset: vi.fn() }));
vi.mock('@/api/session', () => ({ useSession: () => ({ signIn: mock.signIn }) }));
vi.mock('@steward/admin-api-client', async (original) => ({ ...await original<object>(), adminRequestPhoneCode: mock.send, adminResetPassword: mock.reset }));
beforeEach(() => {
  vi.clearAllMocks();
  mock.send.mockResolvedValue({ status: 200, data: fixture.phone_code_response });
  mock.reset.mockResolvedValue({ status: 200, data: { meta: { request_id: 'fixture' } } });
  mock.signIn.mockResolvedValue(undefined);
});
async function requestCode() {
  fireEvent.change(screen.getByLabelText('手机号'), { target: { value: fixture.phone_code_request.phone } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: '获取验证码' }));
  await waitFor(() => expect(mock.send).toHaveBeenCalledTimes(1));
  await screen.findByText(/将收到验证码/);
  fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } });
}

describe('后台手机号登录', () => {
  it('正式 Fixture 符合生成契约，旧用户名请求和缺失会话字段被拒绝', () => {
    expect(adminPhoneCodeBodySchema.safeParse(fixture.phone_code_request).success).toBe(true);
    expect(adminPhoneCodeResponseSchema.safeParse(fixture.phone_code_response).success).toBe(true);
    expect(adminLoginBodySchema.safeParse(fixture.sms_login_request).success).toBe(true);
    expect(adminLoginBodySchema.safeParse(fixture.password_login_request).success).toBe(true);
    expect(adminResetPasswordBodySchema.safeParse(fixture.reset_request).success).toBe(true);
    expect(adminLoginResponseSchema.safeParse(fixture.session_response).success).toBe(true);
    expect(adminLoginBodySchema.safeParse({ username: 'admin', password: 'old' }).success).toBe(false);
    expect(adminLoginResponseSchema.safeParse({ data: { username: 'admin' } }).success).toBe(false);
  });
  it('未主动确认时不发送短信；首次验证后递进显示设密表单', async () => {
    mock.signIn.mockRejectedValueOnce(new AdminApiError(428, 'ADMIN_PASSWORD_SETUP_REQUIRED', '请设置密码', 'fixture'));
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: '获取验证码' })).toBeDisabled();
    expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument();
    await requestCode();
    fireEvent.click(screen.getByRole('button', { name: '登 录' }));
    await screen.findByRole('heading', { name: '设置登录密码' });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'fixture-new-password-only' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'mismatched-password' } });
    fireEvent.click(screen.getByRole('button', { name: '设置密码并登录' }));
    await screen.findByText('两次输入的密码不一致');
    expect(mock.signIn).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'fixture-new-password-only' } });
    fireEvent.click(screen.getByRole('button', { name: '设置密码并登录' }));
    await waitFor(() => expect(mock.signIn).toHaveBeenCalledTimes(2));
    expect(mock.signIn.mock.calls[1][0]).toMatchObject({ ...fixture.sms_login_request, new_password: 'fixture-new-password-only' });
  });
  it('找回流程使用独立验证码用途，成功后回到密码登录', async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: '忘记密码' }));
    await requestCode();
    expect(mock.send.mock.calls[0][0].purpose).toBe('password_reset');
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'fixture-new-password-only' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'fixture-new-password-only' } });
    fireEvent.click(screen.getByRole('button', { name: '确认重设密码' }));
    await screen.findByText(/密码已更新，所有旧登录已退出/);
    expect(screen.getByLabelText('密码')).toHaveValue('');
    expect(mock.reset).toHaveBeenCalledTimes(1);
    expect(mock.signIn).not.toHaveBeenCalled();
  });
  it('切换手机号后不能继续使用上一个挑战', async () => {
    render(<LoginPage />); await requestCode();
    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '19900000902' } });
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: '登 录' }));
    await screen.findByText('请先获取本次操作的验证码。');
    expect(mock.signIn).not.toHaveBeenCalled();
  });
});
