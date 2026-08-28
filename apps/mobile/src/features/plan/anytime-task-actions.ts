import type { UpdateTaskRequest } from '@steward/api-client';

/** “加入今天”只声明关注日期，不伪造截止时间。 */
export function buildAddToTodayRequest(today: string): UpdateTaskRequest {
  return { focus_date: today };
}

/** 设置日期使用 date-only 截止语义，并保留用户时区。 */
export function buildSetTaskDateRequest(
  date: string,
  timezone: string,
): UpdateTaskRequest {
  return { due_date: date, due_timezone: timezone };
}
