import type { LocalMedia } from './use-media-upload';
import {
  createDraftPart,
  type CaptureDraft,
  type CaptureDraftPart,
} from './capture-draft-model';

// Web H5 不承载 Capture 核心离线流程；使用仅当前页面生命周期有效的内存实现，
// 避免在浏览器 localStorage 中留下用户正文或媒体 URI。
const drafts = new Map<string, CaptureDraft>();

export async function saveCaptureDraft(accountId: string, draft: CaptureDraft): Promise<void> {
  assertAccount(accountId, draft);
  drafts.set(draft.id, structuredClone(draft));
}

export async function getCaptureDraft(accountId: string, draftId: string): Promise<CaptureDraft | null> {
  const draft = drafts.get(draftId);
  return draft?.accountId === accountId ? structuredClone(draft) : null;
}

export async function listCaptureDrafts(accountId: string): Promise<CaptureDraft[]> {
  return [...drafts.values()]
    .filter((draft) => draft.accountId === accountId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((draft) => structuredClone(draft));
}

export async function persistDraftMedia(
  accountId: string,
  draftId: string,
  item: LocalMedia,
  position: number,
): Promise<CaptureDraftPart> {
  if (!accountId || !draftId) throw new Error('保存媒体前必须确定账号与草稿');
  return createDraftPart({ ...item, position });
}

export async function deleteCaptureDraft(accountId: string, draftId: string): Promise<void> {
  const draft = drafts.get(draftId);
  if (draft?.accountId === accountId) drafts.delete(draftId);
}

export async function releaseCaptureDraftFiles(_accountId: string, _draftId: string): Promise<void> {
  // Web 实现不持久化文件。
}

export async function deleteAccountCaptureDrafts(accountId: string): Promise<void> {
  for (const [id, draft] of drafts) {
    if (draft.accountId === accountId) drafts.delete(id);
  }
}

function assertAccount(accountId: string, draft: CaptureDraft) {
  if (!accountId || draft.accountId !== accountId) {
    throw new Error('拒绝跨账号读写 Capture 草稿');
  }
}
