-- +goose Up
-- 两处为导入正式菜谱做的调整。

-- 一、营养：补脂肪，纤维改为可空。
--
-- 手写的示例内容有膳食纤维没有脂肪；导入的内容有脂肪没有膳食纤维。
-- 两边都不完整，而**把没有的那项填成 0 是个假声明**——
-- 「这道菜 0g 膳食纤维」和「不知道多少」是完全不同的两句话，
-- 尤其控糖目标明确要看膳食纤维。
--
-- 所以：两者都可空，各自如实填。客户端对空值显示「—」而不是 0。
ALTER TABLE recipes ADD COLUMN fat_g double precision;
ALTER TABLE recipes ALTER COLUMN fiber_g DROP NOT NULL;

-- 二、图片：存对象键而不是 URL。
--
-- image_url 是永久明文地址，但对象在私有桶里，签名地址会过期。
-- 键是稳定的，URL 由服务端按当前的分发方式拼出来——
-- 将来 CDN 放开免鉴权就直接拼域名，还没放开就临时签名，两种都不用改数据。
ALTER TABLE recipes ADD COLUMN image_key text;

-- 原来的约束是「没有 image_credit 就不许挂 image_url」。
-- 用键之后同样要守：不知道图片权利就不许下发图，换成哪个字段都一样。
ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_image_credit_check;
ALTER TABLE recipes ADD CONSTRAINT recipes_image_credit_check
    CHECK ((image_url IS NULL AND image_key IS NULL) OR image_credit IS NOT NULL);

-- +goose Down
ALTER TABLE recipes DROP CONSTRAINT IF EXISTS recipes_image_credit_check;
ALTER TABLE recipes ADD CONSTRAINT recipes_image_credit_check
    CHECK (image_url IS NULL OR image_credit IS NOT NULL);
ALTER TABLE recipes DROP COLUMN IF EXISTS image_key;
UPDATE recipes SET fiber_g = 0 WHERE fiber_g IS NULL;
ALTER TABLE recipes ALTER COLUMN fiber_g SET NOT NULL;
ALTER TABLE recipes DROP COLUMN IF EXISTS fat_g;
