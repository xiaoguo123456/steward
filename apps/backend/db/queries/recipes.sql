-- 菜谱只读查询。它是平台内容，没有写接口。

-- name: ListRecipes :many
SELECT * FROM recipes
WHERE (sqlc.narg(query)::text IS NULL
       OR title ILIKE '%' || sqlc.narg(query)::text || '%'
       OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(ingredients) AS ing
            WHERE ing ->> 'name' ILIKE '%' || sqlc.narg(query)::text || '%'))
  AND (sqlc.narg(category)::text IS NULL OR sqlc.narg(category)::text = ANY (categories))
  AND (sqlc.narg(meal_slot)::text IS NULL OR sqlc.narg(meal_slot)::text = ANY (meal_slots))
  AND (sqlc.narg(max_minutes)::int IS NULL OR duration_minutes <= sqlc.narg(max_minutes)::int)
  -- 过敏原是硬过滤，不是排序权重：命中一个就整条排除。
  AND NOT (allergens && sqlc.arg(exclude_allergens)::text[])
ORDER BY duration_minutes, id
LIMIT sqlc.arg(row_limit);

-- name: GetRecipe :one
SELECT * FROM recipes WHERE id = sqlc.arg(id);

-- name: CountRecipes :one
SELECT count(*)::int FROM recipes;

-- name: UpsertRecipe :exec
-- 只给 seed 用：菜谱由平台提供，没有面向用户的写接口。
INSERT INTO recipes (
    id, title, summary, image_url, servings, duration_minutes, difficulty,
    calories, protein_g, carbs_g, fiber_g,
    meal_slots, categories, goals, tags, allergens,
    ingredients, steps,
    source_name, source_author, source_url, license, license_url,
    image_credit, content_version, component
) VALUES (
    sqlc.arg(id), sqlc.arg(title), sqlc.narg(summary), sqlc.narg(image_url),
    sqlc.arg(servings), sqlc.arg(duration_minutes), sqlc.arg(difficulty),
    sqlc.arg(calories), sqlc.arg(protein_g), sqlc.arg(carbs_g), sqlc.arg(fiber_g),
    sqlc.arg(meal_slots), sqlc.arg(categories), sqlc.arg(goals),
    sqlc.arg(tags), sqlc.arg(allergens),
    sqlc.arg(ingredients), sqlc.arg(steps),
    sqlc.arg(source_name), sqlc.narg(source_author), sqlc.narg(source_url),
    sqlc.arg(license), sqlc.narg(license_url),
    sqlc.narg(image_credit), sqlc.arg(content_version), sqlc.arg(component)
)
ON CONFLICT (id) DO UPDATE SET
    title = excluded.title, summary = excluded.summary,
    image_url = excluded.image_url, servings = excluded.servings,
    duration_minutes = excluded.duration_minutes, difficulty = excluded.difficulty,
    calories = excluded.calories, protein_g = excluded.protein_g,
    carbs_g = excluded.carbs_g, fiber_g = excluded.fiber_g,
    meal_slots = excluded.meal_slots, categories = excluded.categories,
    goals = excluded.goals, tags = excluded.tags, allergens = excluded.allergens,
    ingredients = excluded.ingredients, steps = excluded.steps,
    source_name = excluded.source_name, source_author = excluded.source_author,
    source_url = excluded.source_url, license = excluded.license,
    license_url = excluded.license_url, image_credit = excluded.image_credit,
    content_version = excluded.content_version,
    component = excluded.component,
    updated_at = now();

-- ---- 用户自己的食谱数据 ----
--
-- 下面这些表都带 user_id 并受 RLS 约束，查询里不需要也不应该再写 user_id 条件：
-- 归属由策略保证，手写条件反而会让人以为没有策略也安全。

-- name: GetDietProfile :one
SELECT * FROM recipe_diet_profiles WHERE user_id = sqlc.arg(user_id);

