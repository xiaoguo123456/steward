import {
  createPersonInteraction,
  errorMessage,
  getListPersonInteractionsQueryKey,
  newIdempotencyKey,
  type PersonInteractionType,
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
import { interactionTypeOptions, localDate, localDateTimeISO, localTime } from '@/features/relationships/model';
import { colors } from '@/theme/tokens';

export default function NewPersonInteractionScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const personID = Array.isArray(params.id) ? params.id[0] : params.id;
  const personQuery = useGetPerson(personID ?? '', { query: { enabled: Boolean(personID) } });
  const [type, setType] = useState<PersonInteractionType>('met');
  const [date, setDate] = useState(localDate());
  const [time, setTime] = useState(localTime());
  const [summary, setSummary] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  const save = async () => {
    if (!personID || !summary.trim() || saving) return;
    setSaving(true);
    setFailure(null);
    keyRef.current ??= newIdempotencyKey();
    try {
      await createPersonInteraction(personID, {
        interaction_type: type,
        occurred_at: localDateTimeISO(date, time),
        summary: summary.trim(),
        note: note.trim() || undefined,
      }, { headers: { 'Idempotency-Key': keyRef.current } });
      await queryClient.invalidateQueries({ queryKey: getListPersonInteractionsQueryKey(personID) });
      router.back();
    } catch (error) {
      setFailure(errorMessage(error, '没有保存成功，请稍后重试。'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader title={personQuery.data?.data ? `记录与${personQuery.data.data.name}的互动` : '记录互动'} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FormField label="方式"><ChoiceChips onChange={setType} options={interactionTypeOptions} value={type} /></FormField>
        <FormField label="日期"><DateWheel endYear={new Date().getFullYear()} onChange={setDate} startYear={new Date().getFullYear() - 10} value={date} /></FormField>
        <FormField label="时间"><TimeWheel onChange={setTime} value={time} /></FormField>
        <FormField label="发生了什么">
          <TextInput autoFocus maxLength={160} onChangeText={setSummary} placeholder="例如：一起吃了晚饭" placeholderTextColor={colors.textSecondary} style={styles.input} value={summary} />
        </FormField>
        <FormField label="补充">
          <TextInput maxLength={1000} multiline onChangeText={setNote} placeholder="想记住的细节" placeholderTextColor={colors.textSecondary} style={[styles.input, styles.multiline]} value={note} />
        </FormField>
        {failure ? <Text accessibilityRole="alert" style={styles.error}>{failure}</Text> : null}
        <AppButton disabled={!summary.trim() || saving} label={saving ? '正在保存…' : '保存互动'} onPress={() => void save()} style={styles.submit} />
      </ScrollView>
    </AppScreen>
  );
}
