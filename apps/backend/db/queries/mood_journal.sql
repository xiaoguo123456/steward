-- 心情日记查询。正文权威文档来自 notes，结构字段来自一对一扩展表。

-- name: ListMoodJournalEntries :many
SELECT
    n.id, n.user_id, n.title, n.content, n.content_document,
    n.created_at, n.updated_at, n.deleted_at, n.version,
    m.occurred_at, m.mood_level, m.energy_level, m.emotion_words,
    m.context_words, m.exclude_from_ai, m.include_in_memories,
    m.visual_seed, m.version AS mood_version
FROM notes n
JOIN mood_journal_entries m ON m.note_id = n.id
WHERE n.note_kind = 'mood_journal'
  AND n.deleted_at IS NULL
  AND (sqlc.narg(from_at)::timestamptz IS NULL OR m.occurred_at >= sqlc.narg(from_at)::timestamptz)
  AND (sqlc.narg(to_at)::timestamptz IS NULL OR m.occurred_at < sqlc.narg(to_at)::timestamptz)
  AND (sqlc.narg(query)::text IS NULL
       OR n.title ILIKE '%' || sqlc.narg(query)::text || '%'
       OR n.content ILIKE '%' || sqlc.narg(query)::text || '%'
       OR sqlc.narg(query)::text = ANY(m.emotion_words))
  AND (sqlc.narg(cursor_occurred_at)::timestamptz IS NULL
       OR (m.occurred_at, n.id) <
          (sqlc.narg(cursor_occurred_at)::timestamptz, sqlc.narg(cursor_id)::text))
ORDER BY m.occurred_at DESC, n.id DESC
LIMIT sqlc.arg(row_limit);

-- name: GetMoodJournalEntry :one
SELECT
    n.id, n.user_id, n.title, n.content, n.content_document,
    n.created_at, n.updated_at, n.deleted_at, n.version,
    m.occurred_at, m.mood_level, m.energy_level, m.emotion_words,
    m.context_words, m.exclude_from_ai, m.include_in_memories,
    m.visual_seed, m.version AS mood_version
FROM notes n
JOIN mood_journal_entries m ON m.note_id = n.id
WHERE n.id = sqlc.arg(note_id)
  AND n.note_kind = 'mood_journal'
  AND n.deleted_at IS NULL;

-- name: CreateMoodJournalExtension :one
INSERT INTO mood_journal_entries (
    note_id, user_id, occurred_at, mood_level, energy_level,
    emotion_words, context_words, exclude_from_ai, include_in_memories, visual_seed
) VALUES (
    sqlc.arg(note_id), sqlc.arg(user_id), sqlc.arg(occurred_at),
    sqlc.narg(mood_level), sqlc.narg(energy_level), sqlc.arg(emotion_words),
    sqlc.arg(context_words), sqlc.arg(exclude_from_ai),
    sqlc.arg(include_in_memories), sqlc.arg(visual_seed)
)
RETURNING *;

-- name: UpdateMoodJournalNote :one
UPDATE notes SET
    title = CASE WHEN sqlc.arg(clear_title)::bool THEN ''
                 ELSE coalesce(sqlc.narg(title), title) END,
    content = coalesce(sqlc.narg(content), content),
    content_document = coalesce(sqlc.narg(content_document), content_document),
    updated_at = now(),
    version = version + 1
WHERE id = sqlc.arg(note_id)
  AND note_kind = 'mood_journal'
  AND deleted_at IS NULL
RETURNING *;

-- name: UpdateMoodJournalExtension :one
UPDATE mood_journal_entries SET
    occurred_at = coalesce(sqlc.narg(occurred_at), occurred_at),
    mood_level = CASE WHEN sqlc.arg(clear_mood_level)::bool THEN NULL
                      ELSE coalesce(sqlc.narg(mood_level), mood_level) END,
    energy_level = CASE WHEN sqlc.arg(clear_energy_level)::bool THEN NULL
                        ELSE coalesce(sqlc.narg(energy_level), energy_level) END,
    emotion_words = coalesce(sqlc.narg(emotion_words), emotion_words),
    context_words = coalesce(sqlc.narg(context_words), context_words),
    exclude_from_ai = coalesce(sqlc.narg(exclude_from_ai), exclude_from_ai),
    include_in_memories = coalesce(sqlc.narg(include_in_memories), include_in_memories),
    updated_at = now(),
    version = version + 1
WHERE note_id = sqlc.arg(note_id)
RETURNING *;

-- name: SoftDeleteMoodJournalNote :one
UPDATE notes SET deleted_at = now(), updated_at = now(), version = version + 1
WHERE id = sqlc.arg(note_id)
  AND note_kind = 'mood_journal'
  AND deleted_at IS NULL
RETURNING *;

-- name: ListMoodJournalCalendar :many
SELECT (m.occurred_at AT TIME ZONE sqlc.arg(timezone)::text)::date AS date,
       count(*)::int AS count
FROM mood_journal_entries m
JOIN notes n ON n.id = m.note_id
WHERE n.note_kind = 'mood_journal'
  AND n.deleted_at IS NULL
  AND m.occurred_at >= sqlc.arg(from_at)::timestamptz
  AND m.occurred_at < sqlc.arg(to_at)::timestamptz
GROUP BY date
ORDER BY date;

-- name: CountMoodJournalEntries :one
SELECT count(*)::int AS entry_count,
       count(DISTINCT (m.occurred_at AT TIME ZONE sqlc.arg(timezone)::text)::date)::int
           AS writing_day_count
FROM mood_journal_entries m
JOIN notes n ON n.id = m.note_id
WHERE n.note_kind = 'mood_journal'
  AND n.deleted_at IS NULL
  AND m.occurred_at >= sqlc.arg(from_at)::timestamptz
  AND m.occurred_at < sqlc.arg(to_at)::timestamptz;

-- name: CountMoodJournalMoods :many
SELECT m.mood_level, count(*)::int AS count
FROM mood_journal_entries m
JOIN notes n ON n.id = m.note_id
WHERE n.note_kind = 'mood_journal'
  AND n.deleted_at IS NULL
  AND m.mood_level IS NOT NULL
  AND m.occurred_at >= sqlc.arg(from_at)::timestamptz
  AND m.occurred_at < sqlc.arg(to_at)::timestamptz
GROUP BY m.mood_level;

-- name: CountMoodJournalEmotionWords :many
SELECT word::text AS word, count(*)::int AS count
FROM mood_journal_entries m
JOIN notes n ON n.id = m.note_id
CROSS JOIN LATERAL unnest(m.emotion_words) AS word
WHERE n.note_kind = 'mood_journal'
  AND n.deleted_at IS NULL
  AND m.occurred_at >= sqlc.arg(from_at)::timestamptz
  AND m.occurred_at < sqlc.arg(to_at)::timestamptz
GROUP BY word
ORDER BY count DESC, word
LIMIT 8;
