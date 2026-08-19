import {
  deleteProject,
  errorMessage,
  isApiError,
  updateProject,
  useListProjects,
  type Project,
  type ProjectStatus,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * 项目管理的数据层。
 *
 * 项目不在计划首屏常驻，也不提供手工新建入口（设计说明 12.1）：
 * 新项目只从 Capture 里来，AI 判断一件事需要持续推进时才生成 Project 候选。
 * 所以这里只有「读、改状态、删」，没有 create。
 */

/** 管理页的四个筛选分组，顺序与设计说明 12.1 一致。 */
export const projectFilters = [
  { key: 'active', label: '进行中' },
  { key: 'paused', label: '已暂停' },
  { key: 'completed', label: '已完成' },
  { key: 'archived', label: '已归档' },
] as const satisfies readonly { key: ProjectStatus; label: string }[];

export const projectStatusLabels: Record<ProjectStatus, string> = {
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  archived: '已归档',
};

/**
 * 状态机（设计说明 12.2）。
 *
 * 写在一处而不是散在按钮上：少一个分支就会出现「归档后回不去」这种死角。
 * archived 没有列在这里——它只能恢复到归档前的状态，那个目标要读
 * status_before_archived 才知道，由 restoreTargetOf 给出。
 */
const transitions: Record<ProjectStatus, { status: ProjectStatus; label: string }[]> = {
  active: [
    { status: 'paused', label: '暂停项目' },
    { status: 'completed', label: '标记完成' },
    { status: 'archived', label: '归档项目' },
  ],
  paused: [
    { status: 'active', label: '恢复项目' },
    { status: 'completed', label: '标记完成' },
    { status: 'archived', label: '归档项目' },
  ],
  completed: [
    { status: 'active', label: '重新打开' },
    { status: 'archived', label: '归档项目' },
  ],
  archived: [],
};

/** 某个状态下允许切换到哪些状态。 */
export function transitionsOf(project: Project): { status: ProjectStatus; label: string }[] {
  if (project.status !== 'archived') return transitions[project.status];
  return [{ status: restoreTargetOf(project), label: '恢复项目' }];
}

/**
 * 归档项目恢复后回到哪个状态。
 *
 * 服务端记了归档前的状态，客户端不该一律恢复成 active——
 * 一个归档前已完成的项目恢复成进行中，等于替用户改了结论。
 */
export function restoreTargetOf(project: Project): ProjectStatus {
  const before = project.status_before_archived;
  if (before && before !== 'archived') return before;
  return 'active';
}

/** 进度文案。没有有效 Task 时不显示 0%（设计说明 12.1）。 */
export function progressLabel(project: Project): string {
  if (project.progress === null || project.progress === undefined) return '暂无有效任务';
  const { done, total } = taskCounts(project);
  return `${Math.round(project.progress * 100)}% · ${done}/${total}`;
}

/** 未完成任务数。标记完成前要先把它摆给用户看。 */
export function openTaskCount(project: Project): number {
  const { done, total } = taskCounts(project);
  return Math.max(0, total - done);
}

// 契约里 task_total / task_done 是可选字段，缺失当 0 处理。
function taskCounts(project: Project): { done: number; total: number } {
  return { done: project.task_done ?? 0, total: project.task_total ?? 0 };
}

/** 按状态读项目列表。 */
export function useProjectsByStatus(status: ProjectStatus) {
  const query = useListProjects({ status: [status], limit: 100 });
  return {
    projects: query.data?.data ?? [],
    loading: query.isPending,
    failed: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
    refreshing: query.isRefetching,
  };
}

/** 项目的写操作。改状态、改字段与删除共用一套忙碌与错误状态。 */
export function useProjectActions() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // 未完成任务拦截：服务端返回 PROJECT_HAS_OPEN_TASKS 时把决定权交回用户，
  // 不自动补 force 重发——那等于替他跳过了这道确认。
  const [openTasksBlocked, setOpenTasksBlocked] = useState(false);

  const run = async (action: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    setBusy(true);
    setFailure(null);
    setOpenTasksBlocked(false);
    try {
      await action();
      await queryClient.invalidateQueries();
      return true;
    } catch (error) {
      if (isOpenTasksError(error)) {
        setOpenTasksBlocked(true);
        return false;
      }
      setFailure(errorMessage(error, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    failure,
    openTasksBlocked,
    dismiss: () => {
      setFailure(null);
      setOpenTasksBlocked(false);
    },

    changeStatus: (project: Project, status: ProjectStatus, force = false) =>
      run(
        () =>
          updateProject(
            project.id,
            { status, ...(force ? { force: true } : {}) },
            { headers: { 'If-Match': String(project.version) } },
          ),
        '状态没能保存。',
      ),

    rename: (project: Project, title: string) =>
      run(
        () =>
          updateProject(
            project.id,
            { title },
            { headers: { 'If-Match': String(project.version) } },
          ),
        '改名没能保存。',
      ),

    setTargetDate: (project: Project, targetDate: string | null) =>
      run(
        () =>
          updateProject(
            project.id,
            // 清空可空字段要走 clear：生成的 Go 类型分不清「不传」和「传 null」。
            targetDate === null ? { clear: ['target_date'] } : { target_date: targetDate },
            { headers: { 'If-Match': String(project.version) } },
          ),
        '目标日期没能保存。',
      ),

    remove: (project: Project) =>
      run(() => deleteProject(project.id), '删除没能完成。'),
  };
}

/** 服务端要求先确认未完成任务时返回的错误。只认错误码，不解析文案。 */
function isOpenTasksError(error: unknown): boolean {
  return isApiError(error) && error.code === 'PROJECT_HAS_OPEN_TASKS';
}
