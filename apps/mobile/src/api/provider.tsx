import { isApiError, isUnauthenticated } from '@steward/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';

import { initApiClient, session } from './session';
import { syncDeviceTimezone } from './timezone-sync';

/** 构造 Query Client。 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 服务端事实的缓存时间保持较短：Today 与清单的正确性比省一次请求更重要。
        staleTime: 30_000,
        retry: (failureCount, error) => {
          // 只重试服务端明确标记可重试的错误，避免把校验失败反复打过去。
          if (isApiError(error)) {
            return error.retryable && failureCount < 2;
          }
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** 应用启动状态。 */
export type BootState = 'loading' | 'signed-in' | 'signed-out';

const BootContext = createContext<BootState>('loading');

/**
 * API Provider。
 *
 * 它负责初始化 Client、恢复登录态、在登录失效时清空缓存，
 * 以及在应用回到前台时刷新服务端事实。
 */
export function ApiProvider({ children }: PropsWithChildren) {
  const queryClient = useMemo(() => createQueryClient(), []);
  const [boot, setBoot] = useState<BootState>('loading');
  const timezoneSync = useRef<Promise<void> | null>(null);
  const router = useRouter();

  const syncTimezone = useCallback(() => {
    if (timezoneSync.current) return timezoneSync.current;

    const run = syncDeviceTimezone()
      .then((changed) => {
        if (changed) void queryClient.invalidateQueries();
      })
      .catch(() => {
        // 离线或服务端失败时继续使用旧时区；下次回到前台会再次尝试。
      })
      .finally(() => {
        timezoneSync.current = null;
      });
    timezoneSync.current = run;
    return run;
  }, [queryClient]);

  useEffect(() => {
    initApiClient();
    let cancelled = false;
    void session.restore().then((loggedIn) => {
      if (!cancelled) {
        setBoot(loggedIn ? 'signed-in' : 'signed-out');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return session.subscribe((loggedIn) => {
      setBoot(loggedIn ? 'signed-in' : 'signed-out');
      if (!loggedIn) {
        // 退出登录后必须清空缓存，避免下一个账号看到上一个账号的数据。
        queryClient.clear();
        router.replace('/login');
      }
    });
  }, [queryClient, router]);

  useEffect(() => {
    if (boot === 'signed-in') void syncTimezone();
  }, [boot, syncTimezone]);

  useEffect(() => {
    // 回到前台时刷新服务端事实，避免展示过期的 Today。
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && session.isLoggedIn()) {
        void syncTimezone().finally(() => queryClient.invalidateQueries());
      }
    });
    return () => subscription.remove();
  }, [queryClient, syncTimezone]);

  useEffect(() => {
    // 任何查询遇到登录失效都统一跳回登录页。
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (
        session.isLoggedIn() &&
        event.type === 'updated' &&
        isUnauthenticated(event.query.state.error)
      ) {
        void session.signOut();
      }
    });
    return () => {
      unsubscribe();
    };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <BootContext.Provider value={boot}>{children}</BootContext.Provider>
    </QueryClientProvider>
  );
}

/** 读取应用启动与登录状态。 */
export function useBootState(): BootState {
  return useContext(BootContext);
}
