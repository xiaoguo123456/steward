import type {
  EnergyLevel,
  MoodLevel,
  NoteBlock,
  NoteContentBlocksV1,
} from '@steward/api-client';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { useToast } from '@/components/ui/toast';
import { colors, fontFamily, moodColors, radius, typography } from '@/theme/tokens';
import {
  applyMoodJournalPolish,
  canPolishMoodJournal,
  type MoodJournalPolishCandidate,
} from './mood-journal-polish';
import { blocksPlaintext, compactMoodJournalDraft, createBlocksDocument, moodOptions } from './model';

const emotionSuggestions = ['松弛', '笃定', '疲惫', '期待', '安心', '烦躁', '感激', '孤单'];
const contextSuggestions = ['工作', '学习', '家庭', '朋友', '独处', '运动', '出行', '休息'];

export type MoodEditorValue = {
  title: string;
  content: NoteContentBlocksV1;
  moodLevel?: MoodLevel;
  energyLevel?: EnergyLevel;
  emotionWords: string[];
  contextWords: string[];
  excludeFromAi: boolean;
  includeInMemories: boolean;
  polishActionId?: string;
};

type MoodEditorProps = {
  initial?: MoodEditorValue;
  occurredAt: Date;
  saving: boolean;
  failure?: string | null;
  draftKey?: string;
  submitLabel?: string;
  onPolish?: (value: MoodEditorValue) => Promise<MoodJournalPolishCandidate | null>;
  onSubmit: (value: MoodEditorValue) => Promise<boolean>;
};

