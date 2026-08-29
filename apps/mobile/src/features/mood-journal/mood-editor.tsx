import type {
  EnergyLevel,
  MoodLevel,
  NoteBlock,
  NoteBlockType,
  NoteContentBlocksV1,
} from '@steward/api-client';
import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { colors, fontFamily, moodColors, radius, typography } from '@/theme/tokens';
import { blocksPlaintext, createBlocksDocument, createParagraphBlock, moodOptions } from './model';

const emotionSuggestions = ['松弛', '笃定', '疲惫', '期待', '安心', '烦躁', '感激', '孤单'];

export type MoodEditorValue = {
  title: string;
  content: NoteContentBlocksV1;
  moodLevel?: MoodLevel;
  energyLevel?: EnergyLevel;
  emotionWords: string[];
};

type MoodEditorProps = {
  initial?: MoodEditorValue;
  occurredAt: Date;
  saving: boolean;
  failure?: string | null;
  draftKey?: string;
  submitLabel?: string;
  onSubmit: (value: MoodEditorValue) => Promise<boolean>;
};

export function MoodEditor({
  initial,
  occurredAt,
  saving,
  failure,
  draftKey,
  submitLabel = '完成',
  onSubmit,
}: MoodEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [titleVisible, setTitleVisible] = useState(Boolean(initial?.title));
  const [content, setContent] = useState(initial?.content ?? createBlocksDocument());
  const [moodLevel, setMoodLevel] = useState<MoodLevel | undefined>(initial?.moodLevel);
  const [energyLevel, setEnergyLevel] = useState<EnergyLevel | undefined>(initial?.energyLevel);
  const [emotionWords, setEmotionWords] = useState(initial?.emotionWords ?? []);
  const [promptVisible, setPromptVisible] = useState(!initial);
  const [moodExpanded, setMoodExpanded] = useState(false);
  const [focusedBlockID, setFocusedBlockID] = useState(content.blocks[0]?.id ?? '');
  const [draftReady, setDraftReady] = useState(!draftKey);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const plaintext = useMemo(() => blocksPlaintext(content), [content]);
  const canSubmit = Boolean(plaintext) && !saving;
  const focused = content.blocks.find((block) => block.id === focusedBlockID) ?? content.blocks[0];

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
        const draft = JSON.parse(raw) as MoodEditorValue & { promptVisible?: boolean };
        if (draft.content?.format === 'blocks_v1' && draft.content.blocks.length > 0) {
          setTitle(draft.title ?? '');
          setTitleVisible(Boolean(draft.title));
          setContent(draft.content);
          setFocusedBlockID(draft.content.blocks[0].id);
          setMoodLevel(draft.moodLevel);
          setEnergyLevel(draft.energyLevel);
          setEmotionWords(draft.emotionWords ?? []);
          setPromptVisible(draft.promptVisible ?? true);
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
    if (!draftKey || !draftReady || saving) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void SecureStore.setItemAsync(draftKey, JSON.stringify({
        title, content, moodLevel, energyLevel, emotionWords, promptVisible,
      }));
    }, 450);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [content, draftKey, draftReady, emotionWords, energyLevel, moodLevel, promptVisible, saving, title]);

  const submit = async () => {
    if (!canSubmit) return;
    const succeeded = await onSubmit({ title, content, moodLevel, energyLevel, emotionWords });
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

  const setBlockType = (type: NoteBlockType) => {
    if (!focused) return;
    updateBlock(focused.id, { type });
  };

  const toggleMark = (mark: 'bold' | 'italic' | 'strikethrough') => {
    if (!focused) return;
    const run = focused.runs[0] ?? { text: '' };
    const marks = { ...(run.marks ?? {}), [mark]: !run.marks?.[mark] };
    updateBlock(focused.id, { runs: [{ text: run.text, marks }] });
  };

  const addBlock = () => {
    const block = createParagraphBlock('', content.blocks.length);
    setContent((current) => ({ ...current, blocks: [...current.blocks, block] }));
    setFocusedBlockID(block.id);
  };

  const toggleEmotion = (word: string) => {
    setEmotionWords((current) => current.includes(word)
      ? current.filter((item) => item !== word)
      : current.length < 3 ? [...current, word] : current);
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
          <View style={styles.localState}>
            <AppIcon color={colors.textTertiary} name="checkmark" size={14} />
            <Text style={styles.localStateText}>{draftReady ? '草稿已在本机保护' : '正在恢复草稿…'}</Text>
          </View>

          {promptVisible ? (
            <View style={styles.prompt}>
              <View style={styles.promptCopy}>
                <Text style={styles.promptLabel}>写作提示 · 可跳过</Text>
                <Text style={styles.promptText}>此刻，什么最值得被记住？</Text>
              </View>
              <Pressable
                accessibilityLabel="关闭写作提示"
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => setPromptVisible(false)}
              >
                <AppIcon color={moodColors.accent} name="close" size={18} />
              </Pressable>
            </View>
          ) : null}

          {titleVisible ? (
            <TextInput
              accessibilityLabel="日记标题，可选"
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
              onPress={() => setTitleVisible(true)}
              style={({ pressed }) => [styles.addTitle, pressed && styles.pressed]}
            >
              <AppIcon color={colors.textSecondary} name="add" size={15} />
              <Text style={styles.addTitleText}>添加标题</Text>
            </Pressable>
          )}

          <View style={styles.blocks}>
            {content.blocks.map((block) => (
              <BlockInput
                block={block}
                focused={block.id === focusedBlockID}
                key={block.id}
                onFocus={() => setFocusedBlockID(block.id)}
                onTextChange={(text) => updateText(block.id, text)}
              />
            ))}
          </View>

          <View style={styles.moodSection}>
            <Pressable
              accessibilityLabel="选择此刻心情"
              accessibilityRole="button"
              accessibilityState={{ expanded: moodExpanded }}
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
                        key={value}
                        onPress={() => setEnergyLevel(selected ? undefined : value)}
                        style={({ pressed }) => [styles.energyOption, selected && styles.energyOptionSelected, pressed && styles.pressed]}
                      >
                        <Text style={[styles.energyText, selected && styles.energyTextSelected]}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </View>

          {failure ? <Text accessibilityLiveRegion="polite" style={styles.failure}>{failure}</Text> : null}
        </ScrollView>

        <View style={styles.toolbarWrap}>
          <View style={styles.toolbar}>
            <Tool label="正文" selected={focused?.type === 'paragraph'} onPress={() => setBlockType('paragraph')} />
            <Tool label="H₂" selected={focused?.type === 'heading_2'} onPress={() => setBlockType('heading_2')} />
            <Tool label="B" selected={Boolean(focused?.runs[0]?.marks?.bold)} onPress={() => toggleMark('bold')} bold />
            <Tool label="I" selected={Boolean(focused?.runs[0]?.marks?.italic)} onPress={() => toggleMark('italic')} italic />
            <Tool label="•" selected={focused?.type === 'bullet_item'} onPress={() => setBlockType('bullet_item')} />
            <Tool label="“" selected={focused?.type === 'quote'} onPress={() => setBlockType('quote')} />
          </View>
          <Pressable
            accessibilityLabel="添加正文块"
            accessibilityRole="button"
            onPress={addBlock}
            style={({ pressed }) => [styles.addBlock, pressed && styles.pressed]}
          >
            <AppIcon color={moodColors.accent} name="add" size={22} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

function BlockInput({ block, focused, onFocus, onTextChange }: {
  block: NoteBlock;
  focused: boolean;
  onFocus: () => void;
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
        autoFocus={focused && text.length === 0}
        multiline
        onChangeText={onTextChange}
        onFocus={onFocus}
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

function Tool({ label, selected, onPress, bold, italic }: {
  label: string;
  selected: boolean;
  onPress: () => void;
  bold?: boolean;
  italic?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={`格式 ${label}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.tool, selected && styles.toolSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.toolText, selected && styles.toolTextSelected, bold && styles.bold, italic && styles.italic]}>{label}</Text>
    </Pressable>
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
  localState: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 5 },
  localStateText: { color: colors.textTertiary, fontFamily, ...typography.meta },
  prompt: {
    minHeight: 74, marginTop: 6, paddingHorizontal: 14, paddingVertical: 11,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: moodColors.border,
    borderRadius: radius.md, backgroundColor: moodColors.soft,
  },
  promptCopy: { flex: 1 },
  promptLabel: { color: moodColors.text, fontFamily, ...typography.meta },
  promptText: { marginTop: 2, color: colors.text, fontFamily, fontSize: 16, lineHeight: 24, fontWeight: '500' },
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
  failure: { marginTop: 12, color: colors.danger, fontFamily, ...typography.meta },
  toolbarWrap: { paddingHorizontal: 12, paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
  toolbar: { flex: 1, height: 50, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', borderWidth: StyleSheet.hairlineWidth, borderColor: moodColors.border, borderRadius: radius.xl, backgroundColor: '#F8FBFD' },
  tool: { minWidth: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  toolSelected: { backgroundColor: moodColors.soft },
  toolText: { color: colors.textSecondary, fontFamily, fontSize: 15, lineHeight: 20 },
  toolTextSelected: { color: moodColors.accentPressed },
  addBlock: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: moodColors.soft },
  pressed: { opacity: 0.56 },
});
