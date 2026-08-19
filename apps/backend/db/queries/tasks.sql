-- Task 查询。Today 的收录与排序完全由这里的确定性 SQL 决定，客户端不得重排。

-- name: ListTasks :many
SELECT * FROM tasks
WHERE deleted_at IS NULL
  AND (cardinality(sqlc.arg(statuses)::text[]) = 0 OR status = ANY (sqlc.arg(statuses)::text[]))
  AND (sqlc.narg(list_id)::text IS NULL OR list_id = sqlc.narg(list_id)::text)
  AND (sqlc.narg(project_id)::text IS NULL OR project_id = sqlc.narg(project_id)::text)
  AND (sqlc.narg(due_before)::date IS NULL OR due_date <= sqlc.narg(due_before)::date)
  AND (sqlc.narg(due_from)::date IS NULL OR due_date >= sqlc.narg(due_from)::date)
  AND (sqlc.narg(scheduled_from)::timestamptz IS NULL
       OR (scheduled_start_at >= sqlc.narg(scheduled_from)::timestamptz
           AND scheduled_start_at <= sqlc.narg(scheduled_to)::timestamptz))
  -- 未安排：todo 且没有任何截止、计划与 focus_date。
  AND (NOT sqlc.arg(unscheduled)::bool
       OR (status = 'todo' AND due_date IS NULL AND due_at IS NULL
           AND scheduled_start_at IS NULL AND focus_date IS NULL))
  AND (sqlc.narg(query)::text IS NULL OR title ILIKE '%' || sqlc.narg(query)::text || '%')
  -- day：与 Today 相同的收录规则，用于“明天”等按天视图。
  AND (sqlc.narg(day)::date IS NULL
       OR (status IN ('todo', 'doing')
           AND (focus_date = sqlc.narg(day)::date
                OR (scheduled_start_at IS NOT NULL
                    AND scheduled_start_at >= sqlc.narg(day_start)::timestamptz
                    AND scheduled_start_at <= sqlc.narg(day_end)::timestamptz)
                OR due_date = sqlc.narg(day)::date
                OR (due_at IS NOT NULL
                    AND due_at >= sqlc.narg(day_start)::timestamptz
                    AND due_at <= sqlc.narg(day_end)::timestamptz))))
  -- 键集分页游标：按 (created_at, id) 递减推进。
  AND (sqlc.narg(cursor_created_at)::timestamptz IS NULL
       OR (created_at, id) < (sqlc.narg(cursor_created_at)::timestamptz, sqlc.narg(cursor_id)::text))
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: GetTask :one
SELECT * FROM tasks WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: CreateTask :one
INSERT INTO tasks (
    id, user_id, title, description, status, priority,
    due_date, due_at, due_timezone,
    scheduled_start_at, scheduled_end_at, scheduled_timezone,
    estimated_minutes, focus_date, list_id, project_id,
    reminders, completed_at, quantity_text, shopping_category,
    created_by, provenance_refs
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(title), sqlc.narg(description),
    sqlc.arg(status), sqlc.arg(priority),
    sqlc.narg(due_date), sqlc.narg(due_at), sqlc.narg(due_timezone),
    sqlc.narg(scheduled_start_at), sqlc.narg(scheduled_end_at), sqlc.narg(scheduled_timezone),
    sqlc.narg(estimated_minutes), sqlc.narg(focus_date), sqlc.arg(list_id), sqlc.narg(project_id),
    sqlc.arg(reminders), sqlc.narg(completed_at),
    sqlc.narg(quantity_text), sqlc.narg(shopping_category),
    sqlc.arg(created_by), sqlc.arg(provenance_refs)
)
RETURNING *;

