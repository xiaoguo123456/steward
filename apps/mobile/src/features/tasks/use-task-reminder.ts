import {
  errorMessage,
  updateTask,
  useGetUserPreferences,
  type Reminder,
  type ReminderInput,
  type Task,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * 任务的到期提醒。
 *
 * 任务在这一版只有「某日截止」而没有具体时刻，所以提醒只能是
 * absolute_local——「提前几天的当地某点」。相对提醒（开始前 N 分钟）
 * 对一个没有时刻的事项无从算起，服务端也会拒绝。
 *
 * 那个「某点」用用户在偏好里设过的默认提醒时间，不是我们凭空假设的：
 * 偏好页写着「全天日程和只写了日期的截止，会在这个时间提醒你」，
 * 这里正是兑现那句话。规格 209 行要求的也是这个——不能自动假设时刻，
 * 但用户设过的不算假设。
 */
export function useTaskReminder() {
  const queryClient = useQueryClient();
  const preferences = useGetUserPreferences();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const defaultTime = preferences.data?.data.default_reminder_local_time ?? '09:00';

  const setEnabled = async (task: Task, enabled: boolean) => {
    setSaving(true);
    setFailure(null);
    try {
      await updateTask(
        task.id,
        { reminders: enabled ? [dayOfReminder(defaultTime)] : [] },
        // 带版本号：别处改过这条任务时宁可冲突，也不要覆盖掉。
        { headers: { 'If-Match': String(task.version) } },
      );
      await queryClient.invalidateQueries();
      return true;
    } catch (error) {
      setFailure(errorMessage(error, '提醒设置没能保存。'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { defaultTime, saving, failure, setEnabled };
}

/** 到期当天、当地某点提醒。 */
export function dayOfReminder(localTime: string): ReminderInput {
  return { kind: 'absolute_local', local_time: localTime, days_before: 0 };
}

/** 这条任务有没有设过提醒。 */
export function hasReminder(task: Task): boolean {
  return (task.reminders ?? []).length > 0;
}

/**
 * 提醒的说明文字。
 *
 * 说清楚哪天几点，而不是只说「已开启」——用户设完要能确认自己设对了。
 */
export function describeTaskReminder(reminders: Reminder[] | undefined): string {
  const rule = (reminders ?? [])[0];
  if (!rule) return '不提醒';
  if (rule.kind === 'relative' && rule.offset_minutes !== undefined && rule.offset_minutes !== null) {
    return `提前 ${rule.offset_minutes} 分钟`;
  }
  if (rule.kind === 'absolute_local' && rule.local_time) {
    const days = rule.days_before ?? 0;
    return days > 0 ? `提前 ${days} 天 ${rule.local_time}` : `当天 ${rule.local_time}`;
  }
  return '已设置';
}
