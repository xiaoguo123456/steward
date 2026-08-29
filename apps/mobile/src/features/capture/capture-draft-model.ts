import type { MediaKind } from '@steward/api-client';
import * as Crypto from 'expo-crypto';

export type CaptureDraftStatus =
  | 'editing'
  | 'waiting_for_network'
  | 'ready_for_upload'
  | 'uploading'
  | 'failed_retryable'
  | 'needs_user'
  | 'submitted';

export type CaptureDraftPart = {
  id: string;
  position: number;
  kind: MediaKind;
  uri: string;
  contentType: string;
  byteSize?: number;
  mediaId?: string;
  uploaded: boolean;
  grantIdempotencyKey: string;
  completeIdempotencyKey: string;
};

export type CaptureDraft = {
  id: string;
  accountId: string;
  status: CaptureDraftStatus;
  mode: 'text' | 'voice';
  intent?: string;
  projectId?: string;
  text: string;
  audioDuration?: number;
  parts: CaptureDraftPart[];
  createCaptureIdempotencyKey: string;
  captureId?: string;
  operationId?: string;
  error?: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
};

export function createCaptureDraft(
  accountId: string,
  input: Pick<CaptureDraft, 'mode'> & Partial<Pick<CaptureDraft, 'intent' | 'projectId'>>,
): CaptureDraft {
  const now = new Date().toISOString();
  return {
    id: `draft_${Crypto.randomUUID()}`,
    accountId,
    status: 'editing',
    mode: input.mode,
    intent: input.intent,
    projectId: input.projectId,
    text: '',
    parts: [],
    createCaptureIdempotencyKey: Crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
}

export function createDraftPart(
  input: Pick<CaptureDraftPart, 'kind' | 'uri' | 'contentType'> &
    Partial<Pick<CaptureDraftPart, 'byteSize' | 'position'>>,
): CaptureDraftPart {
  return {
    id: `part_${Crypto.randomUUID()}`,
    position: input.position ?? 0,
    kind: input.kind,
    uri: input.uri,
    contentType: input.contentType,
    byteSize: input.byteSize,
    uploaded: false,
    grantIdempotencyKey: Crypto.randomUUID(),
    completeIdempotencyKey: Crypto.randomUUID(),
  };
}

export function draftSummary(draft: CaptureDraft): string {
  if (draft.summary) return draft.summary;
  const text = draft.text.trim();
  if (text) return text;
  const audio = draft.parts.find((part) => part.kind === 'audio');
  if (audio && draft.audioDuration) {
    const minutes = Math.floor(draft.audioDuration / 60);
    const seconds = draft.audioDuration % 60;
    return `语音输入 ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  const images = draft.parts.filter((part) => part.kind === 'image').length;
  return images ? `${images} 张图片` : '未命名输入';
}

export function canResumeUpload(status: CaptureDraftStatus): boolean {
  return status === 'ready_for_upload' || status === 'uploading' || status === 'failed_retryable';
}
