-- 亲友档案、互动与人物关联事件。

-- name: ListPeople :many
SELECT * FROM people
WHERE deleted_at IS NULL
  AND (sqlc.narg(relationship_group)::text IS NULL
       OR relationship_group = sqlc.narg(relationship_group)::text)
  AND (sqlc.narg(query)::text IS NULL
       OR name ILIKE '%' || sqlc.narg(query)::text || '%'
       OR coalesce(relationship_label, '') ILIKE '%' || sqlc.narg(query)::text || '%')
  AND (sqlc.narg(cursor_created_at)::timestamptz IS NULL
       OR (created_at, id) < (sqlc.narg(cursor_created_at)::timestamptz, sqlc.narg(cursor_id)::text))
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: GetPerson :one
SELECT * FROM people WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: CreatePerson :one
INSERT INTO people (
    id, user_id, name, relationship_group, relationship_label, note,
    created_by, provenance_refs
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(name), sqlc.arg(relationship_group),
    sqlc.narg(relationship_label), sqlc.narg(note), sqlc.arg(created_by),
    sqlc.arg(provenance_refs)
)
RETURNING *;

-- name: UpdatePerson :one
UPDATE people SET
    name = coalesce(sqlc.narg(name), name),
    relationship_group = coalesce(sqlc.narg(relationship_group), relationship_group),
    relationship_label = CASE WHEN sqlc.arg(clear_relationship_label)::bool THEN NULL
                              ELSE coalesce(sqlc.narg(relationship_label), relationship_label) END,
    note = CASE WHEN sqlc.arg(clear_note)::bool THEN NULL
                ELSE coalesce(sqlc.narg(note), note) END,
    updated_at = now(),
    version = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeletePerson :one
UPDATE people SET deleted_at = now(), updated_at = now(), version = version + 1
WHERE id = sqlc.arg(id) AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeletePersonInteractions :exec
UPDATE person_interactions
SET deleted_at = now(), updated_at = now(), version = version + 1
WHERE person_id = sqlc.arg(person_id) AND deleted_at IS NULL;

-- name: DeleteEventPeopleForPerson :exec
DELETE FROM event_people WHERE person_id = sqlc.arg(person_id);

-- name: ListPersonInteractions :many
SELECT * FROM person_interactions
WHERE person_id = sqlc.arg(person_id) AND deleted_at IS NULL
  AND (sqlc.narg(cursor_occurred_at)::timestamptz IS NULL
       OR (occurred_at, id) < (sqlc.narg(cursor_occurred_at)::timestamptz, sqlc.narg(cursor_id)::text))
ORDER BY occurred_at DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: CreatePersonInteraction :one
INSERT INTO person_interactions (
    id, user_id, person_id, interaction_type, occurred_at, summary, note,
    created_by, provenance_refs
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(person_id), sqlc.arg(interaction_type),
    sqlc.arg(occurred_at), sqlc.arg(summary), sqlc.narg(note),
    sqlc.arg(created_by), sqlc.arg(provenance_refs)
)
RETURNING *;

-- name: GetPersonInteraction :one
SELECT * FROM person_interactions
WHERE id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: LinkEventToPerson :exec
INSERT INTO event_people (event_id, person_id, user_id)
VALUES (sqlc.arg(event_id), sqlc.arg(person_id), sqlc.arg(user_id))
ON CONFLICT (event_id, person_id) DO NOTHING;

-- name: LinkTaskToPerson :exec
INSERT INTO task_people (task_id, person_id, user_id)
VALUES (sqlc.arg(task_id), sqlc.arg(person_id), sqlc.arg(user_id))
ON CONFLICT (task_id, person_id) DO NOTHING;

-- name: ListPersonEvents :many
SELECT e.*
FROM events e
JOIN event_people ep ON ep.event_id = e.id AND ep.user_id = e.user_id
WHERE ep.person_id = sqlc.arg(person_id)
  AND e.deleted_at IS NULL
  AND (sqlc.narg(cursor_created_at)::timestamptz IS NULL
       OR (e.created_at, e.id) < (sqlc.narg(cursor_created_at)::timestamptz, sqlc.narg(cursor_id)::text))
ORDER BY e.created_at DESC, e.id DESC
LIMIT sqlc.arg(row_limit);
