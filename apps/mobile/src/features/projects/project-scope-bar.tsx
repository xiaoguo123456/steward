import type { Project, ProjectStatus } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { FilterChip } from '@/components/ui/filter-chip';
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
        <FilterChip
          accessibilityLabel="查看全部项目状态的任务"
          label="全部项目"
          onPress={() => onSelectStatus(null)}
          selected={selectedStatus === null && selectedProjectId === null}
        />
        {projectFilters.map((filter) => (
          <FilterChip
            accessibilityLabel={`只看关联${filter.label}项目的任务`}
            key={filter.key}
            label={filter.label}
            onPress={() => onSelectStatus(filter.key)}
            selected={selectedStatus === filter.key && selectedProjectId === null}
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
            <FilterChip
              accessibilityLabel={`只看项目${project.title}的任务`}
              accessibilityHint="轻点筛选，长按打开项目"
              key={project.id}
              label={project.title}
              longPressActionLabel="打开项目"
              onLongPress={() =>
                router.push({ pathname: '/projects/[id]', params: { id: project.id } })
              }
              onPress={() => onSelectProject(project)}
              selected={selectedProjectId === project.id}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
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
});
