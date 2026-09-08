import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminRevokeUserSessions, getCsrfToken } from '@steward/admin-api-client';
import { SessionProvider, useSession } from '../session';
import { createQueryClient } from '../query-client';

function Consumer() {
  const { session } = useSession();
  return <><span>{session ? '已登录' : '未登录'}</span><button onClick={() => void adminRevokeUserSessions('usr_fixture', { expected_version: 1, reason_code: 'user_request', reason_text: '测试会话失效' }, { headers: { 'Idempotency-Key': 'fixture' } }).catch(() => {})}>执行</button></>;
}

afterEach(() => vi.unstubAllGlobals());
describe('后台会话失效', () => {
  it('直接管理写请求收到会话过期后退出并清除运营缓存', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: { username: 'fixture', csrf_token: 'fixture-csrf', environment: 'test', reporting_timezone: 'Asia/Shanghai', expires_at: '2099-09-08T12:00:00Z', absolute_expires_at: '2099-09-08T23:00:00Z' }, meta: { request_id: 'fixture' } }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'ADMIN_SESSION_EXPIRED', message: '请重新登录' }, meta: { request_id: 'fixture' } }), { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const client = createQueryClient();
    render(<QueryClientProvider client={client}><SessionProvider><Consumer /></SessionProvider></QueryClientProvider>);
    await screen.findByText('已登录');
    client.setQueryData(['private-users'], ['fixture']);
    fireEvent.click(screen.getByText('执行'));
    await waitFor(() => expect(screen.getByText('未登录')).toBeInTheDocument());
    expect(client.getQueryData(['private-users'])).toBeUndefined();
    expect(getCsrfToken()).toBe('');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
