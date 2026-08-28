import type { CreateCaptureRequest, MediaKind } from '@steward/api-client';

type UploadedMediaRef = {
  mediaId: string;
  kind: MediaKind;
};

/** AI 对话中的图片继续进入统一 Capture，顺序与用户预览保持一致。 */
export function buildAssistantCaptureParts(
  text: string,
  uploaded: UploadedMediaRef[],
): CreateCaptureRequest['parts'] {
  const parts: CreateCaptureRequest['parts'] = [];
  const content = text.trim();
  if (content) parts.push({ kind: 'text', text: content });
  for (const item of uploaded) {
    parts.push({ kind: item.kind, media_id: item.mediaId });
  }
  return parts;
}

export function assistantCaptureDraftSummary(text: string, imageCount: number): string {
  const content = text.trim();
  if (content) return content;
  return `${imageCount} 张图片`;
}
