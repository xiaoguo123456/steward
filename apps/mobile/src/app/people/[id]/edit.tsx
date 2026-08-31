import {
  deletePerson,
  errorMessage,
  getGetPersonQueryKey,
  getListPeopleQueryKey,
  newIdempotencyKey,
  type Person,
  type RelationshipGroup,
  updatePerson,
  useGetPerson,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { NavHeader } from '@/components/ui/nav-header';
import {
  ChoiceChips,
  FormField,
  relationshipFormStyles as styles,
} from '@/features/relationships/form-controls';
import { relationshipGroupOptions } from '@/features/relationships/model';
import { colors } from '@/theme/tokens';

export default function EditPersonScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const personID = Array.isArray(params.id) ? params.id[0] : params.id;
  const personQuery = useGetPerson(personID ?? '', { query: { enabled: Boolean(personID) } });
  const person = personQuery.data?.data;

  if (personQuery.isPending || !person) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader title="编辑资料" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </AppScreen>
    );
  }

  return <EditPersonForm key={`${person.id}:${person.version}`} person={person} />;
}

function EditPersonForm({ person }: { person: Person }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState(person.name);
  const [group, setGroup] = useState<RelationshipGroup>(person.relationship_group);
  const [label, setLabel] = useState(person.relationship_label ?? '');
  const [note, setNote] = useState(person.note ?? '');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const deleteKeyRef = useRef<string | null>(null);

  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    setFailure(null);
    try {
      const response = await updatePerson(person.id, {
        name: name.trim(),
        relationship_group: group,
        relationship_label: label.trim() || undefined,
        note: note.trim() || undefined,
        clear: [
          ...(!label.trim() ? ['relationship_label' as const] : []),
          ...(!note.trim() ? ['note' as const] : []),
        ],
      }, { headers: { 'If-Match': String(person.version) } });
      queryClient.setQueryData(getGetPersonQueryKey(person.id), response);
      await queryClient.invalidateQueries({ queryKey: getListPeopleQueryKey() });
      router.back();
    } catch (error) {
      setFailure(errorMessage(error, '没有保存成功，请稍后重试。'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert('删除这位亲友？', '互动记录和人物关联会一起删除，已有日程仍会保留。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          deleteKeyRef.current ??= newIdempotencyKey();
          setSaving(true);
          void deletePerson(person.id, { headers: { 'Idempotency-Key': deleteKeyRef.current } })
            .then(async () => {
              queryClient.removeQueries({ queryKey: getGetPersonQueryKey(person.id), exact: true });
              await queryClient.invalidateQueries({ queryKey: getListPeopleQueryKey() });
              router.dismissAll();
              router.replace({ pathname: '/(tabs)/today', params: { homeTab: 'relationships' } });
            })
            .catch((error) => setFailure(errorMessage(error, '没有删除成功，请稍后重试。')))
            .finally(() => setSaving(false));
        },
      },
    ]);
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="编辑资料" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FormField label="姓名">
          <TextInput maxLength={80} onChangeText={setName} style={styles.input} value={name} />
        </FormField>
        <FormField label="关系">
          <ChoiceChips onChange={setGroup} options={relationshipGroupOptions} value={group} />
        </FormField>
        <FormField label="称呼">
          <TextInput maxLength={40} onChangeText={setLabel} placeholder="例如：姐姐、大学同学" placeholderTextColor={colors.textSecondary} style={styles.input} value={label} />
        </FormField>
        <FormField label="备注">
          <TextInput maxLength={500} multiline onChangeText={setNote} placeholder="记下你们如何认识，或对方最近在意的事" placeholderTextColor={colors.textSecondary} style={[styles.input, styles.multiline]} value={note} />
        </FormField>
        {failure ? <Text accessibilityRole="alert" style={styles.error}>{failure}</Text> : null}
        <AppButton disabled={!name.trim() || saving} label={saving ? '正在保存…' : '保存'} onPress={() => void save()} style={styles.submit} />
        <AppButton disabled={saving} label="删除亲友" onPress={confirmDelete} variant="danger" />
      </ScrollView>
    </AppScreen>
  );
}
