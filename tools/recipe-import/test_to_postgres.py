import unittest

from to_postgres import CDN_BASE, build_steps, nutrition_per_serving


class RecipeImportMappingTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
