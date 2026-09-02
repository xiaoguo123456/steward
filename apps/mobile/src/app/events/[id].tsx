import {
  deleteEvent,
  errorMessage,
  updateEvent,
  useGetEvent,
  useListProjects,
  type Event,
  type ProjectStatus,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { confirmAction } from '@/components/ui/confirm-action';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import { buildEventEditRequest, eventEditDraft, type EventEditDraft } from '@/features/events/event-edit-model';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

const projectStatuses: ProjectStatus[] = ['active', 'paused'];

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const eventQuery = useGetEvent(id ?? '', { query: { enabled: Boolean(id) } });
  const projects = useListProjects({ status: projectStatuses, limit: 100 });
  const event = eventQuery.data?.data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EventEditDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    // 查询首次成功后只初始化一次草稿；后续编辑入口会显式从最新实体重建。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (event && !draft) setDraft(eventEditDraft(event));
  }, [draft, event]);
  const set = <K extends keyof EventEditDraft>(field: K, value: EventEditDraft[K]) => setDraft(current => current ? { ...current, [field]: value } : current);

  const save = async () => {
    if (!event || !draft || busy) return;
    setFailure(null); setBusy(true);
    try {
      await updateEvent(event.id, buildEventEditRequest(draft), { headers: { 'If-Match': String(event.version) } });
      await queryClient.invalidateQueries();
      setEditing(false);
    } catch (error) { setFailure(error instanceof Error ? error.message : errorMessage(error, '保存日程失败')); }
    finally { setBusy(false); }
  };

  const confirmDelete = async () => {
    if (!event || busy) return;
    const confirmed = await confirmAction({
      title: '删除日程？',
      message: '删除后会取消尚未发送的提醒，且无法撤销。',
      confirmLabel: '删除',
      destructive: true,
    });
    if (confirmed) await remove();
  };
  const remove = async () => {
    if (!event) return;
    setBusy(true); setFailure(null);
    try { await deleteEvent(event.id); await queryClient.invalidateQueries(); router.back(); }
    catch (error) { setFailure(errorMessage(error, '删除日程失败')); setBusy(false); }
  };

  if (eventQuery.isPending) return <AppScreen><NavHeader title="日程详情" /><View style={styles.loading}><ActivityIndicator color={colors.primary} /></View></AppScreen>;
  if (eventQuery.isError || !event || !draft) return <AppScreen><NavHeader title="日程详情" /><StatePanel title="打不开日程" message={errorMessage(eventQuery.error, '这条日程可能已被删除。')} actionLabel="返回" onAction={() => router.back()} /></AppScreen>;

  return (
    <AppScreen includeBottomInset>
      <NavHeader title={editing ? '编辑日程' : '日程详情'} right={editing ? null : <Pressable accessibilityLabel="编辑日程" accessibilityRole="button" onPress={() => { setDraft(eventEditDraft(event)); setEditing(true); }}><Text style={styles.edit}>编辑</Text></Pressable>} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {editing ? (
          <>
            <Field label="标题"><Input label="日程标题" value={draft.title} onChangeText={value => set('title', value)} /></Field>
            <View style={styles.switchRow}><Text style={styles.fieldLabel}>全天</Text><Switch accessibilityLabel="全天日程" value={draft.allDay} onValueChange={value => { set('allDay', value); set('start', ''); set('end', ''); }} /></View>
            <Field label={draft.allDay ? '开始日期（YYYY-MM-DD）' : '开始时间（YYYY-MM-DD HH:mm）'}><Input label="开始" value={draft.start} onChangeText={value => set('start', value)} /></Field>
            <Field label={draft.allDay ? '结束日期（可选）' : '结束时间（可选）'}><Input label="结束" value={draft.end} onChangeText={value => set('end', value)} /></Field>
            <Field label="时区"><Input label="时区" value={draft.timezone} onChangeText={value => set('timezone', value)} /></Field>
            {!draft.allDay && draft.start ? <Text style={styles.hint}>{eventDeviceTimePreview(draft)}</Text> : null}
            <Field label="地点"><Input label="地点" value={draft.location} onChangeText={value => set('location', value)} /></Field>
            <Field label="参与人（逗号分隔）"><Input label="参与人" value={draft.participants} onChangeText={value => set('participants', value)} /></Field>
            <Field label="项目"><View style={styles.options}><Choice selected={!draft.projectId} label="不属于项目" onPress={() => set('projectId', '')} />{(projects.data?.data ?? []).map(project => <Choice key={project.id} selected={draft.projectId === project.id} label={project.title} onPress={() => set('projectId', project.id)} />)}</View></Field>
            <Field label="说明"><Input label="日程说明" multiline value={draft.note} onChangeText={value => set('note', value)} /></Field>
            <View style={styles.switchRow}><Text style={styles.fieldLabel}>提醒</Text><Switch accessibilityLabel="日程提醒" value={draft.reminderEnabled} onValueChange={value => set('reminderEnabled', value)} /></View>
            {draft.reminderEnabled && draft.allDay ? <Field label="当地提醒时刻（HH:mm）"><Input label="提醒时刻" value={draft.reminderTime} onChangeText={value => set('reminderTime', value)} /></Field> : null}
            {draft.reminderEnabled && !draft.allDay ? <Field label="提醒时间"><View style={styles.options}>{([{ value: 'at_time', label: '到时' }, { value: '10m', label: '提前 10 分钟' }, { value: '1h', label: '提前 1 小时' }, { value: '1d', label: '提前 1 天' }] as const).map(option => <Choice key={option.value} selected={draft.reminderOption === option.value} label={option.label} onPress={() => set('reminderOption', option.value)} />)}</View></Field> : null}
            {failure ? <Text style={styles.error}>{failure}</Text> : null}
            <View style={styles.actions}><AppButton label="取消" variant="secondary" onPress={() => setEditing(false)} style={styles.action} /><AppButton disabled={busy} label={busy ? '保存中…' : '保存'} onPress={() => void save()} style={styles.action} /></View>
          </>
        ) : (
          <>
            <Text style={styles.title}>{event.title}</Text>
            <View style={styles.card}>
              <Row label="时间" value={eventTime(event)} />
              <Row label="时区" value={event.timezone} />
              <Row label="地点" value={event.location || '未设置'} />
              <Row label="参与人" value={event.participants?.join('、') || '未设置'} />
              <Row label="提醒" value={event.reminders?.length ? `${event.reminders.length} 条` : '未设置'} />
              <Row label="项目" value={(projects.data?.data ?? []).find(project => project.id === event.project_id)?.title || '无'} />
            </View>
            {event.note ? <View style={styles.note}><Text style={styles.fieldLabel}>说明</Text><Text style={styles.noteText}>{event.note}</Text></View> : null}
            {failure ? <Text style={styles.error}>{failure}</Text> : null}
            <AppButton label="删除日程" variant="danger" disabled={busy} onPress={confirmDelete} />
          </>
        )}
      </ScrollView>
    </AppScreen>
  );
}

