import { App } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { UserDetailPage } from '../UserDetailPage';
import { adminSetUserBudget } from '@steward/admin-api-client';

vi.mock('@steward/admin-api-client', async (original) => {
 const real = await original<typeof import('@steward/admin-api-client')>();
 const query = (data: unknown) => ({ data: { status: 200, data }, isPending: false, isFetching: false, error: null, refetch: vi.fn() });
 return { ...real,
  useAdminGetUser: () => query({ data: { id:'usr_fixture', masked_phone:'199****0125', account_status:'active', initialized:true, timezone:'Asia/Shanghai', created_at:'2026-09-01T00:00:00Z', version:3, counts:{}, ai_budget:{daily_calls:50,monthly_calls:500} } }),
  useAdminGetUserUsage: () => query({data:[]}), useAdminGetUserCosts: () => query({data:[]}), useAdminGetUserOperations: () => query({data:[],page:{}}), useAdminGetUserAdminActions: () => query({data:[],page:{}}),
  adminSetUserBudget: vi.fn(),
 };
});

it('预算回填且结果未知时重试复用幂等键，提交期间阻止再次确认', async () => {
 let rejectRequest!: (error: Error) => void;
 vi.mocked(adminSetUserBudget).mockImplementationOnce(() => new Promise((_, reject) => { rejectRequest = reject; }));
 vi.mocked(adminSetUserBudget).mockRejectedValueOnce(new TypeError('网络异常'));
 render(<App><QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/users/usr_fixture']}><Routes><Route path="/users/:userId" element={<UserDetailPage />} /></Routes></MemoryRouter></QueryClientProvider></App>);
 fireEvent.click(screen.getByText('设置预算'));
 expect(screen.getByLabelText('每日调用上限')).toHaveValue('50');
 expect(screen.getByLabelText('每月调用上限')).toHaveValue('500');
 fireEvent.mouseDown(screen.getByLabelText('处置原因'));
 fireEvent.click(await screen.findByText('用户申请'));
 fireEvent.change(screen.getByLabelText('具体说明'), { target: { value:'本地预算验收说明' } });
 const confirm = screen.getByRole('button', {name:'确认执行'});
 fireEvent.click(confirm); fireEvent.click(confirm);
 await waitFor(() => expect(adminSetUserBudget).toHaveBeenCalledTimes(1));
 expect(screen.getByLabelText('每日调用上限')).toBeDisabled();
 rejectRequest(new TypeError('网络异常'));
 await waitFor(() => expect(screen.getByLabelText('每日调用上限')).not.toBeDisabled());
 fireEvent.click(confirm);
 await waitFor(() => expect(adminSetUserBudget).toHaveBeenCalledTimes(2));
 const calls = vi.mocked(adminSetUserBudget).mock.calls;
 expect(calls[0][2]?.headers).toEqual(calls[1][2]?.headers);
 expect(calls[1][1]).toMatchObject({expected_version:3,daily_calls:50,monthly_calls:500});
});
