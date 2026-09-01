import {
  errorMessage,
  updateTask,
  useGetTask,
  useListProjects,
  useListTaskLists,
  type ProjectStatus,
  type TaskPriority,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import {
  buildTaskEditRequest,
  taskEditDraft,
  type TaskEditDraft,
} from '@/features/tasks/task-edit-model';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

const projectStatuses: ProjectStatus[] = ['active', 'paused'];
const priorities: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: '低' }, { value: 'normal', label: '普通' }, { value: 'high', label: '高' },
];

export default function TaskEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const taskQuery = useGetTask(id ?? '', { query: { enabled: Boolean(id) } });
  const lists = useListTaskLists({ list_kind: 'tasks' });
  const projects = useListProjects({ status: projectStatuses, limit: 100 });
  const [draft, setDraft] = useState<TaskEditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    // 查询首次成功后把服务端实体转换成表单草稿。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (taskQuery.data?.data && !draft) setDraft(taskEditDraft(taskQuery.data.data));
  }, [draft, taskQuery.data]);

  const set = <K extends keyof TaskEditDraft>(field: K, value: TaskEditDraft[K]) => {
    setDraft(current => current ? { ...current, [field]: value } : current);
  };
  const save = async () => {
    const task = taskQuery.data?.data;
    if (!task || !draft || saving) return;
    setFailure(null);
    setSaving(true);
    try {
      const request = buildTaskEditRequest(draft, Intl.DateTimeFormat().resolvedOptions().timeZone);
      await updateTask(task.id, request, { headers: { 'If-Match': String(task.version) } });
      await queryClient.invalidateQueries();
      router.back();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : errorMessage(error, '保存任务失败'));
    } finally { setSaving(false); }
  };

  if (taskQuery.isPending || !draft) return <AppScreen><NavHeader title="编辑任务" /><View style={styles.loading}><ActivityIndicator color={colors.primary} /></View></AppScreen>;
  if (taskQuery.isError) return <AppScreen><NavHeader title="编辑任务" /><StatePanel title="打不开任务" message={errorMessage(taskQuery.error)} actionLabel="返回" onAction={() => router.back()} /></AppScreen>;

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="编辑任务" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field label="标题"><Input label="任务标题" value={draft.title} onChangeText={value => set('title', value)} /></Field>
        <Field label="描述"><Input label="任务描述" value={draft.description} onChangeText={value => set('description', value)} multiline /></Field>
        <Field label="优先级"><Options value={draft.priority} options={priorities} onChange={value => set('priority', value)} /></Field>
        <Field label="清单"><Options value={draft.listId} options={(lists.data?.data ?? []).map(item => ({ value: item.id, label: item.name }))} onChange={value => set('listId', value)} /></Field>
        <Field label="项目"><Options value={draft.projectId} options={[{ value: '', label: '不属于项目' }, ...(projects.data?.data ?? []).map(item => ({ value: item.id, label: item.title }))]} onChange={value => set('projectId', value)} /></Field>
        <Field label="截止类型"><Options value={draft.dueKind} options={[{ value: 'none', label: '不设置' }, { value: 'date', label: '截止日期' }, { value: 'time', label: '截止时间' }]} onChange={value => set('dueKind', value)} /></Field>
        {draft.dueKind !== 'none' ? <Field label={draft.dueKind === 'date' ? '截止日期（YYYY-MM-DD）' : '截止时间（YYYY-MM-DD HH:mm）'}><Input label="截止" value={draft.dueValue} onChangeText={value => set('dueValue', value)} /></Field> : null}
        <Field label="加入指定日期（YYYY-MM-DD）"><Input label="加入指定日期" value={draft.focusDate} onChangeText={value => set('focusDate', value)} /></Field>
        <Field label="计划开始（YYYY-MM-DD HH:mm）"><Input label="计划开始" value={draft.scheduledStart} onChangeText={value => set('scheduledStart', value)} /></Field>
        <Field label="计划结束（YYYY-MM-DD HH:mm）"><Input label="计划结束" value={draft.scheduledEnd} onChangeText={value => set('scheduledEnd', value)} /></Field>
        <Field label="预计时长（分钟）"><Input label="预计时长" keyboardType="number-pad" value={draft.estimatedMinutes} onChangeText={value => set('estimatedMinutes', value)} /></Field>
        {failure ? <Text style={styles.error}>{failure}</Text> : null}
        <AppButton disabled={saving} label={saving ? '保存中…' : '保存修改'} onPress={() => void save()} />
      </ScrollView>
    </AppScreen>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <View style={styles.field}><Text style={styles.label}>{label}</Text>{children}</View>; }
function Input(props: React.ComponentProps<typeof TextInput> & { label: string }) { const { label, ...rest } = props; return <TextInput accessibilityLabel={label} placeholderTextColor={colors.textTertiary} selectionColor={colors.primary} style={[styles.input, rest.multiline && styles.multiline]} {...rest} />; }
function Options<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) { return <View style={styles.options}>{options.map(option => <AppButton key={option.value || 'none'} label={option.label} onPress={() => onChange(option.value)} style={styles.option} variant={value === option.value ? 'primary' : 'secondary'} />)}</View>; }

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 44, gap: 18 },
  field: { gap: 8 }, label: { color: colors.textSecondary, fontFamily, ...typography.meta },
  input: { minHeight: 48, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surface, color: colors.text, fontFamily, ...typography.body },
  multiline: { minHeight: 104, paddingTop: 12, textAlignVertical: 'top' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, option: { minWidth: 92, flexGrow: 0 },
  error: { color: colors.danger, fontFamily, ...typography.meta },
});
