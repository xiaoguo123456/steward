import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 笔记编辑器。新建与修改共用同一套表单。
 *
 * 标题可以留空：服务端会从正文首行生成一个。让用户为随手记的一句话
 * 想标题是多余的负担。
 */

export type NoteDraft = {
  title: string;
  content: string;
  tags: string[];
};

export function NoteEditor({
  initial,
  saving,
  failure,
  submitLabel,
  onSubmit,
}: {
  initial?: NoteDraft;
  saving: boolean;
  failure?: string | null;
  submitLabel: string;
  onSubmit: (draft: NoteDraft) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [tagInputOpen, setTagInputOpen] = useState(false);

  // 正文是唯一必填项，与契约一致。
  const canSubmit = Boolean(content.trim()) && !saving;

  const addTag = () => {
    const tag = tagDraft.trim();
    if (!tag || tags.includes(tag)) {
      setTagDraft('');
      return;
    }
    setTags((current) => [...current, tag]);
    setTagDraft('');
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <TextInput
        accessibilityLabel="笔记标题"
        maxLength={120}
        onChangeText={setTitle}
        placeholder="标题"
        placeholderTextColor={colors.textTertiary}
        style={styles.titleInput}
        value={title}
      />

      <TextInput
        accessibilityLabel="笔记正文"
        multiline
        onChangeText={setContent}
        placeholder="写点什么…"
        placeholderTextColor={colors.textTertiary}
        style={styles.contentInput}
        textAlignVertical="top"
        value={content}
      />

      <Text accessibilityRole="header" style={styles.sectionTitle}>标签</Text>
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
        {!tagInputOpen ? (
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
      </View>
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
          onPress={() => onSubmit({ title: title.trim(), content: content.trim(), tags })}
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
  sectionTitle: {
    marginTop: 18,
    marginBottom: 10,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  tagRow: {
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
