import type { TrackerField, TrackerSchedule } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { SectionTitle } from '@/components/ui/section-title';
import { finalizeFields, newField, SchemaEditor } from '@/features/trackers/schema-editor';
import { TrackerSchedulePicker } from '@/features/trackers/tracker-schedule-picker';
import { useTrackerActions, validateFields } from '@/features/trackers/use-tracker-actions';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 创建 Tracker（DAT-01，设计说明 13.3）。
 *
 * 两条入口：说一句话让 AI 生成 Schema 候选，或者直接手动编字段。
 * 前者走统一 Capture，AI 给出的仍然只是候选，用户确认后才创建。
 */
export default function NewTrackerScreen() {
  const router = useRouter();
  const actions = useTrackerActions();

  const [name, setName] = useState('');
  const [fields, setFields] = useState<TrackerField[]>([newField(0)]);
  const [schedule, setSchedule] = useState<TrackerSchedule | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);

  const submit = async () => {
    const prepared = finalizeFields(fields);
    const problem = validateFields(prepared);
    setInvalid(problem);
    if (problem || !name.trim()) return;

    if (await actions.create({
      name: name.trim(),
      fields: prepared,
      ...(schedule ? { schedule } : {}),
    })) {
      router.back();
    }
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader onBack={() => router.back()} title="新建打卡项" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityLabel="描述我想记录什么，让助理生成字段"
          accessibilityRole="button"
          onPress={() => router.push('/capture/new')}
          style={({ pressed }) => [styles.aiEntry, pressed && styles.pressed]}
        >
          <AppIcon color={colors.primaryStrong} name="sparkles-outline" size={20} />
          <View style={styles.aiCopy}>
            <Text style={styles.aiTitle}>描述我想记录什么</Text>
            <Text style={styles.aiHint}>说一句「我想记每天喝了多少水」，助理帮你把字段列好</Text>
          </View>
          <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
        </Pressable>

        <SectionTitle style={styles.section} title="或者自己填" />

        <TextInput
          accessibilityLabel="打卡项名称"
          maxLength={40}
          onChangeText={setName}
          placeholder="名称，例如 喝水"
          placeholderTextColor={colors.textTertiary}
          style={styles.nameInput}
          value={name}
        />

        <SectionTitle style={styles.section} title="频率" />
        <TrackerSchedulePicker onChange={setSchedule} value={schedule} />

        <SectionTitle count={`${fields.length} 个`} style={styles.section} title="字段" />
        <SchemaEditor fields={fields} onChange={setFields} />

        {invalid ? <Text style={styles.failure}>{invalid}</Text> : null}
        {actions.failure ? <Text style={styles.failure}>{actions.failure}</Text> : null}

        <AppButton
          disabled={actions.busy || !name.trim()}
          label={actions.busy ? '正在创建…' : '创建打卡项'}
          onPress={() => void submit()}
          style={styles.submit}
        />
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },
  aiEntry: {
    marginTop: 4,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  aiCopy: {
    flex: 1,
    gap: 2,
  },
  aiTitle: {
    color: colors.text,
    fontFamily,
    ...typography.body,
    fontWeight: '600',
  },
  aiHint: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  section: {
    marginTop: 18,
  },
  nameInput: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  submit: {
    marginTop: 24,
  },
  failure: {
    marginTop: 14,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  pressed: {
    opacity: 0.6,
  },
});
