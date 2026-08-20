-- +goose Up
-- 一餐从「一道菜」改成「一组菜」。
--
-- 原来一格只能放一道，而单道菜的热量中位数是 318 kcal——按身高体重算出来的
-- 每餐目标（一天 1800 就是午餐 720）根本够不到。只提高目标不改结构，
-- 得到的会是一份「目标 1800、实际 950」的菜单，算得再准也没用。
--
-- 现在早餐是主食+蛋白，午晚是主食+荤+素，热量自然加得上去。

-- 一格一道的唯一约束要去掉。
ALTER TABLE meal_plan_entries DROP CONSTRAINT IF EXISTS meal_plan_entries_unique;

-- 换成「同一格里同一道菜不能出现两次」。
-- 允许一格多道，但不允许一格里排两遍同一道——那是提交出错，不是搭配。
ALTER TABLE meal_plan_entries ADD CONSTRAINT meal_plan_entries_unique
    UNIQUE (meal_plan_id, entry_date, meal_slot, recipe_id);

-- component 记录这道菜在这一格里扮演什么角色。
--
-- **存下来而不是每次去 recipes 里查**：菜谱的分类将来可能因为规则调整
-- 而变化，但用户确认过的那份菜单里「这道是主食」是当时的事实。
-- 展示顺序也靠它（主食在前），跟着菜谱走会让历史菜单的顺序莫名其妙地变。
ALTER TABLE meal_plan_entries ADD COLUMN component text;
ALTER TABLE meal_plan_entries ADD CONSTRAINT meal_plan_entries_component_check
    CHECK (component IS NULL OR component IN ('staple', 'one_dish', 'protein', 'vegetable'));

-- +goose Down
ALTER TABLE meal_plan_entries DROP CONSTRAINT IF EXISTS meal_plan_entries_component_check;
ALTER TABLE meal_plan_entries DROP COLUMN IF EXISTS component;
ALTER TABLE meal_plan_entries DROP CONSTRAINT IF EXISTS meal_plan_entries_unique;
-- 回退前要先去掉一格多道的数据，否则唯一约束建不起来。
DELETE FROM meal_plan_entries e USING meal_plan_entries keep
 WHERE e.meal_plan_id = keep.meal_plan_id
   AND e.entry_date = keep.entry_date
   AND e.meal_slot = keep.meal_slot
   AND e.id > keep.id;
ALTER TABLE meal_plan_entries ADD CONSTRAINT meal_plan_entries_unique
    UNIQUE (meal_plan_id, entry_date, meal_slot);
