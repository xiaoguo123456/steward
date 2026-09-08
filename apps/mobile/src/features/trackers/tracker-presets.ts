import type { CreateTrackerRequest } from '@steward/api-client';

export type TrackerPreset = {
  id: string;
  name: string;
  hint: string;
  field: CreateTrackerRequest['fields'][number];
};

/** 常用模板只预填表单，用户点击保存后才成为自己的打卡。 */
export const trackerPresets: readonly TrackerPreset[] = [
  { id: 'weight', name: '体重', hint: '记录体重，查看变化', field: { key: 'weight_kg', label: '体重', type: 'number', unit: 'kg', required: true } },
  { id: 'water', name: '饮水', hint: '记下每次喝水量', field: { key: 'water_ml', label: '饮水量', type: 'number', unit: '毫升', required: true } },
  { id: 'sleep', name: '睡眠', hint: '记录每天睡了多久', field: { key: 'sleep_hours', label: '睡眠时长', type: 'number', unit: '小时', required: true } },
  { id: 'reading', name: '阅读', hint: '积累每天阅读时间', field: { key: 'reading_min', label: '阅读时长', type: 'duration', unit: '分钟', required: true } },
];

export function trackerPresetDraft(id?: string): CreateTrackerRequest | undefined {
  const preset = trackerPresets.find((item) => item.id === id);
  return preset ? { name: preset.name, fields: [{ ...preset.field }], schedule: { frequency: 'daily' } } : undefined;
}
