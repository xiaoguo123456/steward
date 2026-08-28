import {
  errorMessage,
  logout,
  updateCurrentUser,
  updateUserPreferences,
  useGetCurrentUser,
  useGetUserPreferences,
  type UpdateUserPreferencesRequest,
  type UpdateUserRequest,
  type UserPreferences,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { session } from '@/api/session';

/**
 * 账号与偏好的数据层。
 *
 * 这一页此前整页都是写死的假数据（“张明 / zhangming@example.com”），
 * 看起来像账号信息，实际和登录的人无关。现在契约支持什么就显示什么，
 * 不支持的就不摆在那儿——一个拨不动的开关比没有开关更糟。
 */

/** 当前用户。 */
export function useCurrentUser() {
  const query = useGetCurrentUser();
  return {
    user: query.data?.data,
    loading: query.isPending,
    failed: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

/** 使用偏好。 */
export function useUserPreferences() {
  const query = useGetUserPreferences();
  return {
    preferences: query.data?.data,
    loading: query.isPending,
    failed: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

/** 头像占位用的首字。空名字时不显示一个孤零零的问号。 */
export function avatarInitial(displayName: string | undefined): string {
  const name = (displayName ?? '').trim();
  return name ? [...name][0] : '·';
}

/** 偏好摘要，用在入口行的副标题上。 */
export function preferencesSummary(preferences: UserPreferences | undefined): string {
  if (!preferences) return '';
  const week = preferences.week_start === 'sunday' ? '周日起' : '周一起';
  return `${week} · ${preferences.work_day_start}—${preferences.work_day_end}`;
}

export function useAccountActions() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      await queryClient.invalidateQueries();
      return true;
    } catch (error) {
      setFailure(errorMessage(error, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    failure,
    dismiss: () => setFailure(null),

    updateProfile: (body: UpdateUserRequest) =>
      run(() => updateCurrentUser(body), '资料没能保存。'),

    updatePreferences: (body: UpdateUserPreferencesRequest) =>
      run(() => updateUserPreferences(body), '偏好没能保存。'),

    /**
     * 退出登录。
     *
     * 先让服务端作废 Refresh Token，再清本地会话与全部缓存。
     * 缓存必须清：不清的话下一个登录的账号会先看到上一个人的数据。
     * 服务端那一步失败也照样退出——本地留着一个用户已经想丢掉的会话更糟。
     */
    signOut: async () => {
      setBusy(true);
      setFailure(null);
      try {
        await logout().catch(() => undefined);
      } finally {
        await session.signOut();
        queryClient.clear();
        setBusy(false);
      }
    },
  };
}
