import { useListProjects, type Project } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 清单详情里的项目范围筛选（设计说明 12.1）。
 *
 * 项目不在计划首屏常驻，管理入口挂在这条筛选条的末尾——
 * 用户是在「按项目看任务」的时候才需要管项目的，不是打开计划就需要。
 *
 * 只列进行中的项目：暂停和归档的项目出现在筛选条里只会让它变长，
 * 要找它们去管理页。
 */
export function ProjectScopeBar({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (project: Project | null) => void;
}) {
  const router = useRouter();
  const query = useListProjects({ status: ['active'], limit: 50 });
  const projects = query.data?.data ?? [];

  if (query.isPending) return null;

  return (
    <View style={styles.bar}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        <Chip active={selectedId === null} label="全部" onPress={() => onSelect(null)} />
        {projects.map((project) => (
          <Chip
            active={selectedId === project.id}
            key={project.id}
            label={project.title}
            onPress={() => onSelect(project)}
          />
        ))}
      </ScrollView>
      <Pressable
        accessibilityLabel="管理项目"
        accessibilityRole="button"
        onPress={() => router.push('/lists/projects')}
        style={({ pressed }) => [styles.manage, pressed && styles.pressed]}
      >
        <AppIcon color={colors.textSecondary} name="options-outline" size={18} />
      </Pressable>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`只看${label}的任务`}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
    >
      <Text numberOfLines={1} style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 10,
  },
  scroll: {
    gap: 8,
    paddingRight: 4,
  },
  chip: {
    minHeight: 34,
    maxWidth: 160,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  chipActive: {
    backgroundColor: colors.primarySoft,
  },
  chipText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  chipTextActive: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  manage: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  pressed: {
    opacity: 0.6,
  },
});
