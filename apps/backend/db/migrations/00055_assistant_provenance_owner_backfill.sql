-- +goose Up
-- 非超级用户的表拥有者也必须修复存量来源，临时解除 FORCE 后在同一事务恢复。
-- 只补齐 Assistant 建议来源的创建语义，保留其他来源及数组顺序。
ALTER TABLE tasks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE events NO FORCE ROW LEVEL SECURITY;

UPDATE tasks SET provenance_refs = (
    SELECT jsonb_agg(CASE
        WHEN ref->>'source_type' = 'assistant_proposal' AND coalesce(ref->>'action', '') = ''
        THEN ref || '{"action":"created_from"}'::jsonb ELSE ref END ORDER BY ordinal)
    FROM jsonb_array_elements(provenance_refs) WITH ORDINALITY AS item(ref, ordinal)
)
WHERE jsonb_typeof(provenance_refs) = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(provenance_refs) AS ref
      WHERE ref->>'source_type' = 'assistant_proposal' AND coalesce(ref->>'action', '') = '');

UPDATE events SET provenance_refs = (
    SELECT jsonb_agg(CASE
        WHEN ref->>'source_type' = 'assistant_proposal' AND coalesce(ref->>'action', '') = ''
        THEN ref || '{"action":"created_from"}'::jsonb ELSE ref END ORDER BY ordinal)
    FROM jsonb_array_elements(provenance_refs) WITH ORDINALITY AS item(ref, ordinal)
)
WHERE jsonb_typeof(provenance_refs) = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(provenance_refs) AS ref
      WHERE ref->>'source_type' = 'assistant_proposal' AND coalesce(ref->>'action', '') = '');

ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;

-- +goose Down
-- 数据修正不回退，避免把可读取的实体重新变成非法响应。
SELECT 1;
