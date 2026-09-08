import {
  completeMediaUpload,
  createCapture,
  createUploadGrants,
  getMediaAsset,
  isApiError,
  renewMediaUploadGrant,
  type CreateCaptureRequest,
  type UploadGrant,
} from '@steward/api-client';
import { File } from 'expo-file-system';

import {
  getCaptureDraft,
  releaseCaptureDraftFiles,
  saveCaptureDraft,
} from './capture-draft-store';
import { canResumeUpload, draftSummary, type CaptureDraft } from './capture-draft-model';
import { putBytes } from './use-media-upload';

const running = new Map<string, Promise<CaptureDraft>>();

/**
 * 恢复一个已经由用户确认上传的草稿。
 *
 * 所有幂等键和 media_id 都先落本地再发下一步；短期签名 URL 从不持久化。
 * 同一草稿的并发恢复会合并为一个 Promise，避免重复直传。
 */
export function processCaptureDraft(accountId: string, draftId: string): Promise<CaptureDraft> {
  const key = `${accountId}:${draftId}`;
  const active = running.get(key);
  if (active) return active;

  const task = run(accountId, draftId).finally(() => running.delete(key));
  running.set(key, task);
  return task;
}

async function run(accountId: string, draftId: string): Promise<CaptureDraft> {
  let draft = await requireDraft(accountId, draftId);
  if (!canResumeUpload(draft.status)) {
    throw new Error('这份草稿尚未确认上传');
  }
  draft = await update(accountId, { ...draft, status: 'uploading', error: undefined });

  try {
    for (let index = 0; index < draft.parts.length; index += 1) {
      let part = draft.parts[index];
      let grant: UploadGrant | null = null;
      if (part.mediaId) {
        const asset = await getMediaAsset(part.mediaId);
        if (asset.data.status === 'uploaded') {
          part = { ...part, uploaded: true };
          draft = await replacePart(accountId, draft, index, part);
          continue;
        }
        grant = (
          await renewMediaUploadGrant(part.mediaId, {
            headers: { 'Idempotency-Key': part.grantIdempotencyKey },
          })
        ).data;
      } else {
        grant = (
          await createUploadGrants(
            {
              items: [{
                kind: part.kind,
                content_type: part.contentType,
                byte_size: part.byteSize ?? null,
              }],
            },
            { headers: { 'Idempotency-Key': part.grantIdempotencyKey } },
          )
        ).data[0];
        part = { ...part, mediaId: grant.media_id };
        draft = await replacePart(accountId, draft, index, part);
      }

      const file = new File(part.uri);
      if (!file.exists) {
        throw new MissingLocalFileError(`第 ${index + 1} 个本地文件已不存在，请重新选择。`);
      }

      const byteSize = await putBytes(grant, {
        uri: part.uri,
        kind: part.kind,
        contentType: part.contentType,
        byteSize: part.byteSize,
      });
      await completeMediaUpload(
        grant.media_id,
        { byte_size: byteSize },
        { headers: { 'Idempotency-Key': part.completeIdempotencyKey } },
      );
      part = { ...part, mediaId: grant.media_id, uploaded: true };
      draft = await replacePart(accountId, draft, index, part);
    }

    const response = await createCapture(
      captureRequest(draft),
      { headers: { 'Idempotency-Key': draft.createCaptureIdempotencyKey } },
    );
    draft = await update(accountId, {
      ...draft,
      status: 'submitted',
      summary: draftSummary(draft),
      captureId: response.data.resource_id ?? undefined,
      operationId: response.data.operation_id,
      error: undefined,
    });
    await releaseCaptureDraftFiles(accountId, draft.id);
    draft = await update(accountId, {
      ...draft,
      parts: draft.parts.map((part) => ({ ...part, uri: '' })),
    });
    return draft;
  } catch (error) {
    const current = await requireDraft(accountId, draftId);
    const failed = await update(accountId, {
      ...current,
      status: error instanceof MissingLocalFileError || (isApiError(error) && !error.retryable)
        ? 'needs_user'
        : 'failed_retryable',
      error: error instanceof Error ? error.message : '上传未完成，请稍后重试。',
    });
    throw Object.assign(error instanceof Error ? error : new Error(failed.error), { draft: failed });
  }
}

function captureRequest(draft: CaptureDraft): CreateCaptureRequest {
  const content = draft.text.trim();
  const parts: CreateCaptureRequest['parts'] = [];
  if (draft.intent === 'trip') {
    parts.push({ kind: 'text', text: content ? `创建行程：${content}` : '创建行程。' });
  } else if (draft.intent === 'tracker') {
    parts.push({ kind: 'text', text: content ? `新建打卡：${content}` : '请根据我的描述新建打卡，先让我确认名称、字段与频率。' });
  } else if (draft.intent === 'ledger') {
    parts.push({
      kind: 'text',
      text: content
        ? `请整理为记账记录：${content}`
        : '请将本次输入整理为需要我确认的记账记录。',
    });
  } else if (content) {
    parts.push({ kind: 'text', text: content });
  }
  for (const part of draft.parts) {
    if (!part.mediaId || !part.uploaded) throw new Error('媒体尚未上传完成');
    parts.push({ kind: part.kind, media_id: part.mediaId });
  }
  return {
    origin: draft.intent === 'trip' || draft.intent === 'trip_item'
      ? 'project_manager'
      : draft.intent === 'ledger' || draft.intent === 'tracker'
        ? 'tracker'
        : 'home',
    parts,
    suggested_project_id: draft.intent === 'trip_item' ? draft.projectId : undefined,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

async function requireDraft(accountId: string, draftId: string): Promise<CaptureDraft> {
  const draft = await getCaptureDraft(accountId, draftId);
  if (!draft) throw new Error('草稿不存在或不属于当前账号');
  return draft;
}

async function replacePart(
  accountId: string,
  draft: CaptureDraft,
  index: number,
  part: CaptureDraft['parts'][number],
): Promise<CaptureDraft> {
  const parts = [...draft.parts];
  parts[index] = part;
  return update(accountId, { ...draft, parts });
}

async function update(accountId: string, draft: CaptureDraft): Promise<CaptureDraft> {
  const next = { ...draft, updatedAt: new Date().toISOString() };
  await saveCaptureDraft(accountId, next);
  return next;
}

export function captureDraftLabel(draft: CaptureDraft): string {
  return draftSummary(draft);
}

class MissingLocalFileError extends Error {}
