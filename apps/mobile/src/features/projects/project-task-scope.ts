import type { ProjectStatus } from '@steward/api-client';

export type ProjectTaskScope = {
  status: ProjectStatus | null;
  projectId: string | null;
};

/**
 * 清单详情里的 Project 筛选是纯展示逻辑：服务端仍负责 Task 与 Project 的
 * 权威归属，客户端只按已经返回的 project_id 和 Project 状态缩小当前列表。
 */
export function filterTasksByProjectScope<T extends { project_id?: string | null }>(
  tasks: readonly T[],
  projects: readonly { id: string; status: ProjectStatus }[],
  scope: ProjectTaskScope,
): T[] {
  if (scope.projectId) {
    return tasks.filter((task) => task.project_id === scope.projectId);
  }
  if (!scope.status) return [...tasks];

  const projectIds = new Set(
    projects.filter((project) => project.status === scope.status).map((project) => project.id),
  );
  return tasks.filter((task) => Boolean(task.project_id && projectIds.has(task.project_id)));
}

