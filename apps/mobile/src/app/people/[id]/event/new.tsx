import {
  createPersonEvent,
  errorMessage,
  getListPersonEventsQueryKey,
  newIdempotencyKey,
  useGetPerson,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { DateWheel } from '@/components/ui/date-wheel';
import { NavHeader } from '@/components/ui/nav-header';
import { TimeWheel } from '@/components/ui/time-wheel';
import { ChoiceChips, FormField, relationshipFormStyles as styles } from '@/features/relationships/form-controls';
import { localDate, localDateTimeISO, localTime } from '@/features/relationships/model';
import { colors } from '@/theme/tokens';

type PersonEventKind = 'schedule' | 'important_date';
type RepeatChoice = 'none' | 'yearly';

const kindOptions: readonly { id: PersonEventKind; label: string }[] = [
  { id: 'schedule', label: '日程' },
  { id: 'important_date', label: '重要日' },
];

const repeatOptions: readonly { id: RepeatChoice; label: string }[] = [
  { id: 'none', label: '仅一次' },
  { id: 'yearly', label: '每年' },
];

function initialEventTime() {
  const value = new Date();
  value.setHours(value.getHours() + 1);
  return localTime(value);
}

export default function NewPersonEventScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const personID = Array.isArray(params.id) ? params.id[0] : params.id;
  const personQuery = useGetPerson(personID ?? '', { query: { enabled: Boolean(personID) } });
  const [kind, setKind] = useState<PersonEventKind>('schedule');
  const [repeat, setRepeat] = useState<RepeatChoice>('none');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(localDate());
  const [time, setTime] = useState(initialEventTime);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  const changeKind = (next: PersonEventKind) => {
    setKind(next);
    setRepeat(next === 'important_date' ? 'yearly' : 'none');
  };

  const save = async () => {
    if (!personID || !title.trim() || saving) return;
    setSaving(true);
    setFailure(null);
    keyRef.current ??= newIdempotencyKey();
    try {
      await createPersonEvent(personID, kind === 'important_date' ? {
        title: title.trim(),
        event_kind: 'important_date',
        all_day: true,
        start_date: date,
        recurrence: repeat,
        important_date_kind: 'other',
        note: note.trim() || undefined,
      } : {
        title: title.trim(),
        event_kind: 'schedule',
        all_day: false,
        start_at: localDateTimeISO(date, time),
        recurrence: 'none',
        note: note.trim() || undefined,
      }, { headers: { 'Idempotency-Key': keyRef.current } });
      await queryClient.invalidateQueries({ queryKey: getListPersonEventsQueryKey(personID) });
      router.back();
    } catch (error) {
      setFailure(errorMessage(error, '没有保存成功，请稍后重试。'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader title={personQuery.data?.data ? `为${personQuery.data.data.name}添加事件` : '添加事件'} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FormField label="类型"><ChoiceChips onChange={changeKind} options={kindOptions} value={kind} /></FormField>
        <FormField label="事件">
          <TextInput autoFocus maxLength={200} onChangeText={setTitle} placeholder={kind === 'important_date' ? '例如：生日' : '例如：周末一起吃饭'} placeholderTextColor={colors.textSecondary} style={styles.input} value={title} />
        </FormField>
        <FormField label="日期"><DateWheel endYear={new Date().getFullYear() + 10} onChange={setDate} startYear={kind === 'important_date' ? 1900 : new Date().getFullYear()} value={date} /></FormField>
        {kind === 'schedule' ? <FormField label="时间"><TimeWheel onChange={setTime} value={time} /></FormField> : null}
        {kind === 'important_date' ? <FormField label="重复"><ChoiceChips onChange={setRepeat} options={repeatOptions} value={repeat} /></FormField> : null}
        <FormField label="备注">
          <TextInput maxLength={500} multiline onChangeText={setNote} placeholder="地点、准备事项或其他细节" placeholderTextColor={colors.textSecondary} style={[styles.input, styles.multiline]} value={note} />
        </FormField>
        {failure ? <Text accessibilityRole="alert" style={styles.error}>{failure}</Text> : null}
        <AppButton disabled={!title.trim() || saving} label={saving ? '正在保存…' : '保存事件'} onPress={() => void save()} style={styles.submit} />
      </ScrollView>
    </AppScreen>
  );
}
