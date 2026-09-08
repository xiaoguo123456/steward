import { Alert, Button, Empty, Skeleton, Typography } from 'antd';
import type { ReactNode } from 'react';
import { AdminApiError } from '@steward/admin-api-client';

/**
 * 页面的四种状态：加载中、失败、空、有数据。
 *
 * 每一页都要处理这四种。**失败时必须显示错误码与 request_id**——
 * 「加载失败」这四个字对排查毫无帮助，而带上这两个值就能直接查到日志。
 */
export function PageState({
  loading,
  error,
  empty,
  emptyText,
  onRetry,
  children,
}: {
  loading: boolean;
  error: unknown;
  empty?: boolean;
  emptyText?: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (loading) return <Skeleton active paragraph={{ rows: 6 }} />;

  if (error) {
    const api = error instanceof AdminApiError ? error : null;
    return (
      <Alert
        type="error"
        showIcon
        action={onRetry ? <Button onClick={onRetry}>重试</Button> : undefined}
        message={api?.message ?? '加载失败。'}
        description={
          <Typography.Text type="secondary" copyable={api ? { text: api.requestId } : false}>
            {api ? `${api.code} · ${api.requestId}` : String(error)}
          </Typography.Text>
        }
      />
    );
  }

  if (empty) {
    return <Empty description={emptyText ?? '暂无数据'} />;
  }

  return <>{children}</>;
}