-- name: UpsertDietProfile :one
-- 第一次修改时顺带建行：客户端不需要先「创建档案」再改。
--
-- INSERT 分支必须带上全部字段。只写 user_id 的话，第一次填问卷不会冲突，
-- DO UPDATE 分支根本不执行，用户填的东西会被默认值悄悄吃掉。
-- clear_* 在插入时没有意义：没有旧值可清。
INSERT INTO recipe_diet_profiles (
    user_id, goal, sex, activity_level,
    age, height_cm, weight_kg, target_weight_kg, max_cook_minutes,
    allergens, dislikes, servings, completed,
    budget, tastes, equipment, diagnosed_condition
) VALUES (
    sqlc.arg(user_id),
    coalesce(sqlc.narg(goal), 'balanced'),
    coalesce(sqlc.narg(sex), 'unspecified'),
    coalesce(sqlc.narg(activity_level), 'moderate'),
    sqlc.narg(age), sqlc.narg(height_cm), sqlc.narg(weight_kg),
    sqlc.narg(target_weight_kg), sqlc.narg(max_cook_minutes),
    coalesce(sqlc.narg(allergens)::text[], '{}'),
    coalesce(sqlc.narg(dislikes)::text[], '{}'),
    coalesce(sqlc.narg(servings), 2),
    coalesce(sqlc.narg(completed), false),
    coalesce(sqlc.narg(budget), 'standard'),
    coalesce(sqlc.narg(tastes)::text[], '{}'),
    coalesce(sqlc.narg(equipment)::text[], '{}'),
    coalesce(sqlc.narg(diagnosed_condition), false)
)
ON CONFLICT (user_id) DO UPDATE SET
    goal           = coalesce(sqlc.narg(goal), recipe_diet_profiles.goal),
    sex            = coalesce(sqlc.narg(sex), recipe_diet_profiles.sex),
    activity_level = coalesce(sqlc.narg(activity_level), recipe_diet_profiles.activity_level),
    age = CASE WHEN sqlc.arg(clear_age)::bool THEN NULL
               ELSE coalesce(sqlc.narg(age), recipe_diet_profiles.age) END,
    height_cm = CASE WHEN sqlc.arg(clear_height)::bool THEN NULL
                     ELSE coalesce(sqlc.narg(height_cm), recipe_diet_profiles.height_cm) END,
    weight_kg = CASE WHEN sqlc.arg(clear_weight)::bool THEN NULL
                     ELSE coalesce(sqlc.narg(weight_kg), recipe_diet_profiles.weight_kg) END,
    target_weight_kg = CASE WHEN sqlc.arg(clear_target_weight)::bool THEN NULL
                            ELSE coalesce(sqlc.narg(target_weight_kg),
                                          recipe_diet_profiles.target_weight_kg) END,
    max_cook_minutes = CASE WHEN sqlc.arg(clear_cook_minutes)::bool THEN NULL
                            ELSE coalesce(sqlc.narg(max_cook_minutes),
                                          recipe_diet_profiles.max_cook_minutes) END,
    allergens  = coalesce(sqlc.narg(allergens)::text[], recipe_diet_profiles.allergens),
    dislikes   = coalesce(sqlc.narg(dislikes)::text[], recipe_diet_profiles.dislikes),
    servings   = coalesce(sqlc.narg(servings), recipe_diet_profiles.servings),
    completed  = coalesce(sqlc.narg(completed), recipe_diet_profiles.completed),
    budget     = coalesce(sqlc.narg(budget), recipe_diet_profiles.budget),
    tastes     = coalesce(sqlc.narg(tastes)::text[], recipe_diet_profiles.tastes),
    equipment  = coalesce(sqlc.narg(equipment)::text[], recipe_diet_profiles.equipment),
    diagnosed_condition = coalesce(sqlc.narg(diagnosed_condition),
                                   recipe_diet_profiles.diagnosed_condition),
    updated_at = now()
RETURNING *;

-- name: ListFavoriteRecipes :many
SELECT r.* FROM recipe_favorites f
JOIN recipes r ON r.id = f.recipe_id
ORDER BY f.created_at DESC
LIMIT sqlc.arg(row_limit);

-- name: ListFavoriteRecipeIDs :many
SELECT recipe_id FROM recipe_favorites ORDER BY created_at DESC;

-- name: FavoriteRecipe :exec
-- 幂等：重复收藏同一道菜不产生第二条记录。
INSERT INTO recipe_favorites (id, user_id, recipe_id)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(recipe_id))
ON CONFLICT (user_id, recipe_id) DO NOTHING;

