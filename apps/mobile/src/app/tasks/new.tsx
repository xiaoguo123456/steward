import {
  createTask,
  errorMessage,
  useListTaskLists,
  type CreateTaskRequest,
  type TaskPriority,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { formatDateParam } from '@/utils/format';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

const priorities: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'normal', label: '普通' },
  { value: 'high', label: '高' },
];

type DueChoice = 'none' | 'today' | 'tomorrow';

const dueChoices: { value: DueChoice; label: string }[] = [
  { value: 'none', label: '不设置' },
  { value: 'today', label: '今天' },
  { value: 'tomorrow', label: '明天' },
];

export default function NewTaskScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const listsQuery = useListTaskLists();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [due, setDue] = useState<DueChoice>('none');
  const [pickedListId, setPickedListId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lists = useMemo(() => listsQuery.data?.data ?? [], [listsQuery.data]);

  // 默认落在用户的默认清单上，与确认页的行为保持一致。
  // 这里用派生值而不是 effect + setState，避免多一轮渲染。
  const defaultListId = lists.find((list) => list.is_default)?.id ?? lists[0]?.id ?? null;
  const listId = pickedListId ?? defaultListId;

  const canSave = title.trim().length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setError(null);
    setSaving(true);
    try {
      const body: CreateTaskRequest = {
        title: title.trim(),
        priority,
        list_id: listId ?? undefined,
      };
      if (description.trim()) {
        body.description = description.trim();
      }
      if (due !== 'none') {
        const date = new Date();
        if (due === 'tomorrow') date.setDate(date.getDate() + 1);
        // 只给日期不给时刻：服务端会把它保存为「某日截止」，不会补成 23:59。
        body.due_date = formatDateParam(date);
        body.due_timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      }

      await createTask(body);
      await queryClient.invalidateQueries();
      router.back();
    } catch (err) {
      setError(errorMessage(err, '保存失败，请稍后重试。'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppScreen includeBottomInset>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" hitSlop={10} onPress={() => router.back()}>
            <Text style={styles.cancel}>取消</Text>
          </Pressable>
          <Text style={styles.headerTitle}>新建任务</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
            disabled={!canSave}
            hitSlop={10}
            onPress={() => void save()}
          >
            <Text style={[styles.save, !canSave && styles.saveDisabled]}>
              {saving ? '保存中' : '保存'}
            </Text>
          </Pressable>
        </View>

        <TextInput
          accessibilityLabel="任务标题"
          autoFocus
          onChangeText={setTitle}
          placeholder="要做什么？"
          placeholderTextColor={colors.textTertiary}
          style={styles.titleInput}
          value={title}
        />

        <TextInput
          accessibilityLabel="备注"
          multiline
          onChangeText={setDescription}
          placeholder="补充说明（可选）"
          placeholderTextColor={colors.textTertiary}
          style={styles.noteInput}
          value={description}
        />

        <Text style={styles.groupLabel}>优先级</Text>
        <View style={styles.chipRow}>
          {priorities.map((item) => (
            <Chip
              key={item.value}
              label={item.label}
              onPress={() => setPriority(item.value)}
              selected={priority === item.value}
            />
          ))}
        </View>

        <Text style={styles.groupLabel}>截止</Text>
        <View style={styles.chipRow}>
          {dueChoices.map((item) => (
            <Chip
              key={item.value}
              label={item.label}
              onPress={() => setDue(item.value)}
              selected={due === item.value}
            />
          ))}
        </View>

        {lists.length > 0 ? (
          <>
            <Text style={styles.groupLabel}>清单</Text>
            <View style={styles.chipRow}>
              {lists.map((list) => (
                <Chip
                  key={list.id}
                  label={list.name}
                  onPress={() => setPickedListId(list.id)}
                  selected={listId === list.id}
                />
              ))}
            </View>
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </AppScreen>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  cancel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  save: {
    color: colors.primary,
    fontFamily,
    ...typography.bodyStrong,
  },
  saveDisabled: {
    color: colors.textTertiary,
  },
  titleInput: {
    minHeight: 52,
    marginTop: 8,
    color: colors.text,
    fontFamily,
    ...typography.detail,
  },
  noteInput: {
    minHeight: 80,
    marginTop: 4,
    paddingTop: 8,
    color: colors.text,
    fontFamily,
    ...typography.body,
    textAlignVertical: 'top',
  },
  groupLabel: {
    marginTop: 20,
    marginBottom: 8,
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    backgroundColor: colors.primary,
  },
  pressed: {
    opacity: 0.7,
  },
  chipText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
  },
  chipTextSelected: {
    color: colors.background,
  },
  error: {
    marginTop: 16,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
});
