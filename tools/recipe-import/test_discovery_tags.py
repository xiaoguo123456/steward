import unittest

from discovery_tags import (
    build_discovery_tags,
    is_fat_loss,
    is_muscle_gain,
    is_steady_sugar,
    load_seasonal_library,
    seasonal_seasons,
)


class DiscoveryTagsTest(unittest.TestCase):
    def test_generated_seasonal_library_is_present_and_valid(self):
        library = load_seasonal_library()

        self.assertGreater(len(library), 200)
        for name, item in library.items():
            self.assertTrue(name)
            self.assertTrue(item["normalized_name"])
            self.assertTrue(item["seasons"])
            self.assertTrue(
                set(item["seasons"]).issubset({"spring", "summer", "autumn", "winter"})
            )

    def test_seasonal_seasons_only_use_prominent_ingredients(self):
        library = {
            "春笋": {"normalized_name": "春笋", "seasons": ["spring"]},
            "草莓": {"normalized_name": "草莓", "seasons": ["winter", "spring"]},
        }
        self.assertEqual(seasonal_seasons("春笋炒肉", ["猪肉", "春笋"], library), ["spring"])
        self.assertEqual(
            seasonal_seasons("奶油蛋糕", ["面粉", "鸡蛋", "牛奶", "草莓"], library),
            [],
        )

    def test_fat_loss_requires_source_tag_and_reasonable_energy(self):
        self.assertTrue(is_fat_loss(["减肥餐"], 320, None))
        self.assertFalse(is_fat_loss(["清淡"], 320, None))
        self.assertFalse(is_fat_loss(["减肥餐"], 900, None))

    def test_muscle_gain_requires_amount_and_ratio(self):
        self.assertTrue(is_muscle_gain(400, 30, None))
        self.assertFalse(is_muscle_gain(700, 30, None))
        self.assertFalse(is_muscle_gain(400, 20, None))

    def test_steady_sugar_is_conservative(self):
        self.assertTrue(is_steady_sugar(["清淡"], ["西兰花", "鸡胸肉"], 280, 12, None))
        self.assertFalse(is_steady_sugar(["清淡"], ["西兰花", "蜂蜜"], 280, 12, None))
        self.assertFalse(is_steady_sugar(["家常菜"], ["西兰花", "鸡胸肉"], 280, 12, None))

    def test_builds_all_discovery_categories(self):
        categories, goals, tags = build_discovery_tags(
            title="春笋鸡胸肉",
            source_tags=["快手菜", "减肥餐", "清淡"],
            ingredient_names=["春笋", "鸡胸肉"],
            calories=320,
            protein_g=35,
            carbs_g=12,
            plan_excluded_reason=None,
            seasonal_library={
                "春笋": {"normalized_name": "春笋", "seasons": ["spring"]}
            },
        )
        self.assertEqual(
            categories,
            ["fat_loss", "muscle_gain", "quick", "recommended", "seasonal", "steady_sugar"],
        )
        self.assertEqual(goals, ["fat_loss", "muscle_gain", "steady_sugar"])
        self.assertEqual(
            tags,
            ["season_spring", "seasonal_month_03", "seasonal_month_04", "seasonal_month_05"],
        )


if __name__ == "__main__":
    unittest.main()
