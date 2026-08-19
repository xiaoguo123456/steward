-- Event 查询。yearly 重复的重要日在应用层按查询范围投影，数据库只保存原始定义。

-- name: ListEvents :many
SELECT * FROM events
WHERE deleted_at IS NULL
  AND (sqlc.narg(event_kind)::text IS NULL OR event_kind = sqlc.narg(event_kind)::text)
  AND (sqlc.narg(project_id)::text IS NULL OR project_id = sqlc.narg(project_id)::text)
  AND (
        sqlc.narg(from_at)::timestamptz IS NULL
     -- 按年重复的重要日不受查询窗口限制，由应用层投影到具体年份。
     OR recurrence = 'yearly'
     OR (start_at IS NOT NULL
         AND start_at >= sqlc.narg(from_at)::timestamptz
         AND start_at <= sqlc.arg(to_at)::timestamptz)
     OR (start_date IS NOT NULL
         AND start_date <= sqlc.arg(to_date)::date
         AND coalesce(end_date, start_date) >= sqlc.arg(from_date)::date)
  )
  AND (sqlc.narg(cursor_created_at)::timestamptz IS NULL
       OR (created_at, id) < (sqlc.narg(cursor_created_at)::timestamptz, sqlc.narg(cursor_id)::text))
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: ListEventsInRange :many
-- 日历与 Today 用：只返回定时与全天事件的原始行，投影在应用层完成。
SELECT * FROM events
WHERE deleted_at IS NULL
  AND (sqlc.narg(project_id)::text IS NULL OR project_id = sqlc.narg(project_id)::text)
  AND (
        recurrence = 'yearly'
     OR (start_at IS NOT NULL
         AND start_at >= sqlc.arg(from_at)::timestamptz
         AND start_at <= sqlc.arg(to_at)::timestamptz)
     OR (start_date IS NOT NULL
         AND start_date <= sqlc.arg(to_date)::date
         AND coalesce(end_date, start_date) >= sqlc.arg(from_date)::date)
  )
ORDER BY all_day DESC, start_at NULLS FIRST, start_date NULLS FIRST, created_at;

-- name: GetEvent :one
SELECT * FROM events WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: CreateEvent :one
INSERT INTO events (
    id, user_id, title, event_kind, all_day,
    start_at, end_at, start_date, end_date, timezone,
    location, participants, project_id, note, reminders,
    recurrence, original_month_day, created_by, provenance_refs
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(title), sqlc.arg(event_kind), sqlc.arg(all_day),
    sqlc.narg(start_at), sqlc.narg(end_at), sqlc.narg(start_date), sqlc.narg(end_date), sqlc.arg(timezone),
    sqlc.narg(location), sqlc.arg(participants), sqlc.narg(project_id), sqlc.narg(note), sqlc.arg(reminders),
    sqlc.arg(recurrence), sqlc.narg(original_month_day), sqlc.arg(created_by), sqlc.arg(provenance_refs)
)
RETURNING *;

-- name: UpdateEvent :one
UPDATE events SET
    title      = coalesce(sqlc.narg(title), title),
    event_kind = coalesce(sqlc.narg(event_kind), event_kind),
    all_day    = coalesce(sqlc.narg(all_day), all_day),
    start_at   = CASE WHEN sqlc.arg(clear_start_at)::bool THEN NULL
                      ELSE coalesce(sqlc.narg(start_at), start_at) END,
    end_at     = CASE WHEN sqlc.arg(clear_end_at)::bool THEN NULL
                      ELSE coalesce(sqlc.narg(end_at), end_at) END,
    start_date = CASE WHEN sqlc.arg(clear_start_date)::bool THEN NULL
                      ELSE coalesce(sqlc.narg(start_date), start_date) END,
    end_date   = CASE WHEN sqlc.arg(clear_end_date)::bool THEN NULL
                      ELSE coalesce(sqlc.narg(end_date), end_date) END,
    timezone   = coalesce(sqlc.narg(timezone), timezone),
    location   = CASE WHEN sqlc.arg(clear_location)::bool THEN NULL
                      ELSE coalesce(sqlc.narg(location), location) END,
    participants = CASE WHEN sqlc.arg(clear_participants)::bool THEN '[]'::jsonb
                        ELSE coalesce(sqlc.narg(participants), participants) END,
    project_id = CASE WHEN sqlc.arg(clear_project_id)::bool THEN NULL
                      ELSE coalesce(sqlc.narg(project_id), project_id) END,
    note       = CASE WHEN sqlc.arg(clear_note)::bool THEN NULL
                      ELSE coalesce(sqlc.narg(note), note) END,
    reminders  = CASE WHEN sqlc.arg(clear_reminders)::bool THEN '[]'::jsonb
                      ELSE coalesce(sqlc.narg(reminders), reminders) END,
    recurrence = coalesce(sqlc.narg(recurrence), recurrence),
    original_month_day = coalesce(sqlc.narg(original_month_day), original_month_day),
    updated_at = now(),
    version    = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteEvent :one
UPDATE events SET deleted_at = now(), updated_at = now(), version = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: RestoreEvent :one
UPDATE events SET deleted_at = NULL, updated_at = now(), version = version + 1
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: ClearProjectFromEvents :exec
UPDATE events SET project_id = NULL, updated_at = now(), version = version + 1
WHERE project_id = sqlc.arg(project_id) AND deleted_at IS NULL;

-- name: SearchEvents :many
SELECT id, title, updated_at FROM events
WHERE deleted_at IS NULL AND title ILIKE '%' || sqlc.arg(query)::text || '%'
ORDER BY updated_at DESC
LIMIT sqlc.arg(row_limit);