-- name: UpdateTask :one
-- clear_* 参数对应契约里的 clear 数组：显式清空一个可空字段。
UPDATE tasks SET
    title       = coalesce(sqlc.narg(title), title),
    description = CASE WHEN sqlc.arg(clear_description)::bool THEN NULL
                       ELSE coalesce(sqlc.narg(description), description) END,
    status      = coalesce(sqlc.narg(status), status),
    priority    = coalesce(sqlc.narg(priority), priority),
    due_date    = CASE WHEN sqlc.arg(clear_due_date)::bool THEN NULL
                       WHEN sqlc.narg(due_at)::timestamptz IS NOT NULL THEN NULL
                       ELSE coalesce(sqlc.narg(due_date), due_date) END,
    due_at      = CASE WHEN sqlc.arg(clear_due_at)::bool THEN NULL
                       WHEN sqlc.narg(due_date)::date IS NOT NULL THEN NULL
                       ELSE coalesce(sqlc.narg(due_at), due_at) END,
    due_timezone = CASE
        WHEN sqlc.arg(clear_due_date)::bool AND sqlc.arg(clear_due_at)::bool THEN NULL
        ELSE coalesce(sqlc.narg(due_timezone), due_timezone) END,
    scheduled_start_at = CASE WHEN sqlc.arg(clear_scheduled_start_at)::bool THEN NULL
                              ELSE coalesce(sqlc.narg(scheduled_start_at), scheduled_start_at) END,
    scheduled_end_at   = CASE WHEN sqlc.arg(clear_scheduled_end_at)::bool
                                OR sqlc.arg(clear_scheduled_start_at)::bool THEN NULL
                              ELSE coalesce(sqlc.narg(scheduled_end_at), scheduled_end_at) END,
    scheduled_timezone = CASE WHEN sqlc.arg(clear_scheduled_start_at)::bool THEN NULL
                              ELSE coalesce(sqlc.narg(scheduled_timezone), scheduled_timezone) END,
    estimated_minutes  = CASE WHEN sqlc.arg(clear_estimated_minutes)::bool THEN NULL
                              ELSE coalesce(sqlc.narg(estimated_minutes), estimated_minutes) END,
    focus_date  = CASE WHEN sqlc.arg(clear_focus_date)::bool THEN NULL
                       ELSE coalesce(sqlc.narg(focus_date), focus_date) END,
    list_id     = coalesce(sqlc.narg(list_id), list_id),
    project_id  = CASE WHEN sqlc.arg(clear_project_id)::bool THEN NULL
                       ELSE coalesce(sqlc.narg(project_id), project_id) END,
    reminders   = CASE WHEN sqlc.arg(clear_reminders)::bool THEN '[]'::jsonb
                       ELSE coalesce(sqlc.narg(reminders), reminders) END,
    quantity_text = CASE WHEN sqlc.arg(clear_quantity_text)::bool THEN NULL
                         ELSE coalesce(sqlc.narg(quantity_text), quantity_text) END,
    -- 品类由服务端重新分类后传入，不接受客户端直接指定。
    shopping_category = coalesce(sqlc.narg(shopping_category), shopping_category),
    -- 完成时间由 Domain 计算后传入，保持与 status 一致。
    completed_at = CASE WHEN sqlc.arg(set_completed_at)::bool THEN sqlc.narg(completed_at)
                        ELSE completed_at END,
    updated_at  = now(),
    version     = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteTask :one
UPDATE tasks SET deleted_at = now(), updated_at = now(), version = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: RestoreTask :one
UPDATE tasks SET deleted_at = NULL, updated_at = now(), version = version + 1
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: ListTodayTasks :many
-- 收录条件与分组顺序来自功能规格 8.3 与 8.4：
-- 分组依次为已逾期、今天截止、今天有计划时间、手动加入今天；
-- 一个 Task 同时符合多个分组时只进入最靠前的一个。
WITH scoped AS (
    SELECT t.*,
           tl.name  AS list_name,
           tl.color AS list_color,
           CASE
               WHEN (t.due_date IS NOT NULL AND t.due_date < sqlc.arg(today)::date)
                    OR (t.due_at IS NOT NULL AND t.due_at < sqlc.arg(now_at)::timestamptz)
                   THEN 0
               WHEN t.due_date = sqlc.arg(today)::date
                    OR (t.due_at IS NOT NULL AND t.due_at <= sqlc.arg(day_end)::timestamptz)
                   THEN 1
               WHEN t.scheduled_start_at IS NOT NULL
                    AND t.scheduled_start_at >= sqlc.arg(day_start)::timestamptz
                    AND t.scheduled_start_at <= sqlc.arg(day_end)::timestamptz
                   THEN 2
               ELSE 3
           END AS group_rank
    FROM tasks t
    JOIN task_lists tl ON tl.id = t.list_id
    WHERE t.deleted_at IS NULL
      AND t.status IN ('todo', 'doing')
      AND (
            t.focus_date = sqlc.arg(today)::date
         OR (t.scheduled_start_at IS NOT NULL
             AND t.scheduled_start_at >= sqlc.arg(day_start)::timestamptz
             AND t.scheduled_start_at <= sqlc.arg(day_end)::timestamptz)
         OR (t.due_date IS NOT NULL AND t.due_date <= sqlc.arg(today)::date)
         OR (t.due_at IS NOT NULL AND t.due_at <= sqlc.arg(day_end)::timestamptz)
      )
)
SELECT * FROM scoped
ORDER BY
    group_rank,
    CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
    coalesce(
        due_date,
        (due_at AT TIME ZONE sqlc.arg(tz)::text)::date,
        (scheduled_start_at AT TIME ZONE sqlc.arg(tz)::text)::date,
        focus_date
    ) NULLS LAST,
    -- 同日内有明确时刻的排在只有日期的前面。
    CASE WHEN due_at IS NOT NULL OR scheduled_start_at IS NOT NULL THEN 0 ELSE 1 END,
    coalesce(due_at, scheduled_start_at) NULLS LAST,
    created_at,
    id;

