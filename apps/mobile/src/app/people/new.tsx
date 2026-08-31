import {
  createPerson,
  errorMessage,
  getListPeopleQueryKey,
  newIdempotencyKey,
  type RelationshipGroup,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';

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

export default function NewPersonScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [group, setGroup] = useState<RelationshipGroup>('family');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  const save = async () => {
    const normalizedName = name.trim();
    if (!normalizedName || saving) return;
    setSaving(true);
    setFailure(null);
    keyRef.current ??= newIdempotencyKey();
    try {
      const response = await createPerson({
        name: normalizedName,
        relationship_group: group,
        relationship_label: label.trim() || undefined,
        note: note.trim() || undefined,
      }, { headers: { 'Idempotency-Key': keyRef.current } });
      await queryClient.invalidateQueries({ queryKey: getListPeopleQueryKey() });
      router.replace({ pathname: '/people/[id]', params: { id: response.data.id } });
    } catch (error) {
      setFailure(errorMessage(error, '没有保存成功，请稍后重试。'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="添加亲友" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FormField label="姓名">
          <TextInput
            accessibilityLabel="姓名"
            autoFocus
            maxLength={80}
            onChangeText={setName}
            placeholder="输入姓名"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            value={name}
          />
        </FormField>
        <FormField label="关系">
          <ChoiceChips onChange={setGroup} options={relationshipGroupOptions} value={group} />
        </FormField>
        <FormField label="称呼">
          <TextInput
            accessibilityLabel="关系称呼"
            maxLength={40}
            onChangeText={setLabel}
            placeholder="例如：姐姐、大学同学"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            value={label}
          />
        </FormField>
        <FormField label="备注">
          <TextInput
            accessibilityLabel="备注"
            maxLength={500}
            multiline
            onChangeText={setNote}
            placeholder="记下你们如何认识，或对方最近在意的事"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, styles.multiline]}
            value={note}
          />
        </FormField>
        {failure ? <Text accessibilityRole="alert" style={styles.error}>{failure}</Text> : null}
        <AppButton
          disabled={!name.trim() || saving}
          label={saving ? '正在保存…' : '保存亲友'}
          onPress={() => void save()}
          style={styles.submit}
        />
      </ScrollView>
    </AppScreen>
  );
}
