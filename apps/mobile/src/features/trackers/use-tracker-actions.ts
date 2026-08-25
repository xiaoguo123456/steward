import {
  createTracker,
  deleteRecord,
  deleteTracker,
  errorMessage,
  updateRecord,
  updateTracker,
  type CreateTrackerRequest,
  type Record as TrackerRecord,
  type Tracker,
  type TrackerField,
  type TrackerFieldType,
  type UpdateRecordRequest,
  type UpdateTrackerRequest,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * Tracker 与 Record 的写操作。
 *
 * 内置的三个记录项（运动、专注、记账）由服务端按需创建并保有固定字段，
 * 改它们的字段会让历史记录读不出来，所以这里统一挡住——
 * 判断依据是 builtin_key，不是名字。
 */

/** 可用的字段类型，顺序按常用程度。 */
export const fieldTypeOptions: { type: TrackerFieldType; label: string; hint: string }[] = [
  { type: 'number', label: '数值', hint: '体重、步数这类可以比大小的数字' },
  { type: 'duration', label: '时长', hint: '按分钟记，不能为负' },
  { type: 'currency', label: '金额', hint: '收支金额' },
  { type: 'percentage', label: '百分比', hint: '0 到 100 之间' },
  { type: 'text', label: '文字', hint: '方式、心情这类说明' },
];

export const fieldTypeLabels: Record<TrackerFieldType, string> = {
  number: '数值',
  duration: '时长',
  currency: '金额',
  percentage: '百分比',
  text: '文字',
};

/** 内置记录项不允许改字段定义或删除。 */
export function isBuiltin(tracker: Tracker): boolean {
  return Boolean(tracker.builtin_key);
}

/** 把用户填的一行表单值转成契约里的 RecordValue。 */
export function toRecordValues(fields: TrackerField[], input: Record<string, string>) {
  return fields
    .filter((field) => (input[field.key] ?? '').trim().length > 0)
    .map((field) => {
      const raw = (input[field.key] ?? '').trim();
      // 数值字段只提交原始数值，单位换算由服务端负责。
      return field.type === 'text'
        ? { key: field.key, text_value: raw }
        : { key: field.key, number_value: Number(raw) };
    });
}

/** 把已有 Record 的值摊平成表单初值。 */
export function toFormValues(record: TrackerRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const value of record.values) {
    if (value.text_value !== undefined && value.text_value !== null) {
      out[value.key] = value.text_value;
    } else if (value.number_value !== undefined && value.number_value !== null) {
      out[value.key] = String(value.number_value);
    }
  }
  return out;
}

/**
 * 校验一条字段定义是否可以提交。
 *
 * 在客户端先拦一道不是为了替代服务端校验，而是为了让用户在填的时候
 * 就知道哪里不对——提交后再报错，他已经忘了自己刚才填了什么。
 */
export function validateFields(fields: TrackerField[]): string | null {
  if (fields.length === 0) return '至少需要一个字段。';
  const seen = new Set<string>();
  for (const field of fields) {
    if (!field.key.trim()) return '每个字段都要有标识。';
    if (!field.label.trim()) return '每个字段都要有名称。';
    if (seen.has(field.key)) return `字段标识「${field.key}」重复了。`;
    seen.add(field.key);
  }
  return null;
}

/**
 * 由字段名生成稳定标识。
 *
 * 中文名生成不出有意义的英文 key，这里退回按序号编号。
 * key 一旦发布就不能改：历史 Record 的值是按 key 存的。
 */
export function suggestFieldKey(label: string, index: number): string {
  const ascii = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return ascii || `field_${index + 1}`;
}

export function useTrackerActions() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      await queryClient.invalidateQueries();
      return true;
    } catch (error) {
      setFailure(errorMessage(error, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    failure,
    dismiss: () => setFailure(null),

    create: (body: CreateTrackerRequest) =>
      run(() => createTracker(body), '记录项没能创建。'),

    update: (tracker: Tracker, body: UpdateTrackerRequest) =>
      run(
        () => updateTracker(tracker.id, body, { headers: { 'If-Match': String(tracker.version) } }),
        '修改没能保存。',
      ),

    remove: (tracker: Tracker) => run(() => deleteTracker(tracker.id), '删除没能完成。'),

    updateRecord: (record: TrackerRecord, body: UpdateRecordRequest) =>
      run(
        () => updateRecord(record.id, body, { headers: { 'If-Match': String(record.version) } }),
        '这条记录没能保存。',
      ),

    removeRecord: (record: TrackerRecord) =>
      run(() => deleteRecord(record.id), '删除没能完成。'),
  };
}
