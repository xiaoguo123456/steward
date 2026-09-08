import { Button, Input, Select, Space, Typography } from 'antd';
import { useState } from 'react';
import { useSession } from '@/api/session';

export type ReportRangeValue = { from: string; to: string };

/** 按报表时区生成自然日范围，避免浏览器所在地改变统计口径。 */
export function reportingRange(days: number, timezone: string, now = new Date()): ReportRangeValue {
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const to = `${part('year')}-${part('month')}-${part('day')}`;
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { from: start.toISOString().slice(0, 10), to };
}

export function useReportRange() {
  const { session } = useSession();
  const timezone = session?.reporting_timezone || 'Asia/Shanghai';
  const [range, setRange] = useState(() => reportingRange(30, timezone));
  return { range, setRange, timezone };
}

export function ReportRange({ value, onChange, timezone }: { value: ReportRangeValue; onChange: (range: ReportRangeValue) => void; timezone: string }) {
  const [draft, setDraft] = useState(value);
  const apply = (next: ReportRangeValue) => { setDraft(next); onChange(next); };
  const invalid = !draft.from || !draft.to || draft.from > draft.to || (Date.parse(draft.to) - Date.parse(draft.from)) / 86400000 > 365;
  return <Space wrap>
    <Select aria-label="统计时间范围" placeholder="快捷时间" style={{ width: 130 }} value={null} options={[{ value: 1, label: '今天' }, { value: 7, label: '近 7 天' }, { value: 30, label: '近 30 天' }, { value: 90, label: '近 90 天' }]} onChange={(days: number | null) => { if (days !== null) apply(reportingRange(days, timezone)); }} />
    <Input aria-label="开始日期" type="date" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} />
    <span>至</span>
    <Input aria-label="结束日期" type="date" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} />
    <Button disabled={invalid} onClick={() => apply(draft)}>应用</Button>
    <Typography.Text type="secondary">{timezone}{invalid ? ' · 请选择有效日期范围（最多 366 天）' : ''}</Typography.Text>
  </Space>;
}
