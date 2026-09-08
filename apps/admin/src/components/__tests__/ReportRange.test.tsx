import { describe, expect, it } from 'vitest';
import { reportingRange } from '../ReportRange';

describe('报表日历范围', () => {
  it('同一时刻根据报表时区确定日期', () => {
    const now = new Date('2026-09-08T17:00:00Z');
    expect(reportingRange(7, 'Asia/Shanghai', now)).toEqual({ from: '2026-09-03', to: '2026-09-09' });
    expect(reportingRange(7, 'America/Los_Angeles', now)).toEqual({ from: '2026-09-02', to: '2026-09-08' });
  });
  it('跨夏令时仍覆盖指定数量的自然日', () => {
    expect(reportingRange(7, 'America/New_York', new Date('2026-03-09T02:00:00Z'))).toEqual({ from: '2026-03-02', to: '2026-03-08' });
  });
});
