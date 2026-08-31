import { errorMessage, useListMemoryMoments } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { StatePanel } from '@/components/ui/state-panel';
import { colors, fontFamily, radius } from '@/theme/tokens';
import { groupMemoryMoments, toMemoryMoment } from './memory-model';
import { MemoryMomentRow } from './memory-moment-row';

export function MemoriesHome() {
  const router = useRouter();
  const query = useListMemoryMoments({ limit: 100 }, {
    query: { staleTime: 3 * 60 * 1000 },
  });
  const moments = useMemo(
    () => (query.data?.data ?? []).map(toMemoryMoment),
    [query.data?.data],
  );
  const groups = groupMemoryMoments(moments);
  const currentYear = groups[0]?.year ?? new Date().getFullYear();
  const addMemory = () => router.push({
    pathname: '/memories/new',
    params: { pick: '1' },
  });

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.year}>{currentYear}</Text>
        <View style={styles.headerActions}>
          <AppButton
            accessibilityLabel="按日期查找时光"
            compact
            icon="calendar-outline"
            label="按日期"
            onPress={() => router.push('/memories/calendar')}
            variant="neutral"
          />
          <AppButton
            accessibilityLabel="选择照片添加时光"
            compact
            icon="images-outline"
            label="选照片"
            onPress={addMemory}
            variant="secondary"
          />
        </View>
      </View>

      {query.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : query.isError ? (
        <StatePanel
          actionLabel="重试"
          compact
          icon="cloud-offline-outline"
          message={errorMessage(query.error, '服务出现问题，请稍后重试。')}
          onAction={() => void query.refetch()}
          title="时光没有加载出来"
        />
      ) : groups.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <AppIcon color={colors.primaryStrong} name="images-outline" size={26} />
          </View>
          <Text accessibilityRole="header" style={styles.emptyTitle}>留下第一段时光</Text>
          <AppButton
            icon="image-outline"
            label="添加照片"
            onPress={addMemory}
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
    gap: 8,
  },
  timeline: {
    paddingBottom: 20,
  },
  loading: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
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
  emptyAction: {
    alignSelf: 'stretch',
    marginTop: 20,
  },
});
