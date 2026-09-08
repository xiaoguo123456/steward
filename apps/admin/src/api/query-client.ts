import { QueryClient } from '@tanstack/react-query';
import { AdminApiError } from '@steward/admin-api-client';

/**
 * 后台的查询客户端。
 *
 * **不持久化缓存。** 后台每一行都是跨用户的运营数据，
 * 落到磁盘就等于在每台用过后台的机器上留了一份副本。
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 后台数据本身有聚合延迟，前端再叠一层长缓存只会让人更困惑。
        staleTime: 30_000,
        retry: (failureCount, error) => {
          // 会话失效重试多少次都是失效，重试只会拖慢跳转。
          if (error instanceof AdminApiError && error.isSessionExpired) {
            return false;
          }
          // 4xx 是请求本身的问题，重试不会变对。
          if (error instanceof AdminApiError && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        // 写操作**一律不自动重试**：它们有幂等键，但自动重试会让
        // 「用户到底点了几次」变得说不清楚。失败了让人自己决定要不要再来一次。
        retry: false,
      },
    },
  });
}
