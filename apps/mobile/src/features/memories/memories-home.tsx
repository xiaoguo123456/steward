import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, radius } from '@/theme/tokens';
import { useMemoriesPrototype } from './memories-context';
import { groupMemoryMoments } from './memory-model';
import { MemoryMomentRow } from './memory-moment-row';

export function MemoriesHome() {
  const router = useRouter();
  const { moments } = useMemoriesPrototype();
  const groups = groupMemoryMoments(moments);
  const currentYear = groups[0]?.year ?? new Date().getFullYear();

  return (
    <View style={styles.root}>
      <View style={styles.previewNote}>
        <AppIcon color={colors.primaryStrong} name="shield-checkmark-outline" size={16} />
        <Text style={styles.previewNoteText}>本地交互预览，不会上传这些照片</Text>
      </View>

      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.year}>{currentYear}</Text>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="按日期查找时光"
            accessibilityRole="button"
            onPress={() => router.push('/memories/calendar')}
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
          >
            <AppIcon color={colors.text} name="calendar-outline" size={21} />
          </Pressable>
          <Pressable
            accessibilityLabel="添加时光"
            accessibilityRole="button"
            onPress={() => router.push('/memories/new')}
            style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
          >
            <AppIcon color={colors.background} name="add" size={21} />
          </Pressable>
        </View>
      </View>

      {groups.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <AppIcon color={colors.primaryStrong} name="images-outline" size={26} />
          </View>
          <Text accessibilityRole="header" style={styles.emptyTitle}>留下第一段时光</Text>
          <Text style={styles.emptyMessage}>选择照片，按日期整理值得回看的生活片段。</Text>
          <AppButton
            icon="image-outline"
            label="添加照片"
            onPress={() => router.push('/memories/new')}
            style={styles.emptyAction}
          />
        </View>
      ) : (
        <View style={styles.timeline}>
          {groups.map((group, groupIndex) => (
            <View key={group.key} style={groupIndex === 0 ? undefined : styles.monthGroup}>
              <View style={styles.monthHeading}>
                <Text accessibilityRole="header" style={styles.monthLabel}>{group.label}</Text>
                <Text style={styles.monthCount}>{group.moments.length} 段时光</Text>
              </View>
              <View style={styles.moments}>
                {group.moments.map((moment) => (
                  <MemoryMomentRow
                    key={moment.id}
                    moment={moment}
                    onPress={() => router.push({
                      pathname: '/memories/[id]',
                      params: { id: moment.id },
                    })}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingTop: 12,
  },
  previewNote: {
    minHeight: 36,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  previewNoteText: {
    flex: 1,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  header: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  year: {
    color: colors.text,
    fontFamily,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  iconButtonPressed: {
    backgroundColor: colors.surface,
  },
  addButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  addButtonPressed: {
    backgroundColor: colors.primaryStrong,
  },
  timeline: {
    paddingBottom: 20,
  },
  monthGroup: {
    marginTop: 36,
  },
  monthHeading: {
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  monthLabel: {
    color: colors.text,
    fontFamily,
    fontSize: 19,
    lineHeight: 27,
    fontWeight: '600',
  },
  monthCount: {
    color: colors.textTertiary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  moments: {
    gap: 32,
  },
  empty: {
    minHeight: 330,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    width: 52,
    height: 52,
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
  },
  emptyMessage: {
    maxWidth: 260,
    marginTop: 7,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  emptyAction: {
    alignSelf: 'stretch',
    marginTop: 20,
  },
});
