#!/usr/bin/env python3
"""把版本化的 PMTiles、样式、字体和图标发布到私有 OSS。"""

from __future__ import annotations

import argparse
import mimetypes
from pathlib import Path

import oss2

REPO = Path(__file__).resolve().parents[2]
DEFAULT_ENV = REPO / ".local" / "deployment" / ".env.production"
IMMUTABLE_CACHE = "public, max-age=31536000, immutable"


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key.strip()] = value
    required = (
        "STEWARD_OSS_ENDPOINT",
        "STEWARD_OSS_BUCKET",
        "STEWARD_OSS_ACCESS_KEY_ID",
        "STEWARD_OSS_ACCESS_KEY_SECRET",
    )
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise SystemExit(f"环境文件缺少：{', '.join(missing)}")
    return values


def content_type(path: Path) -> str:
    overrides = {
        ".json": "application/json; charset=utf-8",
        ".pbf": "application/x-protobuf",
        ".pmtiles": "application/vnd.pmtiles",
        ".txt": "text/plain; charset=utf-8",
    }
    return overrides.get(path.suffix.lower(), mimetypes.guess_type(path.name)[0] or "application/octet-stream")


def headers_for(path: Path) -> dict[str, str]:
    return {
        "Content-Type": content_type(path),
        "Cache-Control": IMMUTABLE_CACHE,
    }


def same_size(bucket: oss2.Bucket, key: str, path: Path) -> bool:
    try:
        return bucket.head_object(key).content_length == path.stat().st_size
    except oss2.exceptions.NoSuchKey:
        return False


def upload_small(bucket: oss2.Bucket, key: str, path: Path) -> bool:
    if same_size(bucket, key, path):
        return False
    bucket.put_object_from_file(key, str(path), headers=headers_for(path))
    if not same_size(bucket, key, path):
        raise RuntimeError(f"上传后大小不一致：{key}")
    return True


def upload_pmtiles(bucket: oss2.Bucket, key: str, path: Path, checkpoint_dir: Path) -> None:
    if same_size(bucket, key, path):
        print(f"跳过已存在 {key}")
        return

    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    last_percent = -1

    def progress(consumed: int, total: int) -> None:
        nonlocal last_percent
        percent = consumed * 100 // total
        if percent >= last_percent + 5 or percent == 100:
            last_percent = percent
            print(
                f"PMTiles 上传 {percent}%（{consumed / 1024 / 1024:.0f}/{total / 1024 / 1024:.0f} MiB）",
                flush=True,
            )

    oss2.resumable_upload(
        bucket,
        key,
        str(path),
        store=oss2.ResumableStore(root=str(checkpoint_dir)),
        headers=headers_for(path),
        multipart_threshold=64 * 1024 * 1024,
        part_size=16 * 1024 * 1024,
        progress_callback=progress,
        num_threads=6,
    )
    if not same_size(bucket, key, path):
        raise RuntimeError(f"上传后大小不一致：{key}")
    print(f"PMTiles 上传完成：{key}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--release", required=True)
    parser.add_argument("--release-dir", type=Path, required=True)
    parser.add_argument("--pmtiles", type=Path)
    parser.add_argument("--static-only", action="store_true", help="只发布样式等小文件")
    parser.add_argument(
        "--checkpoint-dir",
        type=Path,
        default=REPO / ".local" / "maps" / "checkpoints",
    )
    args = parser.parse_args()

    if not args.release_dir.is_dir():
        raise SystemExit(f"找不到发布目录：{args.release_dir}")
    if not args.static_only and (args.pmtiles is None or not args.pmtiles.is_file()):
        raise SystemExit(f"找不到 PMTiles：{args.pmtiles}")

    env = load_env(args.env)
    auth = oss2.Auth(env["STEWARD_OSS_ACCESS_KEY_ID"], env["STEWARD_OSS_ACCESS_KEY_SECRET"])
    bucket = oss2.Bucket(auth, env["STEWARD_OSS_ENDPOINT"], env["STEWARD_OSS_BUCKET"])
    prefix = f"steward/maps/protomaps/{args.release}"

    static_files = sorted(item for item in args.release_dir.rglob("*") if item.is_file())
    uploaded = 0
    skipped = 0
    for index, path in enumerate(static_files, start=1):
        relative = path.relative_to(args.release_dir).as_posix()
        if upload_small(bucket, f"{prefix}/{relative}", path):
            uploaded += 1
        else:
            skipped += 1
        if index % 100 == 0 or index == len(static_files):
            print(
                f"静态资源 {index}/{len(static_files)}（新传 {uploaded}，已存在 {skipped}）",
                flush=True,
            )

    if not args.static_only:
        upload_pmtiles(bucket, f"{prefix}/china-z15.pmtiles", args.pmtiles, args.checkpoint_dir)
    print(
        f"发布完成：https://img.qhzhiyin.com/{prefix}/style-light-zh-hans.json",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
