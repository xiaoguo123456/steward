import type { CaptureStatus, OperationStatus } from '@steward/api-client';

export type CaptureConversationPhase =
  | 'processing'
  | 'clarification'
  | 'confirmation'
  | 'partial_failure'
  | 'failure'
  | 'completed'
  | 'unavailable';

type CaptureConversationState = {
  captureStatus?: CaptureStatus;
  operationStatus?: OperationStatus;
  operationFailed?: boolean;
  captureFailed?: boolean;
};

/** 只根据服务端权威状态决定对话浮层当前阶段，不用本地计时器猜进度。 */
export function captureConversationPhase({
  captureFailed = false,
  captureStatus,
  operationFailed = false,
  operationStatus,
}: CaptureConversationState): CaptureConversationPhase {
  // Capture 已经进入需要用户决策的状态时，它比可能迟到或短暂失败的 Operation 查询更权威。
  if (captureStatus === 'awaiting_instruction') return 'clarification';
  if (captureStatus === 'needs_confirmation') return 'confirmation';
  if (captureStatus === 'partially_failed') return 'partial_failure';
  if (captureStatus === 'confirmed') return 'completed';
  if (captureStatus === 'failed' || captureStatus === 'discarded' || captureStatus === 'expired') {
    return 'failure';
  }
  if (operationFailed || operationStatus === 'failed' || operationStatus === 'cancelled') {
    return 'failure';
  }
  if (operationStatus === 'queued' || operationStatus === 'running') return 'processing';
  if (captureFailed && !captureStatus) return 'unavailable';
  if (
    captureStatus === 'draft'
    || captureStatus === 'submitting'
    || captureStatus === 'preprocessing'
    || captureStatus === 'parsing'
    || !captureStatus
  ) {
    return 'processing';
  }
  return 'unavailable';
}

export function captureProcessingCopy(status?: CaptureStatus): string {
  switch (status) {
    case 'submitting':
      return '正在安全提交你的输入…';
    case 'preprocessing':
      return '正在读取文字、语音或图片…';
    case 'parsing':
      return '正在整理可确认的结果…';
    default:
      return '正在理解你的输入…';
  }
}
