-- +goose Up
-- 购物清单复用 TaskList 与 Task，不新增平行的数据表。
--
-- list_kind 决定移动端用哪套界面展示这个清单；
-- quantity_text 与 shopping_category 只在购物清单里有意义。
ALTER TABLE task_lists ADD COLUMN list_kind text NOT NULL DEFAULT 'tasks';

ALTER TABLE task_lists ADD CONSTRAINT task_lists_list_kind_check
    CHECK (list_kind IN ('tasks', 'shopping'));

-- 数量与规格是自由文本，不拆成数字加单位：
-- 用户写「一把」「半斤」时不该被迫编一个数字出来。
ALTER TABLE tasks ADD COLUMN quantity_text text;

-- 品类由服务端确定性分类，客户端不维护这套规则。
ALTER TABLE tasks ADD COLUMN shopping_category text;

ALTER TABLE tasks ADD CONSTRAINT tasks_shopping_category_check
    CHECK (shopping_category IS NULL
           OR shopping_category IN ('produce', 'protein', 'staple', 'beverage', 'other'));

-- +goose Down
ALTER TABLE tasks DROP CONSTRAINT tasks_shopping_category_check;
ALTER TABLE tasks DROP COLUMN shopping_category;
ALTER TABLE tasks DROP COLUMN quantity_text;
ALTER TABLE task_lists DROP CONSTRAINT task_lists_list_kind_check;
ALTER TABLE task_lists DROP COLUMN list_kind;
