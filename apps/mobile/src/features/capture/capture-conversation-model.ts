import type { CapturePart, CaptureStatus, OperationStatus } from '@steward/api-client';

export type CaptureConversationPhase =
  | 'processing'
  | 'clarification'
  | 'confirmation'
  | 'partial_failure'
  | 'failure'
  | 'completed'
  | 'dismissed'
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
  if (captureStatus === 'discarded') return 'dismissed';
  if (captureStatus === 'failed' || captureStatus === 'expired') {
    return 'failure';
  }
  if (operationFailed || operationStatus === 'failed' || operationStatus === 'cancelled') {
    return 'failure';
  }
  if (operationStatus === 'queued' || operationStatus === 'running') return 'processing';
  if (captureFailed) return 'unavailable';
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

export type CapturePartStatusItem = {
  key: string;
  label: string;
  status: CapturePart['status'];
  errorMessage?: string;
};

/**
 * 处理中只展示用户能据此采取行动的状态。
 * 多轮澄清会产生多个文字 Part，但它们共同属于同一段文字上下文，不逐行制造重复噪音；
 * 图片仍逐张展示，因为失败时用户需要知道该重试或替换哪一张。
 */
export function capturePartStatusItems(parts: CapturePart[]): CapturePartStatusItem[] {
  const textParts = parts.filter((part) => part.kind === 'text');
  const textItem = textParts.length > 0 ? aggregateTextStatus(textParts) : null;
  const rows: CapturePartStatusItem[] = [];
  let insertedText = false;

  for (const part of parts) {
    if (part.kind === 'text') {
      if (!insertedText && textItem) rows.push(textItem);
      insertedText = true;
      continue;
    }
    rows.push({
      key: part.id,
      label: part.kind === 'audio' ? '语音' : `图片 ${part.position + 1}`,
      status: part.status,
      errorMessage: part.error?.message,
    });
  }
  return rows;
}

function aggregateTextStatus(parts: CapturePart[]): CapturePartStatusItem {
  const failed = parts.find((part) => part.status === 'failed');
  const processing = parts.find(
    (part) => part.status === 'pending' || part.status === 'processing',
  );
  const allIgnored = parts.every((part) => part.status === 'ignored');
  return {
    key: 'text-context',
    label: parts.length > 1 ? '文字与补充说明' : '文字',
    status: failed ? 'failed' : processing?.status ?? (allIgnored ? 'ignored' : 'succeeded'),
    errorMessage: failed?.error?.message,
  };
}
