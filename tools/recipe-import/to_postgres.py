#!/usr/bin/env python3
"""把 SQLite 归档映射进 steward 的 recipes 表。

映射规则集中在这里，改了重跑即可——SQLite 保存的是源数据的原样，
不受映射规则变动影响。

用法：
    python3 tools/recipe-import/to_postgres.py --dry-run   # 只看会写成什么
    python3 tools/recipe-import/to_postgres.py             # 写入
    python3 tools/recipe-import/to_postgres.py --limit 50  # 先导一小批
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from allergens import detect as detect_allergens
from classify import classify as classify_component, excluded_reason  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
DB_PATH = REPO / "tools" / "recipe-import" / "recipes.sqlite3"

# 内容版本。映射规则改了就要改它，便于分辨库里是哪一版规则导入的。
CONTENT_VERSION = "lanfan-2026-08.1"

# 图片分发域名。steward/recipes/ 这个前缀在 CDN 上配了免鉴权，
# 因此可以直接拼出永久地址；其余前缀仍然要签名。
#
# 同时存 image_key 与 image_url：键是稳定标识，URL 是当前的分发方式。
# 哪天换域名或改回签名，重跑映射即可，不用去猜库里那串地址是怎么来的。
CDN_BASE = "https://img.qhzhiyin.com"
SOURCE_NAME = "懒饭"
# 内容已获授权（2026-08 由项目负责人确认）。
# 这个字段是 NOT NULL 的用意就是逼出「有没有权利展示」这个问题，
# 所以填的必须是真实结论而不是好看的占位值。
LICENSE = "已授权"

DIFFICULTY = {
    "零厨艺✌️": "easy",
    "容易做🤞": "easy",
    "有点挑战🖖": "medium",
    "压力略大💪": "hard",
}

# 餐段：懒饭把早/午/晚餐当作标签，没打标不等于「不适合」。
MEAL_TAGS = {"早餐": "breakfast", "午餐": "lunch", "晚餐": "dinner"}
# 没打三餐标签但明显是正餐菜的，补成午餐+晚餐。
# 甜品饮品那些不补——奥利奥奶昔不是晚饭。
MAIN_DISH_TAGS = {"家常菜", "下饭菜", "快手菜", "素菜", "便当", "炒菜", "汤羹", "主食"}

# steward 的分类枚举有限，只映射能确定的那几个，其余归精选。
CATEGORY_MAP = {"快手菜": "quick", "时令": "seasonal"}

MEAL_SLOT_ORDER = ["breakfast", "lunch", "dinner"]


def parse_minutes(text: str | None) -> int:
    """「约10-20分钟」→ 20。

    取上限而不是中位：让用户以为 10 分钟能做完、实际要 20 分钟，
    比反过来更容易把一顿饭搞砸。
    """
    if not text:
        return 30
    hours = re.findall(r"(\d+)\s*小时", text)
    minutes = re.findall(r"(\d+)", re.sub(r"\d+\s*小时", "", text))
    total = max((int(m) for m in minutes), default=0)
    if hours:
        total += max(int(h) for h in hours) * 60
    return total or 30


def build_meal_slots(categories: list[str]) -> list[str]:
    slots = {MEAL_TAGS[c] for c in categories if c in MEAL_TAGS}
    if not slots and any(c in MAIN_DISH_TAGS for c in categories):
        slots = {"lunch", "dinner"}
    return [s for s in MEAL_SLOT_ORDER if s in slots]


def build_categories(categories: list[str]) -> list[str]:
    mapped = {CATEGORY_MAP[c] for c in categories if c in CATEGORY_MAP}
    mapped.add("recommended")
    return sorted(mapped)


def nutrition_per_serving(rows: list[tuple], servings: int) -> dict:
    """把食材营养求和再除以份数。

    源数据每条食材都带营养，所以这是算出来的而不是估出来的。
    膳食纤维源数据没有，因此不读取也不返回该项。
    """
    servings = max(1, servings or 1)
    total = {"calories": 0.0, "protein": 0.0, "fat": 0.0, "carbohydrate": 0.0}
    for calories, protein, fat, carbohydrate in rows:
        total["calories"] += calories or 0.0
        total["protein"] += protein or 0.0
        total["fat"] += fat or 0.0
        total["carbohydrate"] += carbohydrate or 0.0
    return {k: round(v / servings, 1) for k, v in total.items()}


# steward 的食材分组枚举。懒饭没有这个概念，按名称粗分。
SEASONING = ("盐", "糖", "酱", "醋", "油", "料酒", "胡椒", "淀粉", "味精", "鸡精",
             "孜然", "辣椒粉", "花椒", "八角", "香叶", "桂皮", "蚝油", "生抽", "老抽")
STAPLE = ("米", "面", "粉", "馒头", "饼", "包子", "馄饨", "饺子", "年糕", "粥")
PROTEIN = ("肉", "鸡", "鸭", "鱼", "虾", "蟹", "蛋", "豆腐", "牛", "猪", "羊", "虾仁", "培根", "火腿")


def ingredient_group(name: str) -> str:
    if any(k in name for k in SEASONING):
        return "seasoning"
    if any(k in name for k in PROTEIN):
        return "protein"
    if any(k in name for k in STAPLE):
        return "staple"
    return "produce"


def build_ingredients(rows: list[tuple]) -> list[dict]:
    """逐项保留食材信息，并标出这项食材实际命中的过敏原。"""
    return [
        {
            "name": name,
            "amount": amount or "适量",
            "group": ingredient_group(name),
            "allergens": detect_allergens([name]),
        }
        for name, amount, *_ in rows
    ]


def build_steps(rows: list[tuple[int, str | None, str | None]], fallback: str) -> list[dict]:
    steps = []
    for idx, text, image_key in rows:
        description = (text or "").strip()
        if not description:
            continue
        step = {"title": f"第 {idx} 步", "description": description}
        if image_key:
            step["image_url"] = f"{CDN_BASE}/{image_key}"
        steps.append(step)
    return steps or [{"title": "做法", "description": fallback.strip()}]


def build_row(conn: sqlite3.Connection, rid: int) -> dict | None:
    r = conn.execute(
        """SELECT name, name_adj, url, difficulty_text, time_consuming,
                  serving_value, tips, cover_image
           FROM recipes WHERE id = ?""",
        (rid,),
    ).fetchone()
    if not r:
        return None
    # url 只留在 SQLite 归档里，不进 PG——展示层用不到它。
    name, name_adj, _url, difficulty_text, time_consuming, servings, tips, cover = r

    ings = conn.execute(
        "SELECT name, amount, calories, protein, fat, carbohydrate FROM ingredients "
        "WHERE recipe_id = ? ORDER BY seq",
        (rid,),
    ).fetchall()
    if not ings:
        # 没有食材的菜谱进库没有意义：既算不出营养也生成不了购物清单。
        return None

    steps = conn.execute(
        """SELECT s.idx, s.text, i.oss_key
           FROM steps AS s
           LEFT JOIN images AS i
             ON i.recipe_id = s.recipe_id
            AND i.kind = 'step'
            AND i.filename = s.image
           WHERE s.recipe_id = ?
           ORDER BY s.idx""",
        (rid,),
    ).fetchall()
    cats = [c[0] for c in conn.execute("SELECT name FROM categories WHERE recipe_id = ?", (rid,))]

    servings = servings or 2
    nutri = nutrition_per_serving([(c, p, f, cb) for _, _, c, p, f, cb in ings], servings)

    cover = conn.execute(
        "SELECT oss_key FROM images WHERE recipe_id = ? AND kind = 'cover'", (rid,)
    ).fetchone()
    cover_key = cover[0] if cover and cover[0] else None

    return {
        "id": f"rcp_lf{rid}",
        "title": name,
        "summary": (name_adj or "").strip() or None,
        "image_key": cover_key,
        "image_url": f"{CDN_BASE}/{cover_key}" if cover_key else None,
        "servings": servings,
        "duration_minutes": parse_minutes(time_consuming),
        "difficulty": DIFFICULTY.get(difficulty_text, "medium"),
        "calories": nutri["calories"],
        "protein_g": nutri["protein"],
        "carbs_g": nutri["carbohydrate"],
        "fat_g": nutri["fat"],
        "meal_slots": build_meal_slots(cats),
        "categories": build_categories(cats),
        "goals": [],  # 从营养反推目标是猜测，不做。
        "tags": sorted(set(cats)),
        "allergens": detect_allergens([i[0] for i in ings]),
        "ingredients": json.dumps(build_ingredients(ings), ensure_ascii=False),
        "steps": json.dumps(build_steps(steps, tips or name), ensure_ascii=False),
        "source_name": SOURCE_NAME,
        "source_author": None,
        "license": LICENSE,
        "license_url": None,
        # 图片和菜谱同源。没有图片权利就不下发图，约束会拦住。
        "image_credit": SOURCE_NAME,
        "content_version": CONTENT_VERSION,
        # 这道菜在一餐里扮演什么角色，以及要不要排除出周菜单。
        # 规则见 classify.py；那里以来源自带的分类标签为主，营养只做兜底。
        "component": classify_component(
            name, sorted(set(cats)), [i[0] for i in ings],
            nutri["calories"], nutri["protein"], nutri["carbohydrate"],
        ),
        "plan_excluded_reason": excluded_reason(
            name, sorted(set(cats)), nutri["calories"]
        ),
    }


UPSERT = """
INSERT INTO recipes (
    id, title, summary, image_key, image_url, servings, duration_minutes, difficulty,
    calories, protein_g, carbs_g, fat_g,
    meal_slots, categories, goals, tags, allergens,
    ingredients, steps,
    source_name, source_author, license, license_url,
    image_credit, content_version, component, plan_excluded_reason
) VALUES (
    %(id)s, %(title)s, %(summary)s, %(image_key)s, %(image_url)s, %(servings)s, %(duration_minutes)s, %(difficulty)s,
    %(calories)s, %(protein_g)s, %(carbs_g)s, %(fat_g)s,
    %(meal_slots)s, %(categories)s, %(goals)s, %(tags)s, %(allergens)s,
    %(ingredients)s, %(steps)s,
    %(source_name)s, %(source_author)s, %(license)s, %(license_url)s,
    %(image_credit)s, %(content_version)s, %(component)s, %(plan_excluded_reason)s
)
ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title, summary = EXCLUDED.summary,
    image_key = EXCLUDED.image_key, image_url = EXCLUDED.image_url,
    servings = EXCLUDED.servings, duration_minutes = EXCLUDED.duration_minutes,
    difficulty = EXCLUDED.difficulty, calories = EXCLUDED.calories,
    protein_g = EXCLUDED.protein_g, carbs_g = EXCLUDED.carbs_g,
    fat_g = EXCLUDED.fat_g,
    meal_slots = EXCLUDED.meal_slots, categories = EXCLUDED.categories,
    goals = EXCLUDED.goals, tags = EXCLUDED.tags, allergens = EXCLUDED.allergens,
    ingredients = EXCLUDED.ingredients, steps = EXCLUDED.steps,
    license = EXCLUDED.license,
    image_credit = EXCLUDED.image_credit, content_version = EXCLUDED.content_version,
    component = EXCLUDED.component, plan_excluded_reason = EXCLUDED.plan_excluded_reason,
    updated_at = now()
