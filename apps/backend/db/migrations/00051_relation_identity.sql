-- +goose Up
-- Relation 的业务身份只由当前用户、关系类型和两个有向端点决定。
-- 先合并历史重复记录的来源，再软删除冗余行，避免新增唯一索引时丢失审计来源。
WITH ranked AS (
    SELECT id,
           first_value(id) OVER (
               PARTITION BY user_id, kind, from_type, from_id, to_type, to_id
               ORDER BY created_at, id
           ) AS survivor_id,
           row_number() OVER (
               PARTITION BY user_id, kind, from_type, from_id, to_type, to_id
               ORDER BY created_at, id
           ) AS row_number
    FROM relations
    WHERE deleted_at IS NULL
), merged AS (
    SELECT ranked.survivor_id,
           coalesce(jsonb_agg(DISTINCT provenance.value)
                    FILTER (WHERE provenance.value IS NOT NULL), '[]'::jsonb) AS provenance_refs
    FROM ranked
    JOIN relations ON relations.id = ranked.id
    LEFT JOIN LATERAL jsonb_array_elements(relations.provenance_refs) AS provenance(value) ON true
    GROUP BY ranked.survivor_id
)
UPDATE relations
SET provenance_refs = merged.provenance_refs
FROM merged
WHERE relations.id = merged.survivor_id;

WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY user_id, kind, from_type, from_id, to_type, to_id
               ORDER BY created_at, id
           ) AS row_number
    FROM relations
    WHERE deleted_at IS NULL
)
UPDATE relations
SET deleted_at = now()
FROM ranked
WHERE relations.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX relations_active_identity_unique
    ON relations (user_id, kind, from_type, from_id, to_type, to_id)
    WHERE deleted_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS relations_active_identity_unique;
