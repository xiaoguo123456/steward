import {
  errorMessage,
  createRecord,
  type Record as TrackerRecord,
  type Tracker,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { ModalSheet } from '@/components/ui/modal-sheet';
import {
  toFormValues,
  toRecordValues,
  useTrackerActions,
} from '@/features/trackers/use-tracker-actions';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * Record 录入与编辑（设计说明 13.4、11.6）。
 *
 * 新建和编辑共用一套表单：字段由 Tracker Schema 渲染，
 * 发生时间默认当前但必须可改——补记昨天的体重是常事。
 *
 * 编辑已有记录时按当前 Schema 渲染。Schema 里被删掉的历史字段仍会显示，
 * 否则用户会在不知情的情况下把它们抹掉。
 */
export function RecordSheet({
  tracker,
  record,
  onClose,
  onSaved,
}: {
  tracker: Tracker;
  /** 传入时是编辑，不传是新建。 */
  record?: TrackerRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const actions = useTrackerActions();

  const [values, setValues] = useState<Record<string, string>>(() =>
    record ? toFormValues(record) : {},
  );
  const [timestamp, setTimestamp] = useState(() =>
    localInputValue(record ? new Date(record.timestamp) : new Date()),
  );
  const [note, setNote] = useState(record?.note ?? '');
  const [creating, setCreating] = useState(false);
  const [createFailure, setCreateFailure] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  // 当前 Schema 加上这条记录里出现过、但 Schema 已经不再包含的字段。
  const fields = [...tracker.fields];
  if (record) {
    for (const value of record.values) {
      if (!fields.some((field) => field.key === value.key)) {
        fields.push({ key: value.key, label: value.key, type: 'text', required: false });
      }
    }
  }

  const requiredFilled = fields
    .filter((field) => field.required)
    .every((field) => (values[field.key] ?? '').trim().length > 0);

  const parsedTime = parseLocalInput(timestamp);
  const timeInvalid = parsedTime === null;
  const busy = actions.busy || creating;

  const save = async () => {
    if (!requiredFilled || timeInvalid || busy) return;

    if (record) {
      const done = await actions.updateRecord(record, {
        timestamp: parsedTime.toISOString(),
        values: toRecordValues(fields, values),
        ...(note.trim() ? { note: note.trim() } : { clear: ['note'] as const }),
      });
      if (done) onSaved();
      return;
    }

    setCreating(true);
    setCreateFailure(null);
    try {
      await createRecord({
        tracker_id: tracker.id,
        timestamp: parsedTime.toISOString(),
        values: toRecordValues(fields, values),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      await queryClient.invalidateQueries();
      onSaved();
    } catch (error) {
      setCreateFailure(errorMessage(error, '保存失败，请检查填写内容。'));
    } finally {
      setCreating(false);
    }
  };

  if (removing && record) {
    return (
      <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
        <ModalSheet onClose={onClose}>
          <View style={styles.sheet}>
            <Text accessibilityRole="header" style={styles.title}>
              删除这条记录
            </Text>
            <Text style={styles.copy}>
              删除后它会进入最近删除，统计里也不再计入这条。
            </Text>
            {actions.failure ? <Text style={styles.failure}>{actions.failure}</Text> : null}
            <View style={styles.actions}>
              <AppButton
                disabled={busy}
                label={busy ? '正在删除…' : '删除记录'}
                onPress={async () => {
                  if (await actions.removeRecord(record)) onSaved();
                }}
                variant="danger"
              />
              <AppButton label="取消" onPress={() => setRemoving(false)} variant="text" />
            </View>
          </View>
        </ModalSheet>
      </Modal>
    );
  }

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <ModalSheet maxHeight="86%" onClose={onClose}>
        <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={styles.title}>
            {record ? `编辑${tracker.name}记录` : `记录${tracker.name}`}
          </Text>

          {fields.map((field) => (
            <View key={field.key} style={styles.field}>
              <Text style={styles.fieldLabel}>
                {field.label}
                {field.unit ? `（${field.unit}）` : ''}
                {field.required ? ' *' : ''}
              </Text>
              <TextInput
                accessibilityLabel={field.label}
                keyboardType={field.type === 'text' ? 'default' : 'decimal-pad'}
                onChangeText={(text) => setValues((current) => ({ ...current, [field.key]: text }))}
                placeholder={field.type === 'text' ? '请输入内容' : '请输入数值'}
                placeholderTextColor={colors.textTertiary}
                style={styles.input}
                value={values[field.key] ?? ''}
              />
              {/* 3.7 与 3.7% 很容易混。百分比字段把归一化结果直接显示出来。 */}
              {field.type === 'percentage' && values[field.key] ? (
                <Text style={styles.fieldHint}>记为 {values[field.key].trim()}%</Text>
              ) : null}
            </View>
          ))}

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>发生时间</Text>
            <TextInput
              accessibilityLabel="发生时间"
              autoCapitalize="none"
              onChangeText={setTimestamp}
              placeholder="2026-08-19 09:30"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              value={timestamp}
            />
            {timeInvalid ? (
              <Text style={styles.failure}>时间格式应为 2026-08-19 09:30。</Text>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>备注</Text>
            <TextInput
              accessibilityLabel="备注"
              maxLength={200}
              onChangeText={setNote}
              placeholder="选填"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              value={note}
            />
          </View>

          {createFailure ? <Text style={styles.failure}>{createFailure}</Text> : null}
          {actions.failure ? <Text style={styles.failure}>{actions.failure}</Text> : null}

          <View style={styles.actions}>
            <AppButton
              disabled={!requiredFilled || timeInvalid || busy}
              label={busy ? '保存中…' : record ? '保存修改' : '保存记录'}
              onPress={() => void save()}
            />
            {record ? (
              <Pressable
                accessibilityLabel="删除这条记录"
                accessibilityRole="button"
                onPress={() => setRemoving(true)}
                style={({ pressed }) => [styles.deleteRow, pressed && styles.pressed]}
              >
                <Text style={styles.deleteText}>删除记录</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </ModalSheet>
    </Modal>
  );
}

/**
 * 本地时间的输入与解析。
 *
 * 用「2026-08-19 09:30」这种当地写法，不用 ISO：
 * 用户看到的时间就是他所在时区的时间，带 Z 的字符串只会让人算不清。
 * 提交时再转回 ISO 交给服务端。
 */
function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function parseLocalInput(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  // 2026-02-31 这类日期 Date 会自动进位，回读一次才发现它根本不存在。
  if (date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
  return date;
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  title: {
    marginBottom: 14,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  copy: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  field: {
    marginBottom: 14,
    gap: 6,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  fieldHint: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  input: {
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  actions: {
    marginTop: 10,
    gap: 8,
  },
  deleteRow: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    color: colors.danger,
    fontFamily,
    ...typography.body,
  },
  failure: {
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  pressed: {
    opacity: 0.6,
  },
});
