-- Capture 临时输入域。所有查询都限定在最新 revision，旧 revision 只供审计。

-- name: CreateCapture :one
INSERT INTO captures (id, user_id, status, revision, origin, suggested_project_id, timezone)
VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(status), 1,
    sqlc.arg(origin), sqlc.narg(suggested_project_id), sqlc.arg(timezone)
)
RETURNING *;

-- name: GetCapture :one
SELECT * FROM captures WHERE id = sqlc.arg(id);

-- name: UpdateCaptureStatus :one
UPDATE captures SET
    status           = sqlc.arg(status),
    error            = sqlc.narg(error),
    instruction_note = coalesce(sqlc.narg(instruction_note), instruction_note),
    updated_at       = now()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: BumpCaptureRevision :one
UPDATE captures SET revision = revision + 1, status = sqlc.arg(status), updated_at = now()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: MarkCaptureConfirmed :one
UPDATE captures SET
    status            = 'confirmed',
    confirmed_at      = now(),
    activity_batch_id = sqlc.arg(activity_batch_id),
    updated_at        = now()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: CreateCapturePart :one
INSERT INTO capture_parts (
    id, user_id, capture_id, revision, kind, status, position, text, media_id, media_url, duration_ms
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(capture_id), sqlc.arg(revision),
    sqlc.arg(kind), sqlc.arg(status), sqlc.arg(position),
    sqlc.narg(text), sqlc.narg(media_id), sqlc.narg(media_url), sqlc.narg(duration_ms)
)
RETURNING *;

-- name: ListCaptureParts :many
SELECT * FROM capture_parts
WHERE capture_id = sqlc.arg(capture_id) AND revision = sqlc.arg(revision)
ORDER BY position, id;

-- name: UpdateCapturePartResult :exec
UPDATE capture_parts SET status = sqlc.arg(status), text = sqlc.narg(text), error = sqlc.narg(error)
WHERE id = sqlc.arg(id);

-- name: CopyCapturePartsToRevision :exec
-- 追加说明后生成新 revision 时，保留原有输入项并复用其处理结果。
INSERT INTO capture_parts (
    id, user_id, capture_id, revision, kind, status, position, text, media_id, media_url, duration_ms
)
SELECT sqlc.arg(id_prefix)::text || p.id, p.user_id, p.capture_id, sqlc.arg(new_revision),
       p.kind, p.status, p.position, p.text, p.media_id, p.media_url, p.duration_ms
FROM capture_parts p
WHERE p.capture_id = sqlc.arg(capture_id) AND p.revision = sqlc.arg(old_revision);

-- name: CreateCaptureCandidate :one
INSERT INTO capture_candidates (
    id, user_id, capture_id, revision, candidate_type, action,
    target_id, target_expected_version, selected, payload,
    field_confidences, source_refs, missing_fields, warnings, duplicate_of, position
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(capture_id), sqlc.arg(revision),
    sqlc.arg(candidate_type), sqlc.arg(action),
    sqlc.narg(target_id), sqlc.narg(target_expected_version), sqlc.arg(selected), sqlc.arg(payload),
    sqlc.arg(field_confidences), sqlc.arg(source_refs), sqlc.arg(missing_fields),
    sqlc.arg(warnings), sqlc.narg(duplicate_of), sqlc.arg(position)
)
RETURNING *;

-- name: ListCaptureCandidates :many
SELECT * FROM capture_candidates
WHERE capture_id = sqlc.arg(capture_id) AND revision = sqlc.arg(revision)
ORDER BY position, id;

-- name: GetCaptureCandidate :one
SELECT * FROM capture_candidates
WHERE id = sqlc.arg(id) AND capture_id = sqlc.arg(capture_id) AND revision = sqlc.arg(revision);

-- name: CreateCaptureRelationCandidate :exec
INSERT INTO capture_relation_candidates (id, user_id, capture_id, revision, kind, from_ref, to_ref)
VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(capture_id), sqlc.arg(revision),
    sqlc.arg(kind), sqlc.arg(from_ref), sqlc.arg(to_ref)
);

-- name: ListCaptureRelationCandidates :many
SELECT * FROM capture_relation_candidates
WHERE capture_id = sqlc.arg(capture_id) AND revision = sqlc.arg(revision)
ORDER BY id;

-- name: CreateCaptureQuestion :one
INSERT INTO capture_questions (
    id, user_id, capture_id, revision, question, blocking, status, quick_answers, capture_summary
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(capture_id), sqlc.arg(revision),
    sqlc.arg(question), sqlc.arg(blocking), 'open', sqlc.arg(quick_answers), sqlc.arg(capture_summary)
)
RETURNING *;

-- name: GetCaptureQuestion :one
SELECT * FROM capture_questions WHERE id = sqlc.arg(id);

-- name: ListCaptureQuestions :many
SELECT * FROM capture_questions
WHERE status = sqlc.arg(status)
  AND (sqlc.narg(cursor_created_at)::timestamptz IS NULL
       OR (created_at, id) < (sqlc.narg(cursor_created_at)::timestamptz, sqlc.narg(cursor_id)::text))
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(row_limit);

-- name: ListCaptureQuestionsForCapture :many
SELECT * FROM capture_questions
WHERE capture_id = sqlc.arg(capture_id) AND revision = sqlc.arg(revision)
ORDER BY created_at, id;

-- name: AnswerCaptureQuestion :one
UPDATE capture_questions SET status = 'answered', answer_text = sqlc.arg(answer_text), answered_at = now()
WHERE id = sqlc.arg(id) AND status = 'open'
RETURNING *;

-- name: SupersedeCaptureQuestions :exec
UPDATE capture_questions SET status = 'superseded'
WHERE capture_id = sqlc.arg(capture_id) AND revision < sqlc.arg(revision) AND status = 'open';

-- name: CreateCaptureConflict :exec
INSERT INTO capture_conflicts (id, user_id, capture_id, revision, field, description, options)
VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(capture_id), sqlc.arg(revision),
    sqlc.arg(field), sqlc.arg(description), sqlc.arg(options)
);

-- name: ListCaptureConflicts :many
SELECT * FROM capture_conflicts
WHERE capture_id = sqlc.arg(capture_id) AND revision = sqlc.arg(revision)
ORDER BY id;

-- name: CountOpenCaptureQuestions :one
SELECT count(*)::int FROM capture_questions WHERE status = 'open';
