-- 待提醒判定用的查询。
--
-- 提醒不是独立的行：它是 tasks/events 的 reminders 里一条规则，
-- 加上一次「发生」算出来的时刻。触发时刻在 Go 里算——
-- 涉及用户时区、「提前几天」的日期回退和重要日的年度投影，
-- 写进 SQL 会变成一段没人敢改的表达式。

-- name: ListTasksWithReminders :many
-- 只取带提醒且有截止信息的未完成任务。
-- 已完成或已取消的任务不再提醒：那件事已经不需要用户做了。
SELECT id, title, due_date, due_at, due_timezone, reminders
FROM tasks
WHERE deleted_at IS NULL
  AND status NOT IN ('done', 'cancelled')
  AND jsonb_array_length(reminders) > 0
  AND (due_date IS NOT NULL OR due_at IS NOT NULL)
LIMIT sqlc.arg(row_limit);

-- name: ListEventsWithReminders :many
-- 重要日是 recurrence='yearly' 的全天 Event，
-- 它这一次的发生要投影到当年，因此 start_date 与 recurrence 都要带出来。
SELECT id, title, all_day, start_at, start_date, timezone, recurrence, event_kind, reminders
FROM events
WHERE deleted_at IS NULL
  AND important_date_handled_at IS NULL
  AND jsonb_array_length(reminders) > 0
  AND (start_at IS NOT NULL OR start_date IS NOT NULL)
LIMIT sqlc.arg(row_limit);

-- name: ListReminderDismissals :many
-- 用户消掉过的提醒。只查窗口内的：更早的那些已经超出过期窗口，
-- 本来就不会再浮出来。
SELECT reminder_id, occurrence_date FROM reminder_dismissals
WHERE occurrence_date >= sqlc.arg(since)::date;

-- name: CreateReminderDismissal :exec
-- 重复消掉同一条不报错：客户端网络重试很常见，
-- 而「消掉」本来就是幂等的意图。
INSERT INTO reminder_dismissals (
    id, user_id, source_type, source_id, reminder_id, occurrence_date
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(source_type),
    sqlc.arg(source_id), sqlc.arg(reminder_id), sqlc.arg(occurrence_date)::date
)
ON CONFLICT (user_id, reminder_id, occurrence_date) DO NOTHING;
