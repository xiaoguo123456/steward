import type { Project, ProjectStatus } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { projectFilters } from './use-projects';

/**
 * 清单详情里的项目范围筛选（设计说明 10.1）。
 *
 * 状态直接摆在当前页。选中状态后才显示具体项目，避免默认状态把一整排
 * 项目名称和状态混在一起；轻点项目筛选，长按项目打开详情。
 */
export function ProjectScopeBar({
  projects,
  selectedProjectId,
  selectedStatus,
  onSelectProject,
  onSelectStatus,
}: {
  projects: Project[];
  selectedProjectId: string | null;
  selectedStatus: ProjectStatus | null;
  onSelectProject: (project: Project) => void;
  onSelectStatus: (status: ProjectStatus | null) => void;
}) {
  const router = useRouter();
  const scopedProjects = selectedStatus
    ? projects.filter((project) => project.status === selectedStatus)
    : [];

  return (
    <View style={styles.bar}>
      <View style={styles.statusWrap}>
        <Chip
          accessibilityLabel="查看全部项目状态的任务"
          active={selectedStatus === null && selectedProjectId === null}
          label="全部项目"
          onPress={() => onSelectStatus(null)}
        />
        {projectFilters.map((filter) => (
          <Chip
            accessibilityLabel={`只看关联${filter.label}项目的任务`}
            active={selectedStatus === filter.key && selectedProjectId === null}
            key={filter.key}
            label={filter.label}
            onPress={() => onSelectStatus(filter.key)}
          />
        ))}
      </View>

      {scopedProjects.length > 0 ? (
        <ScrollView
          contentContainerStyle={styles.projectScroll}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {scopedProjects.map((project) => (
            <Chip
              accessibilityLabel={`只看项目${project.title}的任务`}
              accessibilityHint="轻点筛选，长按打开项目"
              active={selectedProjectId === project.id}
              key={project.id}
              label={project.title}
              onLongPress={() =>
                router.push({ pathname: '/projects/[id]', params: { id: project.id } })
              }
              onPress={() => onSelectProject(project)}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function Chip({
  accessibilityLabel,
  accessibilityHint,
  label,
  active,
  onLongPress,
  onPress,
}: {
  accessibilityLabel: string;
  accessibilityHint?: string;
  label: string;
  active: boolean;
  onLongPress?: () => void;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityActions={
        onLongPress ? [{ name: 'openProject', label: '打开项目' }] : undefined
      }
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      delayLongPress={450}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'openProject') onLongPress?.();
      }}
      onLongPress={onLongPress}
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
    paddingBottom: 10,
  },
  statusWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  projectScroll: {
    gap: 8,
    paddingTop: 8,
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
  pressed: {
    opacity: 0.6,
  },
});
