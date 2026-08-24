#!/usr/bin/env python3
"""核对地图发布对象，并在上传中显示分片进度。"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import oss2

from publish_oss import DEFAULT_ENV, load_env


def show_multipart_progress(bucket: oss2.Bucket, key: str, expected_size: int) -> None:
    uploads = bucket.list_multipart_uploads(prefix=key).upload_list
    upload = next((item for item in uploads if item.key == key), None)
    if upload is None:
        print("OSS 上还没有完整对象或可见的分片上传任务。")
        return
    parts = bucket.list_parts(key, upload.upload_id).parts
    uploaded = sum(part.size for part in parts)
    percent = uploaded * 100 / expected_size if expected_size else 0
    print(
        f"PMTiles 上传中：{len(parts)} 个分片，"
        f"{uploaded / 1024 / 1024:.0f} MiB / {expected_size / 1024 / 1024:.0f} MiB（{percent:.1f}%）"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--release", required=True)
    parser.add_argument("--pmtiles", type=Path)
    args = parser.parse_args()

    env = load_env(args.env)
    auth = oss2.Auth(env["STEWARD_OSS_ACCESS_KEY_ID"], env["STEWARD_OSS_ACCESS_KEY_SECRET"])
    bucket = oss2.Bucket(auth, env["STEWARD_OSS_ENDPOINT"], env["STEWARD_OSS_BUCKET"])
    prefix = f"steward/maps/protomaps/{args.release}"
    pmtiles_key = f"{prefix}/china-z15.pmtiles"
    expected_size = args.pmtiles.stat().st_size if args.pmtiles else 0

    try:
        pmtiles_meta = bucket.head_object(pmtiles_key)
    except oss2.exceptions.NoSuchKey:
        show_multipart_progress(bucket, pmtiles_key, expected_size)
        return 2

    if expected_size and pmtiles_meta.content_length != expected_size:
        raise SystemExit(
            f"PMTiles 大小不一致：OSS {pmtiles_meta.content_length}，本地 {expected_size}"
        )

    partial = bucket.get_object(pmtiles_key, byte_range=(0, 126))
    header = partial.read()
    if partial.status != 206 or len(header) != 127 or not header.startswith(b"PMTiles\x03"):
        raise SystemExit("PMTiles Range 读取或文件头校验失败")

    style_key = f"{prefix}/style-light-zh-hans.json"
    style = json.loads(bucket.get_object(style_key).read())
    expected_url = f"pmtiles://https://img.qhzhiyin.com/{pmtiles_key}"
    if style.get("sources", {}).get("protomaps", {}).get("url") != expected_url:
        raise SystemExit("样式中的 PMTiles 地址不正确")
    if style.get("metadata", {}).get("steward:language") != "zh-Hans":
        raise SystemExit("样式不是简体中文 zh-Hans")

    required = (
        f"{prefix}/manifest.json",
        f"{prefix}/assets/sprites/v4/light.json",
        f"{prefix}/assets/sprites/v4/light.png",
        f"{prefix}/assets/fonts/Noto Sans Regular/19968-20223.pbf",
    )
    for key in required:
        bucket.head_object(key)

    print(
        f"OSS 校验通过：PMTiles {pmtiles_meta.content_length} 字节，"
        f"Range=206，样式与代表性字体/图标均存在。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