-- name: ListTasksInRange :many
-- 日历用：当天截止或当天有计划时间的 Task。
SELECT * FROM tasks
WHERE deleted_at IS NULL
  AND status IN ('todo', 'doing', 'done')
  AND (sqlc.narg(project_id)::text IS NULL OR project_id = sqlc.narg(project_id)::text)
  AND (
        (due_date IS NOT NULL AND due_date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date)
     OR (due_at IS NOT NULL AND due_at >= sqlc.arg(from_at)::timestamptz AND due_at <= sqlc.arg(to_at)::timestamptz)
     OR (scheduled_start_at IS NOT NULL
         AND scheduled_start_at >= sqlc.arg(from_at)::timestamptz
         AND scheduled_start_at <= sqlc.arg(to_at)::timestamptz)
  )
ORDER BY coalesce(due_at, scheduled_start_at) NULLS LAST, due_date NULLS LAST, created_at;

-- name: CountTasksByProject :one
SELECT
    count(*) FILTER (WHERE status <> 'cancelled')::int AS total,
    count(*) FILTER (WHERE status = 'done')::int       AS done,
    count(*) FILTER (WHERE status IN ('todo', 'doing'))::int AS open
FROM tasks
WHERE project_id = sqlc.arg(project_id) AND deleted_at IS NULL;

-- name: ClearProjectFromTasks :exec
UPDATE tasks SET project_id = NULL, updated_at = now(), version = version + 1
WHERE project_id = sqlc.arg(project_id) AND deleted_at IS NULL;

-- name: SearchTasks :many
SELECT id, title, updated_at FROM tasks
WHERE deleted_at IS NULL AND title ILIKE '%' || sqlc.arg(query)::text || '%'
ORDER BY updated_at DESC
LIMIT sqlc.arg(row_limit);

-- name: CountCompletedTasksBetween :one
SELECT count(*)::int FROM tasks
WHERE deleted_at IS NULL AND status = 'done'
  AND completed_at >= sqlc.arg(from_at)::timestamptz
  AND completed_at < sqlc.arg(to_at)::timestamptz;

-- name: CountCreatedTasksBetween :one
SELECT count(*)::int FROM tasks
WHERE deleted_at IS NULL
  AND created_at >= sqlc.arg(from_at)::timestamptz
  AND created_at < sqlc.arg(to_at)::timestamptz;

-- name: ListCompletedTasksBetween :many
SELECT id, title, completed_at FROM tasks
WHERE deleted_at IS NULL AND status = 'done'
  AND completed_at >= sqlc.arg(from_at)::timestamptz
  AND completed_at < sqlc.arg(to_at)::timestamptz
ORDER BY completed_at DESC
LIMIT sqlc.arg(row_limit);

-- name: CountOverdueTasks :one
SELECT count(*)::int FROM tasks
WHERE deleted_at IS NULL AND status IN ('todo', 'doing')
  AND ((due_date IS NOT NULL AND due_date < sqlc.arg(today)::date)
       OR (due_at IS NOT NULL AND due_at < sqlc.arg(now_at)::timestamptz));
