import type { TrackerField, TrackerSchedule } from '@steward/api-client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { NavHeader } from '@/components/ui/nav-header';
import { SectionTitle } from '@/components/ui/section-title';
import { finalizeFields, newField, SchemaEditor } from '@/features/trackers/schema-editor';
import { TrackerPresetChoices } from '@/features/trackers/tracker-preset-choices';
import { trackerPresetDraft } from '@/features/trackers/tracker-presets';
import { TrackerSchedulePicker } from '@/features/trackers/tracker-schedule-picker';
import { useTrackerActions, validateFields } from '@/features/trackers/use-tracker-actions';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 创建 Tracker（DAT-01，设计说明 13.3）。
 *
 * 模板与手动字段共用同一表单；AI 能力仍走统一 Capture 确认链路。
 */
export default function NewTrackerScreen() {
  const router = useRouter();
  const actions = useTrackerActions();
  const { template } = useLocalSearchParams<{ template?: string }>();
  const initial = trackerPresetDraft(template);
  const [selectedPreset, setSelectedPreset] = useState(template);

  const [name, setName] = useState(initial?.name ?? '');
  const [fields, setFields] = useState<TrackerField[]>(initial?.fields ?? [newField(0)]);
  const [schedule, setSchedule] = useState<TrackerSchedule | null>(initial?.schedule ?? null);
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
      <NavHeader onBack={() => router.back()} title="新建打卡" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionTitle title="常用模板" />
        <TrackerPresetChoices selectedId={selectedPreset} onSelect={(id) => {
          const draft = trackerPresetDraft(id);
          if (!draft) return;
          setSelectedPreset(id);
          setName(draft.name);
          setFields(draft.fields);
          setSchedule(draft.schedule ?? null);
          setInvalid(null);
          actions.dismiss();
        }} />
        <Pressable
          accessibilityLabel="自定义打卡"
          accessibilityHint="清空模板，重新填写打卡名称和字段"
          accessibilityRole="button"
          onPress={() => {
            setSelectedPreset(undefined); setName(''); setFields([newField(0)]); setSchedule(null); setInvalid(null); actions.dismiss();
          }}
          style={({ pressed }) => [styles.customHeading, pressed && styles.pressed]}
        >
          <Text style={styles.customHeadingText}>自定义打卡</Text>
        </Pressable>

        <SectionTitle style={styles.section} title="打卡名称" />

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
          label={actions.busy ? '正在创建…' : '保存打卡'}
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
  customHeading: {
    marginTop: 18,
    minHeight: 52,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  customHeadingText: {
    color: colors.text,
    fontFamily,
    ...typography.section,
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
