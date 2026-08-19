-- Review 快照。确定性指标始终可用，AI 叙述是可选增强。

-- name: UpsertReviewSnapshot :one
INSERT INTO review_snapshots (
    id, user_id, period_kind, period_start, period_end,
    metrics, narrative, suggestions, sources, generated_by, prompt_version, generated_at
) VALUES (
    sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(period_kind),
    sqlc.arg(period_start), sqlc.arg(period_end),
    sqlc.arg(metrics), sqlc.narg(narrative), sqlc.arg(suggestions), sqlc.arg(sources),
    sqlc.arg(generated_by), sqlc.narg(prompt_version), sqlc.narg(generated_at)
)
ON CONFLICT (user_id, period_kind, period_start) DO UPDATE SET
    period_end     = excluded.period_end,
    metrics        = excluded.metrics,
    narrative      = coalesce(excluded.narrative, review_snapshots.narrative),
    suggestions    = excluded.suggestions,
    sources        = excluded.sources,
    generated_by   = excluded.generated_by,
    prompt_version = excluded.prompt_version,
    generated_at   = excluded.generated_at
RETURNING *;

-- name: GetReviewSnapshot :one
SELECT * FROM review_snapshots
WHERE period_kind = sqlc.arg(period_kind) AND period_start = sqlc.arg(period_start);
