import type { TrackerField, TrackerFieldType } from '@steward/api-client';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { fieldTypeOptions, suggestFieldKey } from '@/features/trackers/use-tracker-actions';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * Tracker 字段编辑器（设计说明 13.3）。
 *
 * 字段名、类型、单位、是否必填与删除都在一行里。
 *
 * key 由字段名生成一次就不再跟着改：历史 Record 的值是按 key 存的，
 * 改名会让已经记下的数据读不出来。所以 key 只在新增那一刻定下来。
 */
export function SchemaEditor({
  fields,
  onChange,
  editable = true,
}: {
  fields: TrackerField[];
  onChange: (fields: TrackerField[]) => void;
  editable?: boolean;
}) {
  const replace = (index: number, patch: Partial<TrackerField>) => {
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  };

  return (
    <View style={styles.list}>
      {fields.map((field, index) => (
        <View key={field.key} style={styles.field}>
          <View style={styles.fieldTop}>
            <TextInput
              accessibilityLabel={`第 ${index + 1} 个字段的名称`}
              editable={editable}
              maxLength={20}
              onChangeText={(label) => replace(index, { label })}
              placeholder="字段名称，例如 体重"
              placeholderTextColor={colors.textTertiary}
              style={[styles.input, styles.nameInput]}
              value={field.label}
            />
            {editable ? (
              <Pressable
                accessibilityLabel={`删除字段 ${field.label || index + 1}`}
                accessibilityRole="button"
                disabled={fields.length <= 1}
                hitSlop={8}
                onPress={() => onChange(fields.filter((_, i) => i !== index))}
                style={styles.removeButton}
              >
                <AppIcon
                  color={fields.length <= 1 ? colors.borderStrong : colors.danger}
                  name="close-circle-outline"
                  size={20}
                />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.typeRow}>
            {fieldTypeOptions.map((option) => (
              <Pressable
                accessibilityLabel={`把${field.label || '这个字段'}设为${option.label}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: field.type === option.type }}
                disabled={!editable}
                key={option.type}
                onPress={() => replace(index, { type: option.type })}
                style={({ pressed }) => [
                  styles.typeChip,
                  field.type === option.type && styles.typeChipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.typeText,
                    field.type === option.type && styles.typeTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.fieldBottom}>
            {/* 文字字段没有单位可填，留着输入框只会让人以为该填点什么。 */}
            {field.type === 'text' ? (
              <Text style={styles.hint}>{hintOf(field.type)}</Text>
            ) : (
              <TextInput
                accessibilityLabel={`${field.label || '字段'}的单位`}
                editable={editable}
                maxLength={8}
                onChangeText={(unit) => replace(index, { unit: unit || undefined })}
                placeholder="单位，例如 kg"
                placeholderTextColor={colors.textTertiary}
                style={[styles.input, styles.unitInput]}
                value={field.unit ?? ''}
              />
            )}
            <View style={styles.requiredRow}>
              <Text style={styles.requiredLabel}>必填</Text>
              <Switch
                accessibilityLabel={`${field.label || '字段'}是否必填`}
                disabled={!editable}
                onValueChange={(required) => replace(index, { required })}
                value={field.required}
              />
            </View>
          </View>
        </View>
      ))}

      {editable ? (
        <Pressable
          accessibilityLabel="添加一个字段"
          accessibilityRole="button"
          onPress={() => onChange([...fields, newField(fields.length)])}
          style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
        >
          <AppIcon color={colors.primaryStrong} name="add-circle-outline" size={19} />
          <Text style={styles.addText}>添加字段</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** 新字段的默认形状。key 一旦定下就不再变。 */
export function newField(index: number): TrackerField {
  return {
    key: `field_${index + 1}_${Math.random().toString(36).slice(2, 6)}`,
    label: '',
    type: 'number',
    required: index === 0,
  };
}

/**
 * 提交前把空白 key 补齐。
 *
 * 用户改字段名时 key 不跟着变，但一个刚加出来还没起名的字段，
 * key 里的随机后缀会一路留到库里。这里在提交那一刻按名字重算一次，
 * 让新建出来的记录项有可读的 key。
 */
export function finalizeFields(fields: TrackerField[]): TrackerField[] {
  return fields.map((field, index) => ({
    ...field,
    key: suggestFieldKey(field.label, index),
    label: field.label.trim(),
    unit: field.unit?.trim() || undefined,
  }));
}

function hintOf(type: TrackerFieldType): string {
  return fieldTypeOptions.find((option) => option.type === type)?.hint ?? '';
}

const styles = StyleSheet.create({
  list: {
    gap: 14,
  },
  field: {
    padding: 12,
    gap: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  fieldTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fieldBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  nameInput: {
    flex: 1,
  },
  unitInput: {
    flex: 1,
  },
  removeButton: {
    width: 36,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  typeChip: {
    minHeight: 32,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  typeChipActive: {
    backgroundColor: colors.primarySoft,
  },
  typeText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  typeTextActive: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  hint: {
    flex: 1,
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  requiredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  requiredLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  addButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.body,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.6,
  },
});
