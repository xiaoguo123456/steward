-- +goose Up
-- 补齐饮食问卷的剩余字段（规格 8.2.2）：口味、预算、厨具、疾病自述。
--
-- 00016 只覆盖了目标、身体数据、过敏与忌口，剩下这几项问卷照样在收，
-- 不存就等于收完扔掉。

ALTER TABLE recipe_diet_profiles
    ADD COLUMN budget text NOT NULL DEFAULT 'standard',
    -- 口味与厨具用于排序，不是硬过滤：缺个平底锅不该让一道菜彻底消失。
    -- 真正的硬过滤只有过敏原与忌口。
    ADD COLUMN tastes    text[] NOT NULL DEFAULT '{}',
    ADD COLUMN equipment text[] NOT NULL DEFAULT '{}',
    -- 用户自述已确诊相关疾病或正在用药。**只接受用户明确勾选，不接受任何推断。**
    -- 为 true 时不生成治疗型菜单，并提示结合医生或营养师建议——
    -- 这个产品不提供诊断、治疗承诺或用药建议。
    ADD COLUMN diagnosed_condition boolean NOT NULL DEFAULT false;

ALTER TABLE recipe_diet_profiles
    ADD CONSTRAINT diet_profiles_budget_check
        CHECK (budget IN ('economy', 'standard', 'flexible'));

-- +goose Down
ALTER TABLE recipe_diet_profiles
    DROP CONSTRAINT IF EXISTS diet_profiles_budget_check;
ALTER TABLE recipe_diet_profiles
    DROP COLUMN IF EXISTS diagnosed_condition,
    DROP COLUMN IF EXISTS equipment,
    DROP COLUMN IF EXISTS tastes,
    DROP COLUMN IF EXISTS budget;
