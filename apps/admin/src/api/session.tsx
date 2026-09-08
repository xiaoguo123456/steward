import {
  adminGetSession,
  onAdminSessionExpired,
  adminLogin,
  adminLogout,
  clearCsrfToken,
  setCsrfToken,
  unwrap,
  type AdminSession,
} from '@steward/admin-api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';

/**
 * 后台会话。
 *
 * 会话令牌本身在 HttpOnly Cookie 里，前端**读不到也不该读**。
 * 这里保存的只是「当前登录的是谁」与 CSRF Token——后者必须能被
 * JavaScript 读到（要放进请求头），因此存在内存里，
 * 不进 localStorage：那里的东西任何脚本都读得到，刷新页面也还在。
 */
type SessionState = {
  session: AdminSession | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** 会话失效时调用：清缓存并回到登录页。 */
  invalidate: () => void;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const apply = useCallback((next: AdminSession | null) => {
    setSession(next);
    if (next) {
      setCsrfToken(next.csrf_token);
    } else {
      clearCsrfToken();
    }
  }, []);

  const invalidate = useCallback(() => {
    apply(null);
    // **必须清空全部缓存。** 后台看的是跨用户的运营数据，
    // 留着上一个会话的缓存，下一次登录会先看到一屏旧数字，
    // 而那些数字看起来和新数据一模一样。
    queryClient.clear();
  }, [apply, queryClient]);

  useEffect(() => onAdminSessionExpired(invalidate), [invalidate]);

  // 启动时问一次服务端：Cookie 还在不在。
  useEffect(() => {
    let cancelled = false;
    adminGetSession()
      .then((res) => {
        if (!cancelled) apply(unwrap(res)?.data ?? null);
      })
      .catch(() => {
        if (!cancelled) apply(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const res = await adminLogin({ username, password });
      apply(unwrap(res)?.data ?? null);
      queryClient.clear();
    },
    [apply, queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await adminLogout();
    } finally {
      invalidate();
    }
  }, [invalidate]);

  return (
    <SessionContext.Provider value={{ session, loading, signIn, signOut, invalidate }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession 必须在 SessionProvider 内使用');
  return value;
}
