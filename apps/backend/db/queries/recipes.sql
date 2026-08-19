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
    image_credit, content_version
) VALUES (
    sqlc.arg(id), sqlc.arg(title), sqlc.narg(summary), sqlc.narg(image_url),
    sqlc.arg(servings), sqlc.arg(duration_minutes), sqlc.arg(difficulty),
    sqlc.arg(calories), sqlc.arg(protein_g), sqlc.arg(carbs_g), sqlc.arg(fiber_g),
    sqlc.arg(meal_slots), sqlc.arg(categories), sqlc.arg(goals),
    sqlc.arg(tags), sqlc.arg(allergens),
    sqlc.arg(ingredients), sqlc.arg(steps),
    sqlc.arg(source_name), sqlc.narg(source_author), sqlc.narg(source_url),
    sqlc.arg(license), sqlc.narg(license_url),
    sqlc.narg(image_credit), sqlc.arg(content_version)
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
    updated_at = now();
