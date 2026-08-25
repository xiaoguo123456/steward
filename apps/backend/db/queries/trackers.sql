-- Tracker 与 Record 查询。Record 的 values 结构由 Go Domain 依据 Tracker fields 校验。

-- name: ListTrackers :many
SELECT * FROM trackers
WHERE deleted_at IS NULL
  AND (sqlc.narg(status)::text IS NULL OR status = sqlc.narg(status)::text)
  AND (sqlc.narg(builtin_key)::text IS NULL OR builtin_key = sqlc.narg(builtin_key)::text)
ORDER BY created_at, id;

-- name: GetTracker :one
SELECT * FROM trackers WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: ListTrackerStats :many
-- 每个 Tracker 的记录数与最近记录时间。
-- GROUP BY 保证每个分组至少有一行，因此 max(timestamp) 非空；
-- 没有任何记录的 Tracker 不会出现在结果里，由调用方按 0 与 nil 处理。
SELECT tracker_id,
       count(*)::int AS record_count,
       max(timestamp)::timestamptz AS last_record_at,
       bool_or(timestamp >= sqlc.arg(day_start)::timestamptz
               AND timestamp < sqlc.arg(next_day_start)::timestamptz) AS recorded_today
FROM records
WHERE deleted_at IS NULL
GROUP BY tracker_id;

-- name: CreateTracker :one
INSERT INTO trackers (
    id, user_id, name, description, fields, schedule, status, color, icon,
    builtin_key, created_by, provenance_refs
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(name), sqlc.narg(description),
    sqlc.arg(fields), sqlc.narg(schedule), sqlc.arg(status), sqlc.narg(color), sqlc.narg(icon),
    sqlc.narg(builtin_key), sqlc.arg(created_by), sqlc.arg(provenance_refs)
)
RETURNING *;

-- name: UpdateTracker :one
UPDATE trackers SET
    name        = coalesce(sqlc.narg(name), name),
    description = CASE WHEN sqlc.arg(clear_description)::bool THEN NULL
                       ELSE coalesce(sqlc.narg(description), description) END,
    fields      = coalesce(sqlc.narg(fields), fields),
    schedule    = CASE WHEN sqlc.arg(clear_schedule)::bool THEN NULL
                       ELSE coalesce(sqlc.narg(schedule), schedule) END,
    status      = coalesce(sqlc.narg(status), status),
    color       = CASE WHEN sqlc.arg(clear_color)::bool THEN NULL
                       ELSE coalesce(sqlc.narg(color), color) END,
    icon        = CASE WHEN sqlc.arg(clear_icon)::bool THEN NULL
                       ELSE coalesce(sqlc.narg(icon), icon) END,
    updated_at  = now(),
    version     = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteTracker :one
UPDATE trackers SET deleted_at = now(), updated_at = now(), version = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteRecordsByTracker :exec
UPDATE records SET deleted_at = now(), updated_at = now(), version = version + 1
WHERE tracker_id = sqlc.arg(tracker_id) AND deleted_at IS NULL;

-- name: ListRecords :many
SELECT r.*, t.name AS tracker_name
FROM records r
JOIN trackers t ON t.id = r.tracker_id
WHERE r.deleted_at IS NULL
  AND (sqlc.narg(tracker_id)::text IS NULL OR r.tracker_id = sqlc.narg(tracker_id)::text)
  AND (sqlc.narg(from_at)::timestamptz IS NULL OR r.timestamp >= sqlc.narg(from_at)::timestamptz)
  AND (sqlc.narg(to_at)::timestamptz IS NULL OR r.timestamp <= sqlc.narg(to_at)::timestamptz)
  AND (sqlc.narg(cursor_timestamp)::timestamptz IS NULL
       OR (r.timestamp, r.id) < (sqlc.narg(cursor_timestamp)::timestamptz, sqlc.narg(cursor_id)::text))
ORDER BY r.timestamp DESC, r.id DESC
LIMIT sqlc.arg(row_limit);

-- name: GetRecord :one
SELECT r.*, t.name AS tracker_name
FROM records r
JOIN trackers t ON t.id = r.tracker_id
WHERE r.id = sqlc.arg(id) AND r.deleted_at IS NULL;

