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

-- name: GetCaptureForUpdate :one
-- Worker 在 Provider 返回后必须锁定权威 Capture，再校验 revision 与终态。
-- 这样迟到结果与用户放弃／确认／新 revision 的写入会被数据库串行化。
SELECT * FROM captures WHERE id = sqlc.arg(id) FOR UPDATE;

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

-- 以下查询只做确定性重复检测的范围裁剪。标题、正文与 values 的最终归一化比较
-- 仍由 Go Domain 完成，不能依赖数据库模糊匹配或 AI 相似度。

-- name: ListTaskDuplicateCandidates :many
SELECT id, title, project_id, version FROM tasks
WHERE user_id = sqlc.arg(user_id)
  AND deleted_at IS NULL
  AND status IN ('todo', 'doing')
  AND project_id IS NOT DISTINCT FROM sqlc.narg(project_id)::text
ORDER BY updated_at DESC, id;

-- name: ListTimedEventDuplicateCandidates :many
SELECT id, title, version FROM events
WHERE user_id = sqlc.arg(user_id)
  AND deleted_at IS NULL
  AND all_day = false
  AND start_at BETWEEN sqlc.arg(start_at)::timestamptz - interval '15 minutes'
                   AND sqlc.arg(start_at)::timestamptz + interval '15 minutes'
ORDER BY abs(extract(epoch FROM (start_at - sqlc.arg(start_at)::timestamptz))), id;

-- name: ListAllDayEventDuplicateCandidates :many
SELECT id, title, version FROM events
WHERE user_id = sqlc.arg(user_id)
  AND deleted_at IS NULL
  AND all_day = true
  AND start_date = sqlc.arg(start_date)::date
  AND coalesce(end_date, start_date) = sqlc.arg(end_date)::date
ORDER BY id;

-- name: ListProjectDuplicateCandidates :many
SELECT id, title, version FROM projects
WHERE user_id = sqlc.arg(user_id)
  AND deleted_at IS NULL
  AND status <> 'archived'
ORDER BY updated_at DESC, id;

-- name: ListNoteDuplicateCandidates :many
SELECT id, title, content, version FROM notes
WHERE user_id = sqlc.arg(user_id)
  AND deleted_at IS NULL
ORDER BY updated_at DESC, id;

-- name: ListRecordDuplicateCandidates :many
SELECT id, values, version FROM records
WHERE user_id = sqlc.arg(user_id)
  AND deleted_at IS NULL
  AND tracker_id = sqlc.arg(tracker_id)
  AND timestamp = sqlc.arg(timestamp)
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

-- name: IgnoreUnprocessedParts :exec
-- 关闭智能整理时把还没处理的媒体项标为 ignored。
-- 留在 pending 会让界面一直显示"处理中"，而它们根本不会被处理。
UPDATE capture_parts SET status = 'ignored'
WHERE capture_id = sqlc.arg(capture_id)
  AND revision = sqlc.arg(revision)
  AND status = 'pending';

-- name: RelationEndpointExists :one
-- Relation 端点必须是当前用户仍存在的正式 Object；Tracker 不是端点。
SELECT CASE sqlc.arg(object_type)::text
    WHEN 'task' THEN EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.user_id = sqlc.arg(relation_user_id) AND t.id = sqlc.arg(relation_object_id) AND t.deleted_at IS NULL
    )
    WHEN 'event' THEN EXISTS (
        SELECT 1 FROM events e
        WHERE e.user_id = sqlc.arg(relation_user_id) AND e.id = sqlc.arg(relation_object_id) AND e.deleted_at IS NULL
    )
    WHEN 'project' THEN EXISTS (
        SELECT 1 FROM projects p
        WHERE p.user_id = sqlc.arg(relation_user_id) AND p.id = sqlc.arg(relation_object_id) AND p.deleted_at IS NULL
    )
    WHEN 'note' THEN EXISTS (
        SELECT 1 FROM notes n
        WHERE n.user_id = sqlc.arg(relation_user_id) AND n.id = sqlc.arg(relation_object_id) AND n.deleted_at IS NULL
    )
    WHEN 'record' THEN EXISTS (
        SELECT 1 FROM records r
        WHERE r.user_id = sqlc.arg(relation_user_id) AND r.id = sqlc.arg(relation_object_id) AND r.deleted_at IS NULL
    )
    ELSE false
END AS exists;

-- name: GetActiveRelationByIdentity :one
SELECT * FROM relations
WHERE user_id = sqlc.arg(user_id)
  AND kind = sqlc.arg(kind)
  AND from_type = sqlc.arg(from_type)
  AND from_id = sqlc.arg(from_id)
  AND to_type = sqlc.arg(to_type)
  AND to_id = sqlc.arg(to_id)
  AND deleted_at IS NULL;

-- name: UpsertActiveRelation :one
-- 部分唯一索引让不同 Capture 的并发确认也只生成一条正式关系。
-- 重放时只追加尚未包含的来源，避免同一来源重复膨胀。
INSERT INTO relations (
    id, user_id, kind, from_type, from_id, to_type, to_id, created_by, provenance_refs
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(kind),
    sqlc.arg(from_type), sqlc.arg(from_id), sqlc.arg(to_type), sqlc.arg(to_id),
    sqlc.arg(created_by), sqlc.arg(provenance_refs)
)
ON CONFLICT (user_id, kind, from_type, from_id, to_type, to_id)
    WHERE deleted_at IS NULL
DO UPDATE SET provenance_refs = CASE
    WHEN relations.provenance_refs @> excluded.provenance_refs THEN relations.provenance_refs
    ELSE relations.provenance_refs || excluded.provenance_refs
END
RETURNING *;

-- Capture 更新保留首次 created_from，并把本次 updated_from 追加到当前实体。
-- name: AppendTaskCaptureProvenance :execrows
UPDATE tasks SET provenance_refs = provenance_refs || sqlc.arg(provenance_refs)::jsonb
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id);

-- name: AppendEventCaptureProvenance :execrows
UPDATE events SET provenance_refs = provenance_refs || sqlc.arg(provenance_refs)::jsonb
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id);

-- name: AppendProjectCaptureProvenance :execrows
UPDATE projects SET provenance_refs = provenance_refs || sqlc.arg(provenance_refs)::jsonb
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id);

-- name: AppendNoteCaptureProvenance :execrows
UPDATE notes SET provenance_refs = provenance_refs || sqlc.arg(provenance_refs)::jsonb
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id);

-- name: AppendTrackerCaptureProvenance :execrows
UPDATE trackers SET provenance_refs = provenance_refs || sqlc.arg(provenance_refs)::jsonb
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id);

-- name: AppendRecordCaptureProvenance :execrows
UPDATE records SET provenance_refs = provenance_refs || sqlc.arg(provenance_refs)::jsonb
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id);
