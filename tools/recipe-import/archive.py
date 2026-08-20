#!/usr/bin/env python3
"""把原始菜谱素材归档进 SQLite。

这一步**忠实保存源数据的形状**，不做任何领域映射：难度文本原样存
「零厨艺✌️」，耗时原样存「约10-20分钟」，食材保留原始的 value/unit/营养。

为什么不直接映射成 steward 的模型：映射规则一定会改（过敏原怎么推、
耗时取上限还是中位、哪些分类算快手菜），而原始 JSON 有 11G 且不进版本库。
有了这个底本，映射改了重跑一次就行，不用再去碰那 11G。

用法：
    python3 tools/recipe-import/archive.py            # 增量，已归档的跳过
    python3 tools/recipe-import/archive.py --rebuild  # 重建
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "菜谱数据"
DB_PATH = REPO / "tools" / "recipe-import" / "recipes.sqlite3"

SCHEMA = """
-- 源菜谱。字段基本与原始 JSON 一一对应，便于回溯与重新映射。
CREATE TABLE IF NOT EXISTS recipes (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    name_adj        TEXT,
    url             TEXT,
    create_time     TEXT,
    update_time     TEXT,
    difficulty_text TEXT,
    time_consuming  TEXT,
    serving_value   INTEGER,
    serving_unit    TEXT,
    tips            TEXT,
    n_views         INTEGER,
    n_collects      INTEGER,
    cover_image     TEXT,
    square_image    TEXT,
    -- 整份原始 JSON。上面拆出来的字段是为了查询方便，
    -- 真正的事实来源是这一列——将来发现漏了字段还能从这里补。
    raw             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
    recipe_id   INTEGER NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    category_id TEXT,
    name        TEXT NOT NULL,
    PRIMARY KEY (recipe_id, name)
);
CREATE INDEX IF NOT EXISTS categories_name_idx ON categories (name);

-- 食材。懒饭这份数据每条食材都带营养，这是它最有价值的地方：
-- 菜品营养可以由食材求和算出来，而不是让谁去估一个数。
CREATE TABLE IF NOT EXISTS ingredients (
    recipe_id    INTEGER NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    seq          INTEGER NOT NULL,
    group_name   TEXT,
    name         TEXT NOT NULL,
    amount       TEXT,
    value        REAL,
    unit         TEXT,
    calories     REAL,
    protein      REAL,
    fat          REAL,
    carbohydrate REAL,
    PRIMARY KEY (recipe_id, seq)
);
CREATE INDEX IF NOT EXISTS ingredients_name_idx ON ingredients (name);

CREATE TABLE IF NOT EXISTS steps (
    recipe_id INTEGER NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    idx       INTEGER NOT NULL,
    text      TEXT,
    tips      TEXT,
    image     TEXT,
    PRIMARY KEY (recipe_id, idx)
);