export function MoodEditor({
  initial,
  occurredAt,
  saving,
  failure,
  draftKey,
  submitLabel = '完成',
  onPolish,
  onSubmit,
}: MoodEditorProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [titleVisible, setTitleVisible] = useState(Boolean(initial?.title));
  const [content, setContent] = useState(initial?.content ?? createBlocksDocument());
  const [moodLevel, setMoodLevel] = useState<MoodLevel | undefined>(initial?.moodLevel);
  const [energyLevel, setEnergyLevel] = useState<EnergyLevel | undefined>(initial?.energyLevel);
  const [emotionWords, setEmotionWords] = useState(initial?.emotionWords ?? []);
  const [contextWords, setContextWords] = useState(initial?.contextWords ?? []);
  const [excludeFromAi, setExcludeFromAi] = useState(initial?.excludeFromAi ?? false);
  const [includeInMemories, setIncludeInMemories] = useState(initial?.includeInMemories ?? true);
  const [polishActionId, setPolishActionId] = useState(initial?.polishActionId);
  const [polishing, setPolishing] = useState(false);
  const [undoPolish, setUndoPolish] = useState<{
    content: NoteContentBlocksV1;
    polishActionId?: string;
  } | null>(null);
  const [moodExpanded, setMoodExpanded] = useState(false);
  const [draftReady, setDraftReady] = useState(!draftKey);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const polishAttempt = useRef(0);

  const plaintext = useMemo(() => blocksPlaintext(content), [content]);
  const busy = saving || polishing;
  const canSubmit = Boolean(plaintext) && !busy;
  const polishReady = canPolishMoodJournal(content, busy);

  useEffect(() => {
    if (!draftKey) return;
    let active = true;
    void SecureStore.getItemAsync(draftKey).then((raw) => {
      if (!active) return;
      if (!raw || initial) {
        setDraftReady(true);
        return;
      }
      try {
        const draft = JSON.parse(raw) as MoodEditorValue;
        if (draft.content?.format === 'blocks_v1' && draft.content.blocks.length > 0) {
          setTitle(draft.title ?? '');
          setTitleVisible(Boolean(draft.title));
          setContent(compactMoodJournalDraft(draft.content));
          setMoodLevel(draft.moodLevel);
          setEnergyLevel(draft.energyLevel);
          setEmotionWords(draft.emotionWords ?? []);
          setContextWords(draft.contextWords ?? []);
          setExcludeFromAi(draft.excludeFromAi ?? false);
          setIncludeInMemories(draft.includeInMemories ?? true);
          setPolishActionId(draft.polishActionId);
        }
      } catch {
        // 草稿损坏时保持空白编辑器；正式数据不受影响。
      } finally {
        if (active) setDraftReady(true);
      }
    }).catch(() => {
      // 本机安全存储暂时不可用时仍允许书写，保存失败不会阻止服务端正式保存。
      if (active) setDraftReady(true);
    });
    return () => { active = false; };
  }, [draftKey, initial]);

  useEffect(() => {
    if (!draftKey || !draftReady || busy) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void SecureStore.setItemAsync(draftKey, JSON.stringify({
        title, content, moodLevel, energyLevel, emotionWords, contextWords,
        excludeFromAi, includeInMemories, polishActionId,
      }));
    }, 450);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [busy, content, contextWords, draftKey, draftReady, emotionWords, energyLevel, excludeFromAi, includeInMemories, moodLevel, polishActionId, title]);

  const submit = async () => {
    if (!canSubmit) return;
    const succeeded = await onSubmit({
      title, content, moodLevel, energyLevel, emotionWords, contextWords,
      excludeFromAi, includeInMemories, polishActionId,
    });
    if (succeeded && draftKey) await SecureStore.deleteItemAsync(draftKey);
  };

  const updateBlock = (id: string, patch: Partial<NoteBlock>) => {
    setContent((current) => ({
      ...current,
      blocks: current.blocks.map((block) => block.id === id ? { ...block, ...patch } : block),
    }));
  };

  const updateText = (id: string, text: string) => {
    const block = content.blocks.find((item) => item.id === id);
    const marks = block?.runs[0]?.marks;
    updateBlock(id, { runs: [{ text, ...(marks ? { marks } : {}) }] });
  };

  const toggleEmotion = (word: string) => {
    setEmotionWords((current) => current.includes(word)
      ? current.filter((item) => item !== word)
      : current.length < 3 ? [...current, word] : current);
  };

  const toggleContext = (word: string) => {
    setContextWords((current) => current.includes(word)
      ? current.filter((item) => item !== word)
      : current.length < 5 ? [...current, word] : current);
  };

  const polish = async () => {
    if (!onPolish || !polishReady) return;
    Keyboard.dismiss();
    const attempt = ++polishAttempt.current;
    const before = { content, polishActionId };
    setPolishing(true);
    try {
      const candidate = await onPolish({
        title, content, moodLevel, energyLevel, emotionWords, contextWords,
        excludeFromAi, includeInMemories, polishActionId,
      });
      if (attempt !== polishAttempt.current || !candidate) return;
      const next = applyMoodJournalPolish(content, candidate);
      setContent(next.content);
      setPolishActionId(next.polishActionId);
      setUndoPolish(before);
      showToast('已排版润色，可继续修改');
    } catch (error) {
      if (attempt !== polishAttempt.current) return;
      showToast(error instanceof Error ? error.message : '排版润色暂时不可用，请稍后再试。');
    } finally {
      if (attempt === polishAttempt.current) setPolishing(false);
    }
  };

  const undo = () => {
    if (!undoPolish || polishing) return;
    setContent(undoPolish.content);
    setPolishActionId(undoPolish.polishActionId);
    setUndoPolish(null);
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader
        onBack={() => router.back()}
        right={(
          <Pressable
            accessibilityLabel={submitLabel}
            accessibilityRole="button"
            accessibilityState={{ busy: saving, disabled: !canSubmit }}
            disabled={!canSubmit}
            onPress={() => void submit()}
            style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}
          >
            {saving ? <ActivityIndicator color={moodColors.accent} size="small" /> : (
              <Text style={[styles.doneText, !canSubmit && styles.doneTextDisabled]}>{submitLabel}</Text>
            )}
          </Pressable>
        )}
        title={formatEditorDate(occurredAt)}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={10}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {titleVisible ? (
            <TextInput
              accessibilityLabel="日记标题，可选"
              accessibilityState={{ disabled: busy }}
              editable={!busy}
              maxLength={120}
              onChangeText={setTitle}
              placeholder="标题（可选）"
              placeholderTextColor={colors.textTertiary}
              style={styles.titleInput}
              value={title}
            />
          ) : (
            <Pressable
              accessibilityLabel="添加日记标题"
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => setTitleVisible(true)}
              style={({ pressed }) => [styles.addTitle, pressed && styles.pressed]}
            >
              <AppIcon color={colors.textSecondary} name="add" size={15} />
              <Text style={styles.addTitleText}>添加标题</Text>
            </Pressable>
          )}

          <View style={styles.blocks}>
            {content.blocks.map((block, index) => (
              <BlockInput
                autoFocus={index === 0}
                block={block}
                editable={!busy}
                key={block.id}
                onTextChange={(text) => updateText(block.id, text)}
              />
            ))}
          </View>

          <View style={styles.moodSection}>
            <Pressable
              accessibilityLabel="选择此刻心情"
              accessibilityRole="button"
              accessibilityState={{ expanded: moodExpanded }}
              disabled={busy}
              onPress={() => setMoodExpanded((current) => !current)}
              style={({ pressed }) => [styles.moodSummary, pressed && styles.pressed]}
            >
              <View style={styles.aperture}><View style={styles.apertureCore} /></View>
              <Text style={styles.moodSummaryText}>
                {moodLevel ? moodOptions.find((item) => item.value === moodLevel)?.label : '添加此刻心情'}
              </Text>
              {emotionWords.length > 0 ? <Text style={styles.moodWords}>· {emotionWords.join(' · ')}</Text> : null}
              <View style={styles.moodSummarySpacer} />
              <AppIcon color={colors.textSecondary} name={moodExpanded ? 'chevron-up' : 'chevron-down'} size={17} />
            </Pressable>

            {moodExpanded ? (
              <View style={styles.moodPanel}>
                <Text style={styles.optionLabel}>此刻心情（可跳过）</Text>
                <View style={styles.moodOptions}>
                  {moodOptions.map((option, index) => {
                    const selected = moodLevel === option.value;
                    return (
                      <Pressable
                        accessibilityLabel={option.label}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        disabled={busy}
                        key={option.value}
                        onPress={() => setMoodLevel(selected ? undefined : option.value)}
                        style={({ pressed }) => [styles.moodOption, selected && styles.moodOptionSelected, pressed && styles.pressed]}
                      >
                        <View style={[styles.moodOptionGlyph, { opacity: 0.32 + index * 0.14 }, selected && styles.moodOptionGlyphSelected]} />
                        <Text style={[styles.moodOptionText, selected && styles.moodOptionTextSelected]}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[styles.optionLabel, styles.optionLabelSpacing]}>感受词，最多 3 个</Text>
                <View style={styles.wordOptions}>
                  {emotionSuggestions.map((word) => {
                    const selected = emotionWords.includes(word);
                    return (
                      <Pressable
                        accessibilityLabel={word}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                        disabled={busy}
                        key={word}
                        onPress={() => toggleEmotion(word)}
                        style={({ pressed }) => [styles.wordOption, selected && styles.wordOptionSelected, pressed && styles.pressed]}
                      >
                        <Text style={[styles.wordText, selected && styles.wordTextSelected]}>{word}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[styles.optionLabel, styles.optionLabelSpacing]}>精力（可跳过）</Text>
                <View style={styles.energyRow}>
                  {(['low', 'medium', 'high'] as EnergyLevel[]).map((value) => {
                    const selected = energyLevel === value;
                    const label = value === 'low' ? '偏低' : value === 'medium' ? '适中' : '充足';
                    return (
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        disabled={busy}
                        key={value}
                        onPress={() => setEnergyLevel(selected ? undefined : value)}
                        style={({ pressed }) => [styles.energyOption, selected && styles.energyOptionSelected, pressed && styles.pressed]}
                      >
                        <Text style={[styles.energyText, selected && styles.energyTextSelected]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[styles.optionLabel, styles.optionLabelSpacing]}>此刻场景，最多 5 个</Text>
                <View style={styles.wordOptions}>
                  {contextSuggestions.map((word) => {
                    const selected = contextWords.includes(word);
                    return (
                      <Pressable
                        accessibilityLabel={word}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected }}
                        disabled={busy}
                        key={word}
                        onPress={() => toggleContext(word)}
                        style={({ pressed }) => [styles.wordOption, selected && styles.wordOptionSelected, pressed && styles.pressed]}
                      >
                        <Text style={[styles.wordText, selected && styles.wordTextSelected]}>{word}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.privacyOptions}>
                  <PrivacyToggle
                    disabled={busy}
                    label="不参与 AI 回望"
                    onValueChange={setExcludeFromAi}
                    value={excludeFromAi}
                  />
                  <PrivacyToggle
                    disabled={busy}
                    label="出现在往日回忆"
                    onValueChange={setIncludeInMemories}
                    value={includeInMemories}
                  />
                </View>
              </View>
            ) : null}
          </View>

          {failure ? <Text accessibilityLiveRegion="polite" style={styles.failure}>{failure}</Text> : null}
        </ScrollView>

        {onPolish ? (
          <View style={styles.polishBar}>
            <Pressable
              accessibilityLabel={polishing ? '正在进行 AI 排版润色' : '一键 AI 排版润色'}
              accessibilityRole="button"
              accessibilityState={{ busy: polishing, disabled: !polishReady }}
              disabled={!polishReady}
              onPress={() => void polish()}
              style={({ pressed }) => [
                styles.polishButton,
                !polishReady && styles.polishButtonDisabled,
                pressed && styles.polishButtonPressed,
              ]}
            >
              {polishing ? (
                <ActivityIndicator color={moodColors.accentPressed} size="small" />
              ) : (
                <AppIcon
                  color={polishReady ? moodColors.accentPressed : colors.textTertiary}
                  name="sparkles"
                  size={18}
                />
              )}
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.polishText, !polishReady && styles.polishTextDisabled]}
              >
                {polishing ? '正在排版润色…' : undoPolish ? '再次排版润色' : 'AI 排版润色'}
              </Text>
            </Pressable>
            {undoPolish && !polishing ? (
              <Pressable
                accessibilityLabel="撤销本次排版润色"
                accessibilityRole="button"
                onPress={undo}
                style={({ pressed }) => [styles.undoButton, pressed && styles.pressed]}
              >
                <AppIcon color={colors.textSecondary} name="return-down-back-outline" size={17} />
                <Text style={styles.undoText}>撤销</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

function PrivacyToggle({ disabled, label, onValueChange, value }: {
  disabled: boolean;
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
}) {
  return (
    <View style={styles.privacyRow}>
      <Text style={styles.privacyLabel}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        disabled={disabled}
        onValueChange={onValueChange}
        thumbColor={colors.background}
        trackColor={{ false: colors.borderStrong, true: moodColors.accent }}
        value={value}
      />
    </View>
  );
}

function BlockInput({ block, autoFocus, editable, onTextChange }: {
  block: NoteBlock;
  autoFocus: boolean;
  editable: boolean;
  onTextChange: (text: string) => void;
}) {
  const text = block.runs.map((run) => run.text).join('');
  const mark = block.runs[0]?.marks;
  return (
    <View style={[styles.blockRow, block.type === 'quote' && styles.quoteRow]}>
      {block.type === 'bullet_item' ? <Text style={styles.blockPrefix}>•</Text> : null}
      {block.type === 'ordered_item' ? <Text style={styles.blockPrefix}>1.</Text> : null}
      <TextInput
        accessibilityLabel="日记正文"
        accessibilityState={{ disabled: !editable }}
        autoFocus={autoFocus && text.length === 0}
        editable={editable}
        multiline
        onChangeText={onTextChange}
        placeholder={block.type === 'heading_2' ? '小标题' : '写下此刻…'}
        placeholderTextColor={colors.textTertiary}
        style={[
          styles.blockInput,
          block.type === 'heading_2' && styles.heading2,
          block.type === 'heading_3' && styles.heading3,
          block.type === 'quote' && styles.quoteInput,
          mark?.bold && styles.bold,
          mark?.italic && styles.italic,
          mark?.strikethrough && styles.strike,
        ]}
        textAlignVertical="top"
        value={text}
      />
    </View>
  );
}

function formatEditorDate(date: Date) {
  const today = new Date();
  const prefix = date.toDateString() === today.toDateString()
    ? '今天'
    : `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${prefix} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  doneButton: { minWidth: 54, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' },
  doneText: { color: moodColors.accentPressed, fontFamily, ...typography.bodyStrong },
  doneTextDisabled: { color: colors.textTertiary },
  content: { paddingHorizontal: 16, paddingBottom: 30 },
  addTitle: { minHeight: 44, marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  addTitleText: { color: colors.textSecondary, fontFamily, ...typography.meta },
  titleInput: { marginTop: 18, paddingVertical: 4, color: colors.text, fontFamily, ...typography.detail },
  blocks: { minHeight: 300, paddingTop: 14 },
  blockRow: { flexDirection: 'row', alignItems: 'flex-start' },
  blockPrefix: { width: 24, paddingTop: 7, color: colors.text, fontFamily, fontSize: 17 },
  blockInput: { flex: 1, minHeight: 54, paddingVertical: 6, color: colors.text, fontFamily, fontSize: 17, lineHeight: 28 },
  heading2: { marginTop: 8, fontSize: 21, lineHeight: 31, fontWeight: '700' },
  heading3: { marginTop: 6, fontSize: 18, lineHeight: 28, fontWeight: '600' },
  quoteRow: { marginTop: 6, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: moodColors.atmosphere },
  quoteInput: { color: colors.textSecondary },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  moodSection: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  moodSummary: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 9 },
  aperture: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: moodColors.border, borderRadius: radius.pill },
  apertureCore: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: moodColors.accent },
  moodSummaryText: { color: colors.text, fontFamily, ...typography.bodyStrong },
  moodWords: { color: colors.textSecondary, fontFamily, ...typography.meta },
  moodSummarySpacer: { flex: 1 },
  moodPanel: { paddingBottom: 14 },
  optionLabel: { color: colors.textSecondary, fontFamily, ...typography.meta },
  optionLabelSpacing: { marginTop: 18 },
  moodOptions: { marginTop: 9, flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  moodOption: { width: 61, minHeight: 66, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  moodOptionSelected: { backgroundColor: moodColors.soft },
  moodOptionGlyph: { width: 18, height: 18, borderRadius: radius.pill, backgroundColor: moodColors.accent },
  moodOptionGlyphSelected: { opacity: 1 },
  moodOptionText: { marginTop: 5, color: colors.textSecondary, fontFamily, fontSize: 11, lineHeight: 16 },
  moodOptionTextSelected: { color: moodColors.accentPressed, fontWeight: '600' },
  wordOptions: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  wordOption: { minHeight: 40, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.pill },
  wordOptionSelected: { borderColor: moodColors.border, backgroundColor: moodColors.soft },
  wordText: { color: colors.textSecondary, fontFamily, ...typography.meta },
  wordTextSelected: { color: moodColors.accentPressed, fontWeight: '600' },
  energyRow: { marginTop: 8, flexDirection: 'row', gap: 8 },
  energyOption: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md },
  energyOptionSelected: { borderColor: moodColors.border, backgroundColor: moodColors.soft },
  energyText: { color: colors.textSecondary, fontFamily, ...typography.meta },
  energyTextSelected: { color: moodColors.accentPressed, fontWeight: '600' },
  privacyOptions: { marginTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  privacyRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  privacyLabel: { flex: 1, color: colors.text, fontFamily, ...typography.body },
  failure: { marginTop: 12, color: colors.danger, fontFamily, ...typography.meta },
  polishBar: {
    paddingHorizontal: 16, paddingTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background,
  },
  polishButton: {
    flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: radius.md, backgroundColor: moodColors.soft,
  },
  polishButtonDisabled: { backgroundColor: colors.surfaceSubtle },
  polishButtonPressed: { backgroundColor: moodColors.atmosphere },
  polishText: { color: moodColors.accentPressed, fontFamily, ...typography.bodyStrong },
  polishTextDisabled: { color: colors.textTertiary },
  undoButton: {
    minHeight: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderRadius: radius.md, backgroundColor: colors.surfaceSubtle,
  },
  undoText: { color: colors.textSecondary, fontFamily, ...typography.label },
  pressed: { opacity: 0.56 },
});
