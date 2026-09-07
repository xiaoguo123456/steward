import type { OperationStatus } from '@steward/api-client';

/** 网络错误不能终止等待；只有服务端终态才能关闭轮询与刷新最终消息。 */
export function assistantOperationState(status: OperationStatus | undefined, queryFailed: boolean) {
  const settled = status === 'succeeded' || status === 'failed' || status === 'cancelled';
  return { settled, recovering: queryFailed && !settled };
}