"""


def database_url(env_file: Path) -> str:
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("STEWARD_MIGRATE_DATABASE_URL="):
            return line.split("=", 1)[1].strip()
    raise SystemExit(f"在 {env_file} 里找不到 STEWARD_MIGRATE_DATABASE_URL")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument(
        "--archive-path",
        type=Path,
        default=DB_PATH,
        help="SQLite 菜谱归档路径；默认读取当前仓库的 tools/recipe-import/recipes.sqlite3",
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        default=REPO / ".env",
        help="包含 STEWARD_MIGRATE_DATABASE_URL 的环境文件",
    )
    parser.add_argument("--database-url", default=os.environ.get("STEWARD_MIGRATE_DATABASE_URL"))
    args = parser.parse_args()

    conn = sqlite3.connect(f"file:{args.archive_path}?mode=ro&immutable=1", uri=True)
    ids = [r[0] for r in conn.execute("SELECT id FROM recipes ORDER BY id")]
    if args.limit:
        ids = ids[: args.limit]

    rows, skipped = [], 0
    for rid in ids:
        row = build_row(conn, rid)
        if row is None:
            skipped += 1
            continue
        rows.append(row)
    print(f"准备写入 {len(rows)} 条（跳过 {skipped} 条无食材的）")

    if args.dry_run:
        sample = rows[0]
        for key in ("id", "title", "duration_minutes", "difficulty", "servings",
                    "calories", "protein_g", "fat_g",
                    "meal_slots", "categories", "allergens", "image_url",
                    "source_name", "license"):
            print(f"  {key} = {sample[key]}")
        print(f"  ingredients[0] = {json.loads(sample['ingredients'])[0]}")
        print(f"  steps[0] = {json.loads(sample['steps'])[0]}")
        with_images = sum(1 for r in rows if r["image_key"])
        no_meal = sum(1 for r in rows if not r["meal_slots"])
        print(f"\n有封面图 {with_images}/{len(rows)}，无餐段 {no_meal}")
        return 0

    try:
        import psycopg
    except ImportError:  # pragma: no cover
        print("需要 psycopg：pip install 'psycopg[binary]'", file=sys.stderr)
        return 1

    url = args.database_url or database_url(args.env_file)
    with psycopg.connect(url) as pg:
        with pg.cursor() as cur:
            for i, row in enumerate(rows, 1):
                cur.execute(UPSERT, row)
                if i % 500 == 0:
                    pg.commit()
                    print(f"  已写入 {i}/{len(rows)}")
        pg.commit()
        with pg.cursor() as cur:
            cur.execute("SELECT count(*) FROM recipes")
            total = cur.fetchone()[0]
            cur.execute(
                """SELECT count(*)
                   FROM recipes AS r
                   CROSS JOIN LATERAL jsonb_array_elements(r.steps) AS step
                   WHERE NULLIF(step->>'image_url', '') IS NOT NULL"""
            )
            step_images = cur.fetchone()[0]
    print(f"\n完成。recipes 表现有 {total} 条，已关联步骤图片 {step_images} 张")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
