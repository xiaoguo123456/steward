import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import {
  applyNotePolish,
  canPolishNote,
  type NotePolishCandidate,
  type NotePolishDraft,
} from './note-polish';

/**
 * 笔记编辑器。新建与修改共用同一套表单。
 *
 * 标题可以留空：服务端会从正文首行生成一个。让用户为随手记的一句话
 * 想标题是多余的负担。
 */

export type NoteDraft = NotePolishDraft;

export function NoteEditor({
  initial,
  saving,
  failure,
  submitLabel,
  onPolish,
  onSubmit,
}: {
  initial?: NoteDraft;
  saving: boolean;
  failure?: string | null;
  submitLabel: string;
  onPolish?: (draft: NoteDraft) => Promise<NotePolishCandidate>;
  onSubmit: (draft: NoteDraft) => void;
}) {
  const { showToast } = useToast();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [polishActionId, setPolishActionId] = useState(initial?.polishActionId);
  const [polishing, setPolishing] = useState(false);
  const [undoPolish, setUndoPolish] = useState<{
    title: string;
    content: string;
    polishActionId?: string;
  } | null>(null);
  const polishAttempt = useRef(0);
  const [tagDraft, setTagDraft] = useState('');
  const [tagInputOpen, setTagInputOpen] = useState(false);

  // 正文是唯一必填项，与契约一致。
  const busy = saving || polishing;
  const canSubmit = Boolean(content.trim()) && !busy;
  const polishReady = canPolishNote(content, busy);

  const addTag = () => {
    const tag = tagDraft.trim();
    if (!tag || tags.includes(tag)) {
      setTagDraft('');
      return;
    }
    setTags((current) => [...current, tag]);
    setTagDraft('');
  };

  const polish = async () => {
    if (!onPolish || !polishReady) return;
    Keyboard.dismiss();
    const attempt = ++polishAttempt.current;
    const before = { title, content, polishActionId };
    setPolishing(true);
    try {
      const candidate = await onPolish({ title, content, tags, polishActionId });
      if (attempt !== polishAttempt.current) return;
      const next = applyNotePolish({ title, content, tags, polishActionId }, candidate);
      setTitle(next.title);
      setContent(next.content);
      setPolishActionId(next.polishActionId);
      setUndoPolish(before);
      showToast('已润色，可继续修改');
    } catch (error) {
      if (attempt !== polishAttempt.current) return;
      showToast(error instanceof Error ? error.message : '润色暂时不可用，请稍后再试。');
    } finally {
      if (attempt === polishAttempt.current) setPolishing(false);
    }
  };

  const undo = () => {
    if (!undoPolish || polishing) return;
    setTitle(undoPolish.title);
    setContent(undoPolish.content);
    setPolishActionId(undoPolish.polishActionId);
    setUndoPolish(null);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <TextInput
        accessibilityLabel="笔记标题"
        accessibilityState={{ disabled: busy }}
        editable={!busy}
        maxLength={120}
        onChangeText={setTitle}
        placeholder="标题"
        placeholderTextColor={colors.textTertiary}
        style={styles.titleInput}
        value={title}
      />

      <TextInput
        accessibilityLabel="笔记正文"
        accessibilityState={{ disabled: busy }}
        editable={!busy}
        multiline
        onChangeText={setContent}
        placeholder="写点什么…"
        placeholderTextColor={colors.textTertiary}
        style={styles.contentInput}
        textAlignVertical="top"
        value={content}
      />

      {onPolish ? (
        <View style={styles.editorTools}>
          <Pressable
            accessibilityLabel="添加标签"
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => setTagInputOpen(true)}
            style={({ pressed }) => [styles.editorTool, pressed && styles.pressed]}
          >
            <AppIcon color={colors.textSecondary} name="add" size={17} />
            <Text style={styles.editorToolText}>添加标签</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={polishing ? '正在润色笔记' : '一键润色笔记'}
            accessibilityRole="button"
            accessibilityState={{ busy: polishing, disabled: !polishReady }}
            disabled={!polishReady}
            onPress={() => void polish()}
            style={({ pressed }) => [styles.editorTool, pressed && styles.pressed]}
          >
            {polishing ? (
              <ActivityIndicator color={colors.primaryStrong} size="small" />
            ) : (
              <AppIcon color={polishReady ? colors.primaryStrong : colors.textTertiary} name="sparkles" size={17} />
            )}
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.editorToolText, styles.polishToolText, !polishReady && styles.editorToolTextDisabled]}
            >
              {polishing ? '正在润色…' : '一键润色'}
            </Text>
          </Pressable>
        </View>
      ) : !tagInputOpen ? (
        <Pressable
          accessibilityLabel="添加标签"
          accessibilityRole="button"
          onPress={() => setTagInputOpen(true)}
          style={({ pressed }) => [styles.tagTrigger, pressed && styles.pressed]}
        >
          <AppIcon color={colors.textSecondary} name="add" size={16} />
          <Text style={styles.tagTriggerText}>添加标签</Text>
        </Pressable>
      ) : null}

      {undoPolish && !polishing ? (
        <Pressable
          accessibilityLabel="撤销本次润色"
          accessibilityRole="button"
          hitSlop={8}
          onPress={undo}
          style={({ pressed }) => [styles.undoButton, pressed && styles.pressed]}
        >
          <AppIcon color={colors.textSecondary} name="return-down-back-outline" size={16} />
          <Text style={styles.undoText}>撤销润色</Text>
        </Pressable>
      ) : null}

      {tags.length > 0 ? (
        <View style={styles.tagRow}>
          {tags.map((tag) => (
            <Pressable
              accessibilityLabel={`移除标签 ${tag}`}
              accessibilityRole="button"
              key={tag}
              onPress={() => setTags((current) => current.filter((item) => item !== tag))}
              style={({ pressed }) => [styles.tag, pressed && styles.pressed]}
            >
              <Text style={styles.tagText}>{tag}</Text>
              <AppIcon color={colors.primaryStrong} name="close" size={13} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {tagInputOpen ? (
        <View style={styles.tagInputRow}>
          <TextInput
            accessibilityLabel="新增标签"
            autoFocus
            maxLength={20}
            onChangeText={setTagDraft}
            onSubmitEditing={addTag}
            placeholder="输入标签"
            placeholderTextColor={colors.textSecondary}
            returnKeyType="done"
            style={styles.tagInput}
            value={tagDraft}
          />
          <Pressable
            accessibilityLabel="确认添加标签"
            accessibilityRole="button"
            accessibilityState={{ disabled: !tagDraft.trim() }}
            disabled={!tagDraft.trim()}
            onPress={addTag}
            style={({ pressed }) => [styles.tagAdd, pressed && styles.pressed]}
          >
            <Text style={[styles.tagAddText, !tagDraft.trim() && styles.tagAddTextDisabled]}>
              添加
            </Text>
          </Pressable>
        </View>
      ) : null}

      {failure ? <Text style={styles.failure}>{failure}</Text> : null}

      <View style={styles.actions}>
        <AppButton
          disabled={!canSubmit}
          label={saving ? '正在保存…' : submitLabel}
          onPress={() => onSubmit({
            title: title.trim(),
            content: content.trim(),
            tags,
            polishActionId,
          })}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  titleInput: {
    marginTop: 4,
    minHeight: 48,
    color: colors.text,
    fontFamily,
    ...typography.detail,
  },
  contentInput: {
    marginTop: 8,
    minHeight: 200,
    paddingVertical: 10,
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  editorTools: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  editorTool: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: colors.surfaceSubtle,
  },
  editorToolText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  polishToolText: {
    color: colors.primaryStrong,
  },
  editorToolTextDisabled: {
    color: colors.textTertiary,
  },
  undoButton: {
    minHeight: 36,
    alignSelf: 'flex-end',
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  undoText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontWeight: '500',
  },
  tagRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primarySoft,
  },
  tagText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  tagTrigger: {
    alignSelf: 'flex-start',
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceSubtle,
  },
  tagTriggerText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontWeight: '500',
  },
  tagInputRow: {
    marginTop: 10,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  tagInput: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 14,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  tagAdd: {
    minWidth: 60,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagAddText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  tagAddTextDisabled: {
    color: colors.textTertiary,
  },
  failure: {
    marginTop: 14,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  actions: {
    marginTop: 22,
    gap: 8,
  },
  pressed: {
    opacity: 0.75,
  },
});
