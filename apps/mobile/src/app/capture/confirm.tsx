import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

export default function CaptureConfirmScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ draft?: string }>();
  const draft = typeof params.draft === 'string' ? params.draft : '准备产品需求评审';
  const [title, setTitle] = useState(draft.slice(0, 40));
  const [selected, setSelected] = useState(true);
  const [saved, setSaved] = useState(false);
  const [undone, setUndone] = useState(false);

  if (saved) {
    return (
      <AppScreen includeBottomInset>
        <View style={styles.successPage}>
          <View style={[styles.successIcon, undone && styles.undoIcon]}>
            <AppIcon
              color={undone ? colors.textSecondary : colors.primaryStrong}
              name={undone ? 'arrow-undo-outline' : 'checkmark'}
              size={30}
            />
          </View>
          <Text accessibilityRole="header" style={styles.successTitle}>
            {undone ? '本次保存已撤销' : '已保存 1 项'}
          </Text>
          <Text style={styles.successCopy}>
            {undone ? '原始输入仍保留在最近输入中。' : '任务已经进入收集箱，可以继续安排时间。'}
          </Text>
          {!undone ? (
            <View style={styles.savedItem}>
              <View style={styles.savedType}>
                <AppIcon color={colors.primaryStrong} name="checkmark-circle-outline" size={20} />
              </View>
              <View style={styles.savedCopy}>
                <Text numberOfLines={2} style={styles.savedTitle}>{title}</Text>
                <Text style={styles.savedMeta}>任务 · 收集箱</Text>
              </View>
            </View>
          ) : null}
          <View style={styles.successActions}>
            <AppButton label="返回首页" onPress={() => router.replace('/(tabs)/today')} />
            {!undone ? <AppButton label="撤销保存" onPress={() => setUndone(true)} variant="text" /> : null}
          </View>
        </View>
      </AppScreen>
    );
  }

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="确认整理结果" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.summaryRow}>
          <View>
            <Text accessibilityRole="header" style={styles.pageTitle}>识别到 1 项任务</Text>
            <Text style={styles.pageSubtitle}>检查一下，确认后才会保存</Text>
          </View>
          <View style={styles.readyBadge}>
            <AppIcon color={colors.primaryStrong} name="checkmark" size={14} />
            <Text style={styles.readyText}>可保存</Text>
          </View>
        </View>

        <View style={styles.candidateGroup}>
          <View style={styles.candidateHeader}>
            <Pressable
              accessibilityLabel={selected ? '取消选择任务' : '选择任务'}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              onPress={() => setSelected((current) => !current)}
              style={[styles.checkbox, selected && styles.checkboxSelected]}
            >
              {selected ? <AppIcon color={colors.background} name="checkmark" size={16} /> : null}
            </Pressable>
            <View style={styles.typeIcon}>
              <AppIcon color={colors.primaryStrong} name="checkmark-circle-outline" size={19} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.typeLabel}>任务</Text>
              <Text style={styles.sourceLabel}>来自你的输入</Text>
            </View>
          </View>

          <View style={styles.titleEditor}>
            <Text style={styles.fieldLabel}>标题</Text>
            <TextInput
              accessibilityLabel="任务标题"
              multiline
              onChangeText={setTitle}
              style={styles.titleInput}
              value={title}
            />
          </View>

          <View style={styles.fieldRow}>
            <Text style={styles.fieldName}>日期时间</Text>
            <View style={styles.fieldValueRow}>
              <View style={styles.suggestionBadge}>
                <Text style={styles.suggestionText}>AI 建议</Text>
              </View>
              <Text style={styles.fieldValue}>明天 15:00</Text>
              <AppIcon color={colors.borderStrong} name="chevron-forward" size={16} />
            </View>
          </View>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldName}>所属清单</Text>
            <View style={styles.fieldValueRow}>
              <Text style={styles.fieldValue}>收集箱</Text>
              <AppIcon color={colors.borderStrong} name="chevron-forward" size={16} />
            </View>
          </View>
          <View style={[styles.fieldRow, styles.lastFieldRow]}>
            <Text style={styles.fieldName}>优先级</Text>
            <View style={styles.fieldValueRow}>
              <Text style={styles.fieldValue}>无</Text>
              <AppIcon color={colors.borderStrong} name="chevron-forward" size={16} />
            </View>
          </View>
        </View>

        <Pressable style={({ pressed }) => [styles.sourceRow, pressed && styles.sourcePressed]}>
          <View style={styles.sourceIcon}>
            <AppIcon color={colors.textSecondary} name="document-text-outline" size={18} />
          </View>
          <View style={styles.sourceCopy}>
            <Text style={styles.sourceTitle}>查看原始输入</Text>
            <Text numberOfLines={1} style={styles.sourcePreview}>{draft}</Text>
          </View>
          <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerCopy}>
          <Text style={styles.footerTitle}>{selected ? '已选择 1 项' : '尚未选择'}</Text>
          <Text style={styles.footerMeta}>{selected ? '没有待解决问题' : '选择至少一项后保存'}</Text>
        </View>
        <AppButton
          compact
          disabled={!selected || !title.trim()}
          label="保存 1 项"
          onPress={() => setSaved(true)}
          style={styles.saveButton}
        />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  summaryRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  pageTitle: {
    color: colors.text,
    fontFamily,
    ...typography.detail,
  },
  pageSubtitle: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  readyBadge: {
    minHeight: 28,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primarySoft,
  },
  readyText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  candidateGroup: {
    overflow: 'hidden',
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  candidateHeader: {
    minHeight: 66,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  checkbox: {
    width: 24,
    height: 24,
    marginRight: 11,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  checkboxSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  typeIcon: {
    width: 36,
    height: 36,
    marginRight: 10,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  headerCopy: {
    flex: 1,
  },
  typeLabel: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  sourceLabel: {
    marginTop: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  titleEditor: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  titleInput: {
    minHeight: 50,
    paddingVertical: 6,
    color: colors.text,
    fontFamily,
    ...typography.input,
    fontWeight: '600',
  },
  fieldRow: {
    minHeight: 56,
    marginLeft: 14,
    paddingRight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  lastFieldRow: {
    borderBottomWidth: 0,
  },
  fieldName: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  fieldValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fieldValue: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  suggestionBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  suggestionText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.caption,
  },
  sourceRow: {
    minHeight: 72,
    marginTop: 20,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sourcePressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  sourceIcon: {
    width: 36,
    height: 36,
    marginRight: 11,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  sourceCopy: {
    flex: 1,
    paddingRight: 8,
  },
  sourceTitle: {
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  sourcePreview: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  footer: {
    minHeight: 76,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  footerCopy: {
    flex: 1,
  },
  footerTitle: {
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  footerMeta: {
    marginTop: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  saveButton: {
    minWidth: 124,
  },
  successPage: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 104,
    alignItems: 'center',
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  undoIcon: {
    backgroundColor: colors.surface,
  },
  successTitle: {
    marginTop: 22,
    color: colors.text,
    fontFamily,
    ...typography.detail,
  },
  successCopy: {
    maxWidth: 300,
    marginTop: 7,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    textAlign: 'center',
  },
  savedItem: {
    width: '100%',
    minHeight: 74,
    marginTop: 28,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  savedType: {
    width: 38,
    height: 38,
    marginRight: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  savedCopy: {
    flex: 1,
  },
  savedTitle: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  savedMeta: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  successActions: {
    width: '100%',
    marginTop: 'auto',
    paddingBottom: 12,
    gap: 4,
  },
});
