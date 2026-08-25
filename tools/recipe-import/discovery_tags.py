#!/usr/bin/env python3
"""菜谱发现页标签规则。

模型只参与离线生成时令食材库；菜谱分类本身始终由这里的确定性规则完成。
同一份归档、同一版标签库和同一版规则必须得到完全相同的结果。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SEASONAL_LIBRARY_PATH = ROOT / "tags" / "seasonal-ingredients.v2.json"
SEASON_ORDER = ("spring", "summer", "autumn", "winter")
SEASON_MONTHS = {
    "spring": (3, 4, 5),
    "summer": (6, 7, 8),
    "autumn": (9, 10, 11),
    "winter": (12, 1, 2),
}

ADDED_SUGAR = re.compile(
    r"(白砂糖|白糖|细砂糖|绵白糖|冰糖|红糖|黑糖|黄糖|蔗糖|糖浆|"
    r"蜂蜜|炼乳|果酱|甜面酱|巧克力|糖粉|麦芽糖)"
)


def load_seasonal_library(path: Path = SEASONAL_LIBRARY_PATH) -> dict[str, dict]:
    """读取 API 生成并经校验的时令食材库。"""
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8"))
    return raw.get("ingredients", {})


def seasonal_seasons(
    title: str,
    ingredient_names: list[str],
    library: dict[str, dict],
) -> list[str]:
    """从菜名和主要食材推导菜谱适合展示的季节。

    前三项通常是来源数据里的主料；排在后面的食材只有出现在菜名里才算主料，
    避免一道菜因为少量配料恰好当季就被标成时令菜。
    """
    seasons: set[str] = set()
    for index, name in enumerate(ingredient_names):
        item = library.get(name)
        if not item:
            continue
        normalized = str(item.get("normalized_name") or name)
        if index >= 3 and name not in title and normalized not in title:
            continue
        seasons.update(str(season) for season in item.get("seasons", []))
    return [season for season in SEASON_ORDER if season in seasons]


def is_fat_loss(
    source_tags: list[str], calories: float, plan_excluded_reason: str | None
) -> bool:
    """来源明确标为减肥餐，并排除明显异常或不适合作为正餐的内容。"""
    return (
        "减肥餐" in source_tags
        and plan_excluded_reason is None
        and 60 <= calories <= 700
    )


def is_muscle_gain(
    calories: float,
    protein_g: float,
    plan_excluded_reason: str | None,
) -> bool:
    """每份蛋白质足量且蛋白供能占比不低于 25%。"""
    if plan_excluded_reason is not None or not 150 <= calories <= 900:
        return False
    return protein_g >= 25 and protein_g * 4 / max(calories, 1) >= 0.25


def is_steady_sugar(
    source_tags: list[str],
    ingredient_names: list[str],
    calories: float,
    carbs_g: float,
    plan_excluded_reason: str | None,
) -> bool:
    """一般健康控糖的保守内容筛选，不用于疾病饮食建议。

    当前来源没有膳食纤维和添加糖字段，因此只收录来源标为清淡、每份碳水
    不高且食材表未出现明确添加糖的菜；宁可少标，不把“低碳水”等同于治疗。
    """
    if "清淡" not in source_tags or plan_excluded_reason is not None:
        return False
    if not 60 <= calories <= 700 or carbs_g > 30:
        return False
    return not any(ADDED_SUGAR.search(name) and "无糖" not in name for name in ingredient_names)


def build_discovery_tags(
    *,
    title: str,
    source_tags: list[str],
    ingredient_names: list[str],
    calories: float,
    protein_g: float,
    carbs_g: float,
    plan_excluded_reason: str | None,
    seasonal_library: dict[str, dict],
) -> tuple[list[str], list[str], list[str]]:
    """返回 categories、goals 和内部季节标签。"""
    categories = {"recommended"}
    goals: set[str] = set()
    derived_tags: set[str] = set()

    if "快手菜" in source_tags:
        categories.add("quick")

    seasons = seasonal_seasons(title, ingredient_names, seasonal_library)
    if seasons:
        categories.add("seasonal")
        derived_tags.update(f"season_{season}" for season in seasons)
        # 兼容尚未滚动到四季过滤逻辑的测试服务；三个月指向同一季节集合，
        # 不再维护逐月数据，服务完成升级后可删除这些隐藏标签。
        derived_tags.update(
            f"seasonal_month_{month:02d}"
            for season in seasons
            for month in SEASON_MONTHS[season]
        )

    if is_fat_loss(source_tags, calories, plan_excluded_reason):
        categories.add("fat_loss")
        goals.add("fat_loss")

    if is_muscle_gain(calories, protein_g, plan_excluded_reason):
        categories.add("muscle_gain")
        goals.add("muscle_gain")

    if is_steady_sugar(
        source_tags,
        ingredient_names,
        calories,
        carbs_g,
        plan_excluded_reason,
    ):
        categories.add("steady_sugar")
        goals.add("steady_sugar")

    return sorted(categories), sorted(goals), sorted(derived_tags)
