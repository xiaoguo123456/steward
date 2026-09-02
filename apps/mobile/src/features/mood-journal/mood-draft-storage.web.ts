const webDrafts = new Map<string, string>();

/** Web 预览只在内存保留敏感草稿，刷新后主动清空。 */
export async function readMoodDraft(key: string): Promise<string | null> {
  return webDrafts.get(key) ?? null;
}

export async function writeMoodDraft(key: string, value: string): Promise<void> {
  webDrafts.set(key, value);
}

export async function deleteMoodDraft(key: string): Promise<void> {
  webDrafts.delete(key);
}