-- name: CreateRecord :one
INSERT INTO records (
    id, user_id, title, tracker_id, timestamp, values, note,
    project_id, created_by, provenance_refs
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(title), sqlc.arg(tracker_id),
    sqlc.arg(timestamp), sqlc.arg(values), sqlc.narg(note),
    sqlc.narg(project_id), sqlc.arg(created_by), sqlc.arg(provenance_refs)
)
RETURNING *;

-- name: UpdateRecord :one
UPDATE records SET
    title      = coalesce(sqlc.narg(title), title),
    timestamp  = coalesce(sqlc.narg(timestamp), timestamp),
    values     = coalesce(sqlc.narg(values), values),
    note       = CASE WHEN sqlc.arg(clear_note)::bool THEN NULL
                      ELSE coalesce(sqlc.narg(note), note) END,
    project_id = CASE WHEN sqlc.arg(clear_project_id)::bool THEN NULL
                      ELSE coalesce(sqlc.narg(project_id), project_id) END,
    updated_at = now(),
    version    = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteRecord :one
UPDATE records SET deleted_at = now(), updated_at = now(), version = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: RestoreRecord :one
UPDATE records SET deleted_at = NULL, updated_at = now(), version = version + 1
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: ClearProjectFromRecords :exec
UPDATE records SET project_id = NULL, updated_at = now(), version = version + 1
WHERE project_id = sqlc.arg(project_id) AND deleted_at IS NULL;

-- name: CountRecordsBetween :one
SELECT count(*)::int FROM records
WHERE deleted_at IS NULL
  AND timestamp >= sqlc.arg(from_at)::timestamptz
  AND timestamp < sqlc.arg(to_at)::timestamptz;

-- name: SearchRecords :many
SELECT id, title, updated_at FROM records
WHERE deleted_at IS NULL AND title ILIKE '%' || sqlc.arg(query)::text || '%'
ORDER BY updated_at DESC
LIMIT sqlc.arg(row_limit);

-- name: AggregateRecordField :one
-- records.aggregate 能力用：由 SQL 完成计数、求和、平均与范围，
-- 避免把逐条明细发给模型。字段值取 JSONB 中的数字，非数字项自动跳过。
-- 聚合值统一 coalesce 成 0：没有数据时用 value_count = 0 判断，不要读 average。
--
-- records.values 是 [{key, number_value, text_value}, ...] 这样的数组，
-- 不是以字段名为键的对象。用 -> '字段名' 取值在数组上恒为 NULL，
-- 于是每次聚合都返回 value_count = 0，用户明明有账却被告知"没有记录"。
SELECT
    count(*)::int                                  AS record_count,
    count(v.num)::int                              AS value_count,
    coalesce(sum(v.num), 0)::double precision      AS total,
    coalesce(avg(v.num), 0)::double precision      AS average,
    coalesce(min(v.num), 0)::double precision      AS minimum,
    coalesce(max(v.num), 0)::double precision      AS maximum
FROM records r
LEFT JOIN LATERAL (
    SELECT (elem ->> 'number_value')::double precision AS num
    FROM jsonb_array_elements(r.values) AS elem
    WHERE elem ->> 'key' = sqlc.arg(field_key)::text
      AND jsonb_typeof(elem -> 'number_value') = 'number'
    LIMIT 1
) v ON true
WHERE r.deleted_at IS NULL
  AND r.tracker_id = sqlc.arg(tracker_id)::text
  AND (sqlc.narg(from_at)::timestamptz IS NULL OR r.timestamp >= sqlc.narg(from_at)::timestamptz)
  AND (sqlc.narg(to_at)::timestamptz IS NULL OR r.timestamp < sqlc.narg(to_at)::timestamptz);

-- name: EnsureBuiltinTracker :one
-- 内置记录项按需创建：用户第一次进这个场景时才建，
-- 不在注册时凭空造三个他可能永远不用的记录项。
INSERT INTO trackers (
    id, user_id, name, description, fields, status, color, icon,
    builtin_key, created_by, provenance_refs
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(name), sqlc.narg(description),
    sqlc.arg(fields), 'active', sqlc.narg(color), sqlc.narg(icon),
    sqlc.arg(builtin_key), 'system', '[]'::jsonb
)
ON CONFLICT (user_id, builtin_key) WHERE builtin_key IS NOT NULL AND deleted_at IS NULL
DO UPDATE SET updated_at = now()
RETURNING *;
