const webDrafts = new Map<string, string>();

/**
 * Web 没有与系统钥匙串等价的保护，只在当前页面进程内保留草稿。
 * 刷新页面会清空，避免把心情正文写入 localStorage 或 sessionStorage。
 */
export async function readMoodDraft(key: string): Promise<string | null> {
  return webDrafts.get(key) ?? null;
}

export async function writeMoodDraft(key: string, value: string): Promise<void> {
  webDrafts.set(key, value);
}

export async function deleteMoodDraft(key: string): Promise<void> {
  webDrafts.delete(key);
}