function eventTime(event: Event) { if (event.all_day) return `${event.start_date ?? ''}${event.end_date ? ` 至 ${event.end_date}` : ''} · 全天`; const start = event.start_at ? new Date(event.start_at).toLocaleString('zh-CN') : '未设置'; return `${start}${event.end_at ? ` 至 ${new Date(event.end_at).toLocaleString('zh-CN')}` : ''}`; }
function eventDeviceTimePreview(draft: EventEditDraft) { try { const request = buildEventEditRequest({ ...draft, end: '', reminderEnabled: false }); return `设备当地时间：${new Date(request.start_at!).toLocaleString('zh-CN')}（Event 时区：${draft.timezone}）`; } catch { return '请填写有效时间与 IANA 时区，例如 Asia/Shanghai'; } }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text>{children}</View>; }
function Input(props: React.ComponentProps<typeof TextInput> & { label: string }) { const { label, ...rest } = props; return <TextInput accessibilityLabel={label} placeholderTextColor={colors.textTertiary} selectionColor={colors.primary} style={[styles.input, rest.multiline && styles.multiline]} {...rest} />; }
function Choice({ selected, label, onPress }: { selected: boolean; label: string; onPress: () => void }) { return <AppButton label={label} onPress={onPress} variant={selected ? 'primary' : 'secondary'} style={styles.choice} />; }
function Row({ label, value }: { label: string; value: string }) { return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' }, content: { padding: 16, paddingBottom: 44, gap: 18 },
  edit: { color: colors.primaryStrong, fontFamily, ...typography.bodyStrong }, title: { color: colors.text, fontFamily, ...typography.detail },
  card: { paddingHorizontal: 14, borderRadius: radius.lg, backgroundColor: colors.surface }, row: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, rowLabel: { color: colors.textSecondary, fontFamily, ...typography.body }, rowValue: { flex: 1, textAlign: 'right', color: colors.text, fontFamily, ...typography.body },
  field: { gap: 8 }, fieldLabel: { color: colors.textSecondary, fontFamily, ...typography.meta }, input: { minHeight: 48, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surface, color: colors.text, fontFamily, ...typography.body }, multiline: { minHeight: 104, paddingTop: 12, textAlignVertical: 'top' },
  switchRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choice: { minWidth: 100, flexGrow: 0 }, note: { gap: 7 }, noteText: { color: colors.text, fontFamily, ...typography.body }, hint: { color: colors.textSecondary, fontFamily, ...typography.meta }, error: { color: colors.danger, fontFamily, ...typography.meta }, actions: { flexDirection: 'row', gap: 10 }, action: { flex: 1 },
});
