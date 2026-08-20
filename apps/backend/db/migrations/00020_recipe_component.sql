-- +goose Up
-- 周菜单改成按食物类别组合（早餐主食+蛋白，午晚主食+荤+素），
-- 因此每道菜要知道自己在一餐里扮演什么角色。

-- component：这道菜是什么。
--
--   staple     纯主食，要配菜（白粥、馒头）
--   one_dish   单品成餐，本身就把主食和蛋白都包了（牛肉面、蛋包饭）
--   protein    荤菜。豆制品也算——在中餐里它承担的正是这个位置
--   vegetable  素菜
--
-- 可空：分类规则在导入工具里（tools/recipe-import/classify.py），
-- 迁移没法调用它。空表示「还没分类」，周菜单生成会跳过——
-- 宁可少推荐，也不要把一道不知道是什么的菜塞进「荤菜」那一格。
ALTER TABLE recipes ADD COLUMN component text;
ALTER TABLE recipes ADD CONSTRAINT recipes_component_check
    CHECK (component IS NULL OR component IN ('staple', 'one_dish', 'protein', 'vegetable'));

-- plan_excluded_reason：为什么不进周菜单。
--
-- **只影响周菜单生成，不影响浏览与搜索。** 标记而不是删除：
-- 判定标准是我们定的，删了就没法回头复核误伤。实测这三类各自的量：
--
--   not_a_dish             20 条。刀工与预处理教程（「切香菇花刀」1 kcal）
--   dessert_or_drink      644 条。是正经菜谱，但不该拿来配三餐
--   implausible_nutrition  48 条。每份上万卡或个位数，食材份量抄错了
--
-- 最后一类尤其要紧：周菜单要按绝对热量目标选菜，
-- 而绝对目标建在坏数据上没有意义——排名打分对坏值免疫，绝对目标不免疫。
ALTER TABLE recipes ADD COLUMN plan_excluded_reason text;
ALTER TABLE recipes ADD CONSTRAINT recipes_plan_excluded_check
    CHECK (plan_excluded_reason IS NULL
           OR plan_excluded_reason IN ('not_a_dish', 'dessert_or_drink', 'implausible_nutrition'));

-- 候选查询每次都按这两列加时段过滤，这条索引直接覆盖它。
CREATE INDEX recipes_plan_candidates_idx ON recipes (component)
    WHERE plan_excluded_reason IS NULL AND component IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS recipes_plan_candidates_idx;
ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_plan_excluded_check;
ALTER TABLE recipes DROP COLUMN IF EXISTS plan_excluded_reason;
ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_component_check;
ALTER TABLE recipes DROP COLUMN IF EXISTS component;