-- name: UnfavoriteRecipe :exec
DELETE FROM recipe_favorites WHERE recipe_id = sqlc.arg(recipe_id);

-- name: CreateCookLog :exec
INSERT INTO recipe_cook_logs (id, user_id, recipe_id, cooked_at)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(recipe_id), sqlc.arg(cooked_at));

-- name: ListCookedRecipeIDs :many
SELECT DISTINCT recipe_id FROM recipe_cook_logs;

-- name: GetMealPlanByWeek :one
SELECT * FROM meal_plans WHERE week_start = sqlc.arg(week_start)::date;

-- name: UpsertMealPlan :one
-- 采用菜单是整周覆盖，因此这里同时负责建与更新，并推进版本号。
INSERT INTO meal_plans (id, user_id, week_start)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(week_start)::date)
ON CONFLICT (user_id, week_start) DO UPDATE SET
    version    = meal_plans.version + 1,
    updated_at = now()
RETURNING *;

-- name: DeleteMealPlanEntries :exec
DELETE FROM meal_plan_entries WHERE meal_plan_id = sqlc.arg(meal_plan_id);

-- name: CreateMealPlanEntry :exec
INSERT INTO meal_plan_entries (id, user_id, meal_plan_id, entry_date, meal_slot, recipe_id, component)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(meal_plan_id),
        sqlc.arg(entry_date)::date, sqlc.arg(meal_slot), sqlc.arg(recipe_id),
        sqlc.narg(component));

-- name: ListMealPlanEntries :many
-- 连带菜谱一起返回：菜单页要显示菜名与营养，逐条再查一遍没有意义。
SELECT
    e.entry_date,
    e.meal_slot,
    e.component,
    sqlc.embed(r)
FROM meal_plan_entries e
JOIN recipes r ON r.id = e.recipe_id
WHERE e.meal_plan_id = sqlc.arg(meal_plan_id)
-- 按用餐顺序而不是字母序：字母序会排成早餐、晚餐、午餐。
-- 一格之内主食排在前面，和端上桌的顺序一致。
ORDER BY e.entry_date,
    CASE e.meal_slot WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 ELSE 2 END,
    CASE e.component
        WHEN 'staple' THEN 0 WHEN 'one_dish' THEN 0
        WHEN 'protein' THEN 1 WHEN 'vegetable' THEN 2 ELSE 3 END,
    e.recipe_id;

-- name: ListRecipeCandidates :many
-- 生成周菜单用的候选集。
--
-- 只取打分需要的列，**不取 ingredients 与 steps**：候选集是几千行，
-- 带上 JSON 正文就是几十兆，而选菜阶段根本用不到它们。
-- 选定之后再按 id 取完整菜谱。
--
-- 过敏原与忌口在这里就滤掉，不留给上层——漏一层就是一次事故。
-- 忌口要连食材一起看：用户忌香菜，菜名里没有但配料里有，一样得排除。
SELECT id, title, duration_minutes, difficulty, calories, protein_g, carbs_g,
       fiber_g, fat_g, meal_slots, categories, tags, component
FROM recipes
WHERE sqlc.arg(meal_slot)::text = ANY (meal_slots)
  -- 甜品饮品、刀工教程与营养估算离谱的条目不进菜单。
  -- 未分类（component 为空）同样跳过：宁可少推荐，
  -- 也不要把一道不知道是什么的菜塞进「荤菜」那一格。
  AND plan_excluded_reason IS NULL
  AND component IS NOT NULL
  AND component = sqlc.arg(component)::text
  AND NOT (allergens && sqlc.arg(exclude_allergens)::text[])
  AND NOT EXISTS (
        SELECT 1 FROM unnest(sqlc.arg(dislikes)::text[]) AS d
        WHERE d <> ''
          AND (title ILIKE '%' || d || '%'
               OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements(ingredients) AS ing
                    WHERE ing ->> 'name' ILIKE '%' || d || '%')))
  AND (sqlc.narg(max_minutes)::int IS NULL OR duration_minutes <= sqlc.narg(max_minutes)::int)
ORDER BY id;

-- name: ListRecipesByIDs :many
-- 选定之后再取完整菜谱（含食材与步骤）。候选阶段刻意不取这些列。
SELECT * FROM recipes WHERE id = ANY(sqlc.arg(ids)::text[]);
