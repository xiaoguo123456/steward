type CursorPage<T> = {
  data: T[];
  page: { next_cursor?: string | null };
};

/** 按服务端不透明游标收集记录；默认只取一页，需要完整统计时显式开启。 */
export async function collectCursorPages<T>(
  loadPage: (cursor?: string) => Promise<CursorPage<T>>,
  loadAll = false,
): Promise<T[]> {
  const rows: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  while (true) {
    const response = await loadPage(cursor);
    rows.push(...response.data);

    const nextCursor = response.page.next_cursor ?? undefined;
    if (!loadAll || !nextCursor) return rows;
    if (seenCursors.has(nextCursor)) {
      throw new Error('记录分页游标重复，已停止继续加载。');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}
