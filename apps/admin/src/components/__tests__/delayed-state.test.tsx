import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import useDebounce from 'antd/es/form/hooks/useDebounce';

// 覆盖锁定版本组件库的真实表单延迟路径，防止卸载后继续更新已销毁的页面。
it('表单卸载时清理尚未执行的延迟更新', () => {
  vi.useFakeTimers();
  try {
    const { rerender, unmount } = renderHook(({ values }) => useDebounce(values), {
      initialProps: { values: ['校验提示'] },
    });
    act(() => vi.runOnlyPendingTimers());
    rerender({ values: [] });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
