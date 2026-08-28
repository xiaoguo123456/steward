import {
  getGetTodayQueryKey,
  getListTasksQueryKey,
  updateTask,
  type Task,
  type UpdateTaskRequest,
} from '@steward/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Task 快捷操作。
 *
 * 完成与重新打开只提交 status：completed_at、Today 收录与排序都由服务端决定，
 * 客户端不做任何本地推导。
 */
export function useToggleTaskDone() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (task: Task) => {
      const nextStatus = task.status === 'done' ? 'todo' : 'done';
      // 带上 If-Match：目标在别处被改过时服务端返回 VERSION_CONFLICT，
      // 而不是用旧状态覆盖新值。
      return updateTask(
        task.id,
        { status: nextStatus },
        { headers: { 'If-Match': String(task.version) } },
      );
    },
    onSuccess: async (response) => {
      // 按响应里的 affected_resources 精确失效，而不是清空全部缓存。
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() }),
        queryClient.invalidateQueries({ queryKey: ['getTask', response.data.id] }),
      ]);
    },
  });
}

/**
 * 任务日期类快捷更新。
 *
 * “加入今天”和“设置日期”仍走正式 Task PATCH，并携带任务当前版本；
 * Today 收录与“随时可做”归属由服务端依据字段重新计算。
 */
export function useUpdateTaskFields() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ data, task }: { data: UpdateTaskRequest; task: Task }) =>
      updateTask(
        task.id,
        data,
        { headers: { 'If-Match': String(task.version) } },
      ),
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetTodayQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() }),
        queryClient.invalidateQueries({ queryKey: ['getTask', response.data.id] }),
      ]);
    },
  });
}
