import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from to_postgres import (
    CDN_BASE,
    build_meal_slots,
    build_display_tags,
    build_steps,
    database_url,
    nutrition_per_serving,
)


class RecipeImportMappingTest(unittest.TestCase):
    def test_internal_editorial_label_is_not_a_display_tag(self):
        source = ["不在推荐位展示", "烹饪基础"]
        self.assertEqual(build_display_tags(source, ["season_summer"]), ["season_summer", "烹饪基础"])
        self.assertIn("不在推荐位展示", source)

    def test_heavy_main_meals_are_not_mapped_to_breakfast(self):
        for category in ["咖喱", "炒饭", "焖饭", "火锅"]:
            with self.subTest(category=category):
                slots = build_meal_slots([category, "早餐", "主食"])
                self.assertEqual(slots, ["lunch", "dinner"])

    def test_breakfast_mapping_keeps_non_curry_recipe(self):
        slots = build_meal_slots(["早餐", "粥", "海鲜水产"])

        self.assertEqual(slots, ["breakfast"])

    def test_excluded_breakfast_recipe_keeps_explicit_lunch_and_dinner_slots(self):
        slots = build_meal_slots(["午餐", "咖喱", "早餐", "晚餐"])

        self.assertEqual(slots, ["lunch", "dinner"])

    def test_build_steps_includes_only_uploaded_step_images(self):
        steps = build_steps(
            [
                (1, "切好食材", "steward/recipes/1/step-1.jpg"),
                (2, "开始翻炒", None),
            ],
            "备用做法",
        )

        self.assertEqual(
            steps[0]["image_url"],
            f"{CDN_BASE}/steward/recipes/1/step-1.jpg",
        )
        self.assertNotIn("image_url", steps[1])

    def test_nutrition_does_not_extract_fiber(self):
        nutrition = nutrition_per_serving([(200, 10, 8, 20)], 2)

        self.assertNotIn("fiber", nutrition)
        self.assertNotIn("fiber_g", nutrition)

    def test_database_url_removes_env_quotes(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / ".env.test"
            path.write_text(
                "STEWARD_MIGRATE_DATABASE_URL='postgres://user:pass@db/steward_test'\n",
                encoding="utf-8",
            )

            self.assertEqual(
                database_url(path),
                "postgres://user:pass@db/steward_test",
            )


if __name__ == "__main__":
    unittest.main()
