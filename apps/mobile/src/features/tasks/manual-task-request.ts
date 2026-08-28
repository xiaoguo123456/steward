import type {
  CreateTaskRequest,
  TaskPriority,
} from '@steward/api-client';

type ManualTaskRequestInput = {
  title: string;
  description: string;
  priority: TaskPriority;
  listId: string;
  focusDate?: string;
  dueDate?: string;
  dueTimezone?: string;
  reminders?: CreateTaskRequest['reminders'];
};

/** 把手工表单的可见字段转换为正式 Task 请求，不从入口上下文补造截止日期。 */
export function buildManualTaskRequest({
  title,
  description,
  priority,
  listId,
  focusDate,
  dueDate,
  dueTimezone,
  reminders,
}: ManualTaskRequestInput): CreateTaskRequest {
  const request: CreateTaskRequest = {
    title: title.trim(),
    priority,
    list_id: listId,
  };

  if (description.trim()) request.description = description.trim();
  if (focusDate) request.focus_date = focusDate;
  if (dueDate) {
    request.due_date = dueDate;
    request.due_timezone = dueTimezone;
    if (reminders?.length) request.reminders = reminders;
  }

  return request;
}
