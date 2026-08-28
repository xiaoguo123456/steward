#!/usr/bin/env python3
"""核对目标 PostgreSQL 中的菜谱分类结果，不输出连接信息。"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone, timedelta
from pathlib import Path

import psycopg

from to_postgres import BREAKFAST_EXCLUDED_TAGS, CONTENT_VERSION, database_url

SEASONS = (
    ("season_spring", "春季"),
    ("season_summer", "夏季"),
    ("season_autumn", "秋季"),
    ("season_winter", "冬季"),
)


def current_season_tag(now: datetime) -> tuple[str, str]:
    month = now.month
    if 3 <= month <= 5:
        return "season_spring", "春季"
    if 6 <= month <= 8:
        return "season_summer", "夏季"
    if 9 <= month <= 11:
        return "season_autumn", "秋季"
    return "season_winter", "冬季"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path, required=True)
    args = parser.parse_args()

    china = timezone(timedelta(hours=8))
    season_tag, _ = current_season_tag(datetime.now(china))
    categories = ["recommended", "quick", "fat_loss", "muscle_gain", "steady_sugar"]

    with psycopg.connect(database_url(args.env_file)) as pg, pg.cursor() as cur:
        cur.execute("SELECT count(*) FROM recipes WHERE content_version = %s", (CONTENT_VERSION,))
        print(f"内容版本 {CONTENT_VERSION}: {cur.fetchone()[0]} 道")

        cur.execute(
            """SELECT count(*) FROM recipes
               WHERE 'breakfast' = ANY(meal_slots)
                 AND tags && %s::text[]""",
            (sorted(BREAKFAST_EXCLUDED_TAGS),),
        )
        invalid_breakfast_count = cur.fetchone()[0]
        print(f"早餐中的午晚餐型菜谱: {invalid_breakfast_count} 道")

        for category in categories:
            cur.execute("SELECT count(*) FROM recipes WHERE %s = ANY(categories)", (category,))
            print(f"{category}: {cur.fetchone()[0]} 道")

        for tag, name in SEASONS:
            cur.execute(
                "SELECT count(*) FROM recipes WHERE 'seasonal' = ANY(categories) AND %s = ANY(tags)",
                (tag,),
            )
            current = "，当前" if tag == season_tag else ""
            print(f"seasonal（{name}{current}）: {cur.fetchone()[0]} 道")

        for category in ["fat_loss", "muscle_gain", "steady_sugar"]:
            cur.execute(
                "SELECT title FROM recipes WHERE %s = ANY(categories) ORDER BY duration_minutes, id LIMIT 3",
                (category,),
            )
            print(f"{category} 样本: {'、'.join(row[0] for row in cur.fetchall())}")
    if invalid_breakfast_count:
        print("校验失败：咖喱、炒饭、焖饭或火锅类仍进入早餐自动菜单候选。")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
