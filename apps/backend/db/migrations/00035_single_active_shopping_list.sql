-- +goose Up
-- 购物场景只有一份活动清单。历史版本曾按周创建多份清单，迁移时把条目
-- 统一移动到每个用户最早创建的活动购物清单，再软删除多余清单。
WITH ranked AS (
    SELECT id,
           first_value(id) OVER (
               PARTITION BY user_id
               ORDER BY created_at, id
           ) AS keep_id,
           row_number() OVER (
               PARTITION BY user_id
               ORDER BY created_at, id
           ) AS rank_no
    FROM task_lists
    WHERE list_kind = 'shopping'
      AND archived_at IS NULL
      AND deleted_at IS NULL
), moved AS (
    UPDATE tasks t
    SET list_id = ranked.keep_id,
        updated_at = now(),
        version = version + 1
    FROM ranked
    WHERE ranked.rank_no > 1
      AND t.list_id = ranked.id
    RETURNING t.id
)
UPDATE task_lists tl
SET deleted_at = now(),
    updated_at = now(),
    version = version + 1
FROM ranked
WHERE ranked.rank_no > 1
  AND tl.id = ranked.id;

CREATE UNIQUE INDEX task_lists_user_active_shopping_key
    ON task_lists (user_id)
    WHERE list_kind = 'shopping'
      AND archived_at IS NULL
      AND deleted_at IS NULL;

-- +goose Down
DROP INDEX task_lists_user_active_shopping_key;
