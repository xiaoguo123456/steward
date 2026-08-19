import { errorMessage, type Project, type ProjectStatus } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import {
  progressLabel,
  projectFilters,
  useProjectsByStatus,
} from '@/features/projects/use-projects';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 项目管理（PRO-00）。
 *
 * 这里没有「新建项目」：项目只从 Capture 来，AI 判断一件事需要多步推进时
 * 才生成 Project 候选，用户确认后创建（设计说明 12.1）。手工建一个空项目
 * 除了制造待清理的空壳没有别的作用。
 */
export default function ProjectsScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<ProjectStatus>('active');
  const { projects, loading, failed, error, refetch, refreshing } = useProjectsByStatus(status);

  return (
    <AppScreen includeBottomInset>
      <NavHeader onBack={() => router.back()} title="项目" />

      <View style={styles.filters}>
        {projectFilters.map((filter) => {
          const active = filter.key === status;
          return (
            <Pressable
              accessibilityLabel={`只看${filter.label}的项目`}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={filter.key}
              onPress={() => setStatus(filter.key)}
              style={({ pressed }) => [
                styles.filter,
                active && styles.filterActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {filter.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl onRefresh={refetch} refreshing={refreshing} />}
        showsVerticalScrollIndicator={false}
      >
        {failed ? (
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(error, '暂时无法加载项目。')}
            onAction={refetch}
            title="加载失败"
          />
        ) : loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : projects.length === 0 ? (
          <StatePanel
            icon="folder-open-outline"
            message={emptyCopy[status]}
            title="暂无项目"
          />
        ) : (
          <View style={styles.rows}>
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                onOpen={() =>
                  router.push({ pathname: '/projects/[id]', params: { id: project.id } })
                }
                project={project}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </AppScreen>
  );
}

const emptyCopy: Record<ProjectStatus, string> = {
  active: '把一个需要分几步完成的目标告诉助理，它会帮你建成项目',
  paused: '暂停的项目会出现在这里',
  completed: '完成的项目会出现在这里',
  archived: '归档的项目会出现在这里，随时可以恢复',
};

/** 项目行：名称、目标日期与进度共用一行，不做互相分离的大卡片。 */
function ProjectRow({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return (
    <Pressable
      accessibilityLabel={`打开项目 ${project.title}`}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowIcon}>
        <AppIcon
          color={colors.primaryStrong}
          name={project.project_kind === 'trip' ? 'airplane-outline' : 'flag-outline'}
          size={19}
        />
      </View>
      <View style={styles.rowBody}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {project.title}
        </Text>
        <Text numberOfLines={1} style={styles.rowMeta}>
          {[project.target_date ? `目标 ${project.target_date}` : null, progressLabel(project)]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filters: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  filter: {
    minHeight: 34,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  filterActive: {
    backgroundColor: colors.primarySoft,
  },
  filterText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  filterTextActive: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  loading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  rows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  rowMeta: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
});
