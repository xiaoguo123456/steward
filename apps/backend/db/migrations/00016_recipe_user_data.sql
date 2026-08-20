-- +goose Up
-- 用户在食谱场景里自己的数据：饮食档案、收藏、做过、本周菜单。
--
-- 菜谱本身（recipes）是共享的只读内容，不带 user_id 也不受 RLS；
-- 下面这四张表全都是「谁想吃什么」，每张都要隔离到人。

-- 饮食档案：每人一份，主键就是 user_id。
--
-- 身体数据属于高敏信息：只能由用户自己填写与修改，不接受任何推断，
-- 也不得写进日志、埋点、Prompt 快照或测试 Fixture。
CREATE TABLE recipe_diet_profiles (
    user_id          text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    goal             text NOT NULL DEFAULT 'balanced',
    age              integer,
    sex              text NOT NULL DEFAULT 'unspecified',
    height_cm        double precision,
    weight_kg        double precision,
    target_weight_kg double precision,
    activity_level   text NOT NULL DEFAULT 'moderate',

    -- 过敏原与忌口是确定性硬过滤条件，排序与推荐都不得覆盖它们。
    allergens text[] NOT NULL DEFAULT '{}',
    dislikes  text[] NOT NULL DEFAULT '{}',

    servings         integer NOT NULL DEFAULT 2,
    max_cook_minutes integer,
    -- 是否完成过问卷。没填也能浏览菜谱，只是推荐口径按默认值走。
    completed  boolean     NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT diet_profiles_goal_check
        CHECK (goal IN ('balanced', 'fat_loss', 'muscle_gain', 'steady_sugar')),
    CONSTRAINT diet_profiles_sex_check
        CHECK (sex IN ('female', 'male', 'unspecified')),
    CONSTRAINT diet_profiles_activity_check
        CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active')),
    CONSTRAINT diet_profiles_servings_check CHECK (servings BETWEEN 1 AND 20),
    CONSTRAINT diet_profiles_age_check CHECK (age IS NULL OR age BETWEEN 1 AND 120),
    CONSTRAINT diet_profiles_height_check
        CHECK (height_cm IS NULL OR height_cm BETWEEN 50 AND 260),
    CONSTRAINT diet_profiles_weight_check
        CHECK (weight_kg IS NULL OR weight_kg BETWEEN 20 AND 400),
    CONSTRAINT diet_profiles_target_weight_check
        CHECK (target_weight_kg IS NULL OR target_weight_kg BETWEEN 20 AND 400),
    CONSTRAINT diet_profiles_cook_minutes_check
        CHECK (max_cook_minutes IS NULL OR max_cook_minutes > 0)
);

-- 收藏。同一个人对同一道菜只有一条。
CREATE TABLE recipe_favorites (
    id         text PRIMARY KEY,
    user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    recipe_id  text NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT recipe_favorites_unique UNIQUE (user_id, recipe_id)
);
CREATE INDEX recipe_favorites_user_idx ON recipe_favorites (user_id, created_at DESC);

-- 「做过」是一条日志而不是一个开关：同一道菜可以做很多次。
-- 它不等于记录实际摄入——后者是 Record，走记录项接口。
CREATE TABLE recipe_cook_logs (
    id         text PRIMARY KEY,
    user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    recipe_id  text NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    cooked_at  timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recipe_cook_logs_user_idx ON recipe_cook_logs (user_id, cooked_at DESC);

-- 本周菜单。每人每周一份，存的只有「已确认」的那版。
--
-- AI 生成的预览不落库：规格 8.2.2 要求预览只是预览，
-- 用户点过「采用本周菜单」才算数。草稿留在客户端。
CREATE TABLE meal_plans (
    id         text PRIMARY KEY,
    user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- 该周第一天。周一还是周日开始取决于用户偏好，由服务端算好再写进来。
    week_start date        NOT NULL,
    version    integer     NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT meal_plans_week_unique UNIQUE (user_id, week_start)
);

CREATE TABLE meal_plan_entries (
    id           text PRIMARY KEY,
    user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    meal_plan_id text NOT NULL REFERENCES meal_plans (id) ON DELETE CASCADE,
    -- 用真实日期而不是「周几」：跨周与跨时区时「周三」是哪天并不唯一。
    entry_date date NOT NULL,
    meal_slot  text NOT NULL,
    recipe_id  text NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT meal_plan_entries_slot_check
        CHECK (meal_slot IN ('breakfast', 'lunch', 'dinner')),
    -- 一天一餐只有一道菜。
    CONSTRAINT meal_plan_entries_unique UNIQUE (meal_plan_id, entry_date, meal_slot)
);
CREATE INDEX meal_plan_entries_plan_idx ON meal_plan_entries (meal_plan_id, entry_date);

-- 行级安全。四张表都带 user_id，一张都不能漏——
-- internal/platform/database/rls_test.go 的 TestAllUserTablesForceRLS 会扫出来。
-- +goose StatementBegin
DO $$
DECLARE
    t text;
    scoped_tables text[] := ARRAY[
        'recipe_favorites', 'recipe_cook_logs', 'meal_plans', 'meal_plan_entries'
    ];
BEGIN
    FOREACH t IN ARRAY scoped_tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I USING (user_id = current_setting(''app.user_id'', true)) '
            'WITH CHECK (user_id = current_setting(''app.user_id'', true))',
            t || '_user_isolation', t);
    END LOOP;

    -- 饮食档案用主键做隔离，它没有单独的 user_id 列。
    EXECUTE 'ALTER TABLE recipe_diet_profiles ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE recipe_diet_profiles FORCE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY recipe_diet_profiles_user_isolation ON recipe_diet_profiles '
            'USING (user_id = current_setting(''app.user_id'', true)) '
            'WITH CHECK (user_id = current_setting(''app.user_id'', true))';
END
$$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE IF EXISTS meal_plan_entries;
DROP TABLE IF EXISTS meal_plans;
DROP TABLE IF EXISTS recipe_cook_logs;
DROP TABLE IF EXISTS recipe_favorites;
DROP TABLE IF EXISTS recipe_diet_profiles;