-- 图片。上传 OSS 之前 oss_key 为空，传完写回，因此可以断点续传。
CREATE TABLE IF NOT EXISTS images (
    recipe_id  INTEGER NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,          -- cover / square / step
    filename   TEXT NOT NULL,
    local_path TEXT NOT NULL,
    bytes      INTEGER,
    oss_key    TEXT,
    PRIMARY KEY (recipe_id, filename)
);
CREATE INDEX IF NOT EXISTS images_pending_idx ON images (oss_key) WHERE oss_key IS NULL;
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    # 归档是一次性批量写入，WAL 让中途中断也不至于留下半个库。
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def archive_one(conn: sqlite3.Connection, path: Path) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    rid = int(data["id"])
    serving = data.get("serving") or {}
    stats = data.get("stats") or {}

    conn.execute(
        """INSERT OR REPLACE INTO recipes (
               id, name, name_adj, url, create_time, update_time,
               difficulty_text, time_consuming, serving_value, serving_unit,
               tips, n_views, n_collects, cover_image, square_image, raw
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            rid,
            data.get("name") or "",
            data.get("name_adj"),
            data.get("url"),
            data.get("create_time"),
            data.get("update_time"),
            data.get("difficulty_text"),
            data.get("time_consuming"),
            serving.get("value"),
            serving.get("unit"),
            data.get("tips") or None,
            stats.get("n_views"),
            stats.get("n_collects"),
            data.get("cover_image"),
            data.get("square_image"),
            json.dumps(data, ensure_ascii=False),
        ),
    )

    for table in ("categories", "ingredients", "steps", "images"):
        conn.execute(f"DELETE FROM {table} WHERE recipe_id = ?", (rid,))

    for cat in data.get("categories") or []:
        name = (cat.get("name") or "").strip()
        if name:
            conn.execute(
                "INSERT OR IGNORE INTO categories (recipe_id, category_id, name) VALUES (?,?,?)",
                (rid, str(cat.get("id")), name),
            )

    seq = 0
    for group in data.get("ing_groups") or []:
        group_name = (group.get("name") or "").strip() or None
        for ing in group.get("ings") or []:
            conn.execute(
                """INSERT INTO ingredients (
                       recipe_id, seq, group_name, name, amount, value, unit,
                       calories, protein, fat, carbohydrate
                   ) VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    rid, seq, group_name,
                    (ing.get("name") or "").strip(),
                    ing.get("amount"), ing.get("value"), ing.get("unit"),
                    ing.get("calories"), ing.get("protein"),
                    ing.get("fat"), ing.get("carbohydrate"),
                ),
            )
            seq += 1

    for step in data.get("steps") or []:
        conn.execute(
            "INSERT OR REPLACE INTO steps (recipe_id, idx, text, tips, image) VALUES (?,?,?,?,?)",
            (rid, step.get("index"), step.get("text"), step.get("tips") or None, step.get("image")),
        )

    media_dir = SOURCE / "media" / str(rid)
    for kind, filename in _image_files(data):
        local = media_dir / filename
        if not local.exists():
            continue
        conn.execute(
            """INSERT OR REPLACE INTO images (recipe_id, kind, filename, local_path, bytes)
               VALUES (?,?,?,?,?)""",
            (rid, kind, filename, str(local), local.stat().st_size),
        )


def _image_files(data: dict):
    if data.get("cover_image"):
        yield "cover", data["cover_image"]
    if data.get("square_image"):
        yield "square", data["square_image"]
    for step in data.get("steps") or []:
        if step.get("image"):
            yield "step", step["image"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rebuild", action="store_true", help="重建整个库")
    args = parser.parse_args()

    if not SOURCE.exists():
        print(f"找不到源目录 {SOURCE}", file=sys.stderr)
        return 1

    if args.rebuild and DB_PATH.exists():
        DB_PATH.unlink()
        for suffix in ("-wal", "-shm"):
            extra = DB_PATH.with_name(DB_PATH.name + suffix)
            if extra.exists():
                extra.unlink()

    conn = connect()
    conn.executescript(SCHEMA)

    done = {row[0] for row in conn.execute("SELECT id FROM recipes")}
    files = sorted((SOURCE / "recipes").glob("*.json"))
    pending = [f for f in files if int(f.stem) not in done] if not args.rebuild else files

    print(f"源文件 {len(files)} 个，已归档 {len(done)} 条，本次处理 {len(pending)} 条")

    ok = failed = 0
    for i, path in enumerate(pending, 1):
        try:
            archive_one(conn, path)
            ok += 1
        except Exception as exc:  # noqa: BLE001 — 单条坏数据不该中断整批
            failed += 1
            print(f"  跳过 {path.name}: {type(exc).__name__} {exc}", file=sys.stderr)
        if i % 500 == 0:
            conn.commit()
            print(f"  已处理 {i}/{len(pending)}")
    conn.commit()

    stats = {
        name: conn.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
        for name in ("recipes", "categories", "ingredients", "steps", "images")
    }
    print(f"\n完成：成功 {ok}，失败 {failed}")
    print("  " + "，".join(f"{k} {v}" for k, v in stats.items()))
    print(f"  库文件：{DB_PATH}")
    conn.close()
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
