#!/usr/bin/env python3
"""把菜谱图片传到 OSS，可断点续传。

已传的对象会把 oss_key 写回 SQLite，所以中断之后重跑只补没传的那些——
25897 个文件 5.7G，一次跑完不现实，必须能续。

凭据从 huahuadog 的 env 文件读，不复制到 steward 的配置里：
同一份密钥散落在两个项目里，轮换时一定会漏掉一个。

用法：
    python3 tools/recipe-import/upload_images.py             # 续传
    python3 tools/recipe-import/upload_images.py --limit 50  # 先试一小批
    python3 tools/recipe-import/upload_images.py --verify    # 只核对，不上传
"""

from __future__ import annotations

import argparse
import os
import queue
import sqlite3
import sys
import threading
from pathlib import Path

try:
    import oss2
except ImportError:  # pragma: no cover
    print("需要 oss2：pip install oss2", file=sys.stderr)
    raise SystemExit(1)

REPO = Path(__file__).resolve().parents[2]
DB_PATH = REPO / "tools" / "recipe-import" / "recipes.sqlite3"
DEFAULT_ENV = Path.home() / "Documents" / "project" / "huahuadog" / ".env.prod.real"

# 对象前缀。菜谱图是平台内容，和用户私有媒体分开放。
KEY_PREFIX = "steward/recipes"


def load_credentials(env_path: Path) -> dict:
    if not env_path.exists():
        raise SystemExit(f"找不到凭据文件 {env_path}")
    env = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key.strip()] = value.split("#")[0].strip()
    missing = [
        k for k in ("OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET", "OSS_ENDPOINT", "OSS_BUCKET")
        if not env.get(k)
    ]
    if missing:
        raise SystemExit(f"凭据文件缺少：{', '.join(missing)}")
    return env


def object_key(recipe_id: int, filename: str) -> str:
    return f"{KEY_PREFIX}/{recipe_id}/{filename}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--limit", type=int, default=0, help="只传前 N 个，用于试跑")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--verify", action="store_true", help="只核对 OSS 上是否存在，不上传")
    args = parser.parse_args()

    env = load_credentials(args.env)
    auth = oss2.Auth(env["OSS_ACCESS_KEY_ID"], env["OSS_ACCESS_KEY_SECRET"])
    bucket = oss2.Bucket(auth, env["OSS_ENDPOINT"], env["OSS_BUCKET"])
    print(f"桶 {env['OSS_BUCKET']}，前缀 {KEY_PREFIX}/")

    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA journal_mode = WAL")

    if args.verify:
        return verify(conn, bucket)

    rows = conn.execute(
        """SELECT recipe_id, filename, local_path, bytes FROM images
           WHERE oss_key IS NULL ORDER BY recipe_id, filename"""
    ).fetchall()
    if args.limit:
        rows = rows[: args.limit]

    total_bytes = sum(r[3] or 0 for r in rows)
    print(f"待传 {len(rows)} 个文件，约 {total_bytes / 1024 / 1024:.0f} MB")
    if not rows:
        print("没有要传的了。")
        return 0

    work: queue.Queue = queue.Queue()
    for row in rows:
        work.put(row)

    # 写回数据库只在主线程做：SQLite 的并发写会互相锁，
    # 而这里的瓶颈是网络不是写库。
    done: queue.Queue = queue.Queue()
    lock = threading.Lock()
    counters = {"ok": 0, "skip": 0, "fail": 0}

    def worker() -> None:
        while True:
            try:
                recipe_id, filename, local_path, _ = work.get_nowait()
            except queue.Empty:
                return
            key = object_key(recipe_id, filename)
            try:
                # 已经在 OSS 上就不重传：SQLite 被重建过时这一步能省掉整轮上传。
                if bucket.object_exists(key):
                    with lock:
                        counters["skip"] += 1
                else:
                    bucket.put_object_from_file(key, local_path)
                    with lock:
                        counters["ok"] += 1
                done.put((key, recipe_id, filename))
            except Exception as exc:  # noqa: BLE001 — 单个失败不该中断整批
                with lock:
                    counters["fail"] += 1
                print(f"  失败 {key}: {type(exc).__name__} {exc}", file=sys.stderr)
            finally:
                work.task_done()

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(args.workers)]
    for t in threads:
        t.start()

    written = 0
    pending_writes = []
    while any(t.is_alive() for t in threads) or not done.empty():
        try:
            key, recipe_id, filename = done.get(timeout=1)
        except queue.Empty:
            continue
        pending_writes.append((key, recipe_id, filename))
        if len(pending_writes) >= 100:
            conn.executemany(
                "UPDATE images SET oss_key = ? WHERE recipe_id = ? AND filename = ?",
                pending_writes,
            )
            conn.commit()
            written += len(pending_writes)
            pending_writes.clear()
            print(f"  已完成 {written}/{len(rows)}"
                  f"（新传 {counters['ok']}，已存在 {counters['skip']}，失败 {counters['fail']}）")

    if pending_writes:
        conn.executemany(
            "UPDATE images SET oss_key = ? WHERE recipe_id = ? AND filename = ?",
            pending_writes,
        )
        conn.commit()
        written += len(pending_writes)

    remaining = conn.execute("SELECT count(*) FROM images WHERE oss_key IS NULL").fetchone()[0]
    print(f"\n本次写回 {written} 条；新传 {counters['ok']}，已存在 {counters['skip']}，失败 {counters['fail']}")
    print(f"仍未上传：{remaining}（重跑本脚本即可续传）")
    conn.close()
    return 0 if counters["fail"] == 0 else 1


def verify(conn: sqlite3.Connection, bucket) -> int:
    """抽查 OSS 上确实存在，防止「库里标了已传但对象不在」。"""
    rows = conn.execute(
        "SELECT oss_key FROM images WHERE oss_key IS NOT NULL ORDER BY random() LIMIT 30"
    ).fetchall()
    if not rows:
        print("库里还没有已上传记录。")
        return 0
    missing = [k for (k,) in rows if not bucket.object_exists(k)]
    print(f"抽查 {len(rows)} 个，缺失 {len(missing)}")
    for key in missing[:10]:
        print("  缺:", key)
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
