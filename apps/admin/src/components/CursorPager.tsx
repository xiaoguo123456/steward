import { Button, Space } from 'antd';
import { useState } from 'react';

export function useCursorPages() {
  const [cursors, setCursors] = useState<string[]>([]);
  return {
    cursor: cursors.at(-1),
    page: cursors.length + 1,
    previous: () => setCursors(c => c.slice(0, -1)),
    next: (cursor: string) => setCursors(c => [...c, cursor]),
    reset: () => setCursors([]),
  };
}

export function CursorPager({ paging, nextCursor, loading }: { paging: ReturnType<typeof useCursorPages>; nextCursor?: string | null; loading: boolean }) {
  return <Space style={{ marginTop: 12 }}>
    <Button disabled={loading || paging.page === 1} onClick={paging.previous}>上一页</Button>
    <span>第 {paging.page} 页</span>
    <Button disabled={loading || !nextCursor} onClick={() => { if (nextCursor) paging.next(nextCursor); }}>下一页</Button>
  </Space>;
}
