#!/usr/bin/env python3
"""生成一次性步骤补图 SQL；默认只预检，执行模式强制先在服务器备份。"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sqlite3
from pathlib import Path

from to_postgres import build_steps


def image_patch(archive: Path) -> list[dict]:
    with sqlite3.connect(f"file:{archive.resolve()}?mode=ro", uri=True) as conn:
        records = conn.execute("""SELECT r.id, r.name, r.tips FROM recipes r
            WHERE EXISTS(SELECT 1 FROM ingredients i WHERE i.recipe_id=r.id)
            ORDER BY r.id""").fetchall()
        patch = []
        for rid, name, tips in records:
            rows = conn.execute("""SELECT s.idx,s.text,i.oss_key FROM steps s
                LEFT JOIN images i ON i.recipe_id=s.recipe_id AND i.filename=s.image AND i.kind='step'
                WHERE s.recipe_id=? ORDER BY s.idx""", (rid,)).fetchall()
            for _, _, key in rows:
                if key and not re.fullmatch(rf"steward/recipes/{rid}/[A-Za-z0-9_.-]+", key):
                    raise ValueError("步骤图片对象键不属于当前菜谱")
            patch.append({"id": f"rcp_lf{rid}", "steps": build_steps(rows, tips or name)})
    if len(patch) != 4267 or sum("image_url" in s for r in patch for s in r["steps"]) != 17297:
        raise ValueError("归档不符合本次已核验的 4267 道菜与 17297 张步骤图基线")
    return patch


def repair_sql(patch: list[dict], backup_path: str | None = None) -> str:
    if backup_path and not re.fullmatch(r"/opt/steward-(prod|test)/backups/recipes-[0-9-]+/before\.csv", backup_path):
        raise ValueError("备份必须位于对应服务器的受限菜谱备份目录")
    stream = io.StringIO()
    writer = csv.writer(stream, lineterminator="\n")
    for row in patch:
        writer.writerow([row["id"], json.dumps(row["steps"], ensure_ascii=False)])
    sql = """\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TEMP TABLE image_patch(id text PRIMARY KEY, steps jsonb) ON COMMIT DROP;
COPY image_patch FROM STDIN WITH (FORMAT csv);
""" + stream.getvalue() + "\\.\n"
    sql += """DO $$ BEGIN
  IF (SELECT count(*) FROM image_patch) <> 4267 OR
     (SELECT count(*) FROM recipes r JOIN image_patch p ON r.id=p.id) <> 4267 THEN
    RAISE EXCEPTION '菜谱数量与已核验基线不同，停止补图';
  END IF;
"""
    if backup_path:
        sql += "  PERFORM 1 FROM recipes r JOIN image_patch p ON r.id=p.id FOR UPDATE OF r;\n"
    sql += """  IF EXISTS(SELECT 1 FROM recipes r JOIN image_patch p ON r.id=p.id
    WHERE r.license <> '已授权' OR coalesce(r.image_credit,'') <> '懒饭'
    OR (SELECT jsonb_agg(s-'image_url' ORDER BY n) FROM jsonb_array_elements(r.steps) WITH ORDINALITY t(s,n))
       IS DISTINCT FROM
       (SELECT jsonb_agg(s-'image_url' ORDER BY n) FROM jsonb_array_elements(p.steps) WITH ORDINALITY t(s,n))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.steps) WITH ORDINALITY t(s,n)
      WHERE nullif(s->>'image_url','') IS NOT NULL AND s->>'image_url' IS DISTINCT FROM p.steps->(n::int-1)->>'image_url')) THEN
    RAISE EXCEPTION '步骤内容、顺序、已有图片或授权不匹配，停止补图';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM recipes WHERE id='rcp_lf8025' AND title='西红柿去皮小窍门') THEN
    RAISE EXCEPTION '标注修复目标不匹配';
  END IF;
END $$;
CREATE TEMP TABLE repair_before ON COMMIT DROP AS
  SELECT r.id, r.steps, r.tags, r.updated_at, to_jsonb(r) AS full_row
  FROM recipes r JOIN image_patch p ON r.id=p.id
  WHERE r.steps IS DISTINCT FROM p.steps OR (r.id='rcp_lf8025' AND '不在推荐位展示'=ANY(r.tags));
SELECT json_build_object('affected_recipes',(SELECT count(*) FROM repair_before),
  'missing_images',(SELECT count(*) FROM recipes r JOIN image_patch p ON r.id=p.id,
    LATERAL jsonb_array_elements(p.steps) WITH ORDINALITY t(s,n)
    WHERE nullif(s->>'image_url','') IS NOT NULL AND nullif(r.steps->(n::int-1)->>'image_url','') IS NULL),
  'target_label_present',(SELECT '不在推荐位展示'=ANY(tags) FROM recipes WHERE id='rcp_lf8025'));
"""
    if not backup_path:
        return sql + "ROLLBACK;\n"
    sql += f"\\copy (SELECT id,steps,tags,updated_at FROM repair_before ORDER BY id) TO '{backup_path}' WITH (FORMAT csv, HEADER true)\n"
    sql += """UPDATE recipes r SET steps=p.steps,
  tags=CASE WHEN r.id='rcp_lf8025' THEN array_remove(r.tags,'不在推荐位展示') ELSE r.tags END,
  updated_at=now()
FROM image_patch p, repair_before b WHERE r.id=p.id AND r.id=b.id;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM recipes r JOIN repair_before b ON r.id=b.id
    WHERE to_jsonb(r)-'steps'-'tags'-'updated_at' IS DISTINCT FROM b.full_row-'steps'-'tags'-'updated_at'
       OR r.tags IS DISTINCT FROM CASE WHEN r.id='rcp_lf8025' THEN array_remove(b.tags,'不在推荐位展示') ELSE b.tags END)
    OR EXISTS(SELECT 1 FROM recipes r JOIN image_patch p ON r.id=p.id WHERE r.steps IS DISTINCT FROM p.steps)
    OR EXISTS(SELECT 1 FROM recipes WHERE id='rcp_lf8025' AND '不在推荐位展示'=ANY(tags)) THEN
    RAISE EXCEPTION '写入后的完整性校验失败';
  END IF;
END $$;
COMMIT;
SELECT json_build_object('step_images',(SELECT count(*) FROM recipes r,
  LATERAL jsonb_array_elements(r.steps) s WHERE nullif(s->>'image_url','') IS NOT NULL),
  'target_tags',(SELECT tags FROM recipes WHERE id='rcp_lf8025'));
"""
    return sql


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive-path", type=Path, required=True)
    parser.add_argument("--backup-path", help="提供时生成执行 SQL；须提前创建服务器目录且禁止覆盖旧备份")
    args = parser.parse_args()
    print(repair_sql(image_patch(args.archive_path), args.backup_path), end="")
