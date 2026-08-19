-- +goose Up
-- 菜谱是只读的平台内容，不是用户数据。
--
-- 因此它不带 user_id、不启用行级安全，也没有写接口：所有用户看到同一份内容。
-- 用户自己的东西是「本周菜单」（Note/Task）和「实际摄入」（Record），
-- 那些仍然在各自的用户表里，照常受 RLS 约束。
CREATE TABLE recipes (
    id               text PRIMARY KEY,
    title            text        NOT NULL,
    summary          text,
    -- 没有明确图片权利时留空，客户端展示占位而不是随便找一张图。
    image_url        text,
    servings         integer     NOT NULL,
    duration_minutes integer     NOT NULL,
    difficulty       text        NOT NULL,

    -- 每份的营养估算。它是估算值，不构成任何健康承诺。
    calories  double precision NOT NULL,
    protein_g double precision NOT NULL,
    carbs_g   double precision NOT NULL,
    fiber_g   double precision NOT NULL,

    meal_slots text[] NOT NULL DEFAULT '{}',
    categories text[] NOT NULL DEFAULT '{}',
    goals      text[] NOT NULL DEFAULT '{}',
    tags       text[] NOT NULL DEFAULT '{}',
    -- 过敏原是确定性硬过滤条件，任何排序或推荐都不得覆盖它。
    allergens  text[] NOT NULL DEFAULT '{}',

    ingredients jsonb NOT NULL,
    steps       jsonb NOT NULL,

    -- 来源与授权。字段不全的菜谱不允许进库：
    -- 不知道来源和授权范围，就等于不知道自己有没有权利展示它。
    source_name     text NOT NULL,
    source_author   text,
    source_url      text,
    license         text NOT NULL,
    license_url     text,
    image_credit    text,
    content_version text NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT recipes_difficulty_check CHECK (difficulty IN ('easy', 'medium', 'hard')),
    CONSTRAINT recipes_servings_check CHECK (servings > 0),
    CONSTRAINT recipes_duration_check CHECK (duration_minutes > 0),
    -- 没有图片权利说明就不许挂图。
    CONSTRAINT recipes_image_credit_check
        CHECK (image_url IS NULL OR image_credit IS NOT NULL)
);

-- 中文按菜名与食材搜索用 pg_trgm：Postgres 默认分词器不切分中文，
-- to_tsvector 会把整句当成一个 token，搜不到子串。
CREATE INDEX recipes_title_trgm ON recipes USING gin (title gin_trgm_ops);
CREATE INDEX recipes_categories_idx ON recipes USING gin (categories);
CREATE INDEX recipes_meal_slots_idx ON recipes USING gin (meal_slots);

-- +goose Down
DROP TABLE recipes;
