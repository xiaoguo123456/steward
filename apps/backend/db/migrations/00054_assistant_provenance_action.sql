-- +goose Up
-- 旧 Assistant 创建记录缺失 action，生成客户端会拒绝整条实体响应。
-- 只补齐 Assistant 建议来源的创建语义，保留其他来源及数组顺序。
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

-- +goose Down
-- 数据修正不回退，避免把可读取的实体重新变成非法响应。
SELECT 1;
