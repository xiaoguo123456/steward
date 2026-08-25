#!/usr/bin/env python3
"""调用已配置的 OpenAI 兼容 API，生成可审计的时令食材标签库。"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import sqlite3
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import jsonschema

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "tools" / "recipe-import" / "recipes.sqlite3"
PROMPT_PATH = ROOT / "packages" / "ai-contracts" / "prompts" / "recipe-seasonality" / "v1.md"
SCHEMA_PATH = ROOT / "packages" / "ai-contracts" / "schemas" / "recipes" / "seasonal-ingredient-tags.v1.schema.json"
OUTPUT_PATH = ROOT / "tools" / "recipe-import" / "tags" / "seasonal-ingredients.v2.json"
CACHE_DIR = ROOT / "tools" / "recipe-import" / ".seasonal-cache"
PROMPT_VERSION = "recipe-seasonality@v1"
SCHEMA_VERSION = "seasonal-ingredient-tags.v1"
SEASON_ORDER = ("spring", "summer", "autumn", "winter")


def seasons_for_months(months: list[int]) -> list[str]:
    """把模型给出的自然月份一次性归并为产品使用的四季标签。"""
    seasons: set[str] = set()
    for month in months:
        if 3 <= month <= 5:
            seasons.add("spring")
        elif 6 <= month <= 8:
            seasons.add("summer")
        elif 9 <= month <= 11:
            seasons.add("autumn")
        else:
            seasons.add("winter")
    return [season for season in SEASON_ORDER if season in seasons]


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def ingredients(path: Path) -> list[str]:
    conn = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)
    try:
        return [row[0] for row in conn.execute("SELECT DISTINCT name FROM ingredients ORDER BY name")]
    finally:
        conn.close()


def batches(items: list[str], size: int):
    for start in range(0, len(items), size):
        yield items[start : start + size]


def cache_path(model: str, names: list[str]) -> Path:
    digest = hashlib.sha256(
        json.dumps([PROMPT_VERSION, model, names], ensure_ascii=False).encode("utf-8")
    ).hexdigest()[:20]
    return CACHE_DIR / f"{digest}.json"


def call_api(base_url: str, api_key: str, model: str, prompt: str, names: list[str]) -> dict:
    payload = {
        "model": model,
        "temperature": 0,
        "max_completion_tokens": 10000,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": "请按约定返回 json 对象："
                + json.dumps({"ingredients": names}, ensure_ascii=False),
            },
        ],
    }
    request = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"模型服务返回 HTTP {exc.code}：{detail}") from exc
    choices = body.get("choices") or []
    if not choices:
        raise RuntimeError("模型服务没有返回 choices")
    return json.loads(choices[0]["message"]["content"])


def validate_batch(result: dict, names: list[str], schema: dict) -> None:
    jsonschema.validate(result, schema)
    returned = [item["ingredient_name"] for item in result["items"]]
    if len(returned) != len(set(returned)):
        raise ValueError("模型返回了重复食材")
    if set(returned) != set(names):
        missing = sorted(set(names) - set(returned))[:5]
        extra = sorted(set(returned) - set(names))[:5]
        raise ValueError(f"输入输出不一致，缺少={missing}，多出={extra}")
    for item in result["items"]:
        item["months"] = sorted(item["months"])


def generate_batch(
    *, base_url: str, api_key: str, model: str, prompt: str, names: list[str], schema: dict
) -> dict:
    path = cache_path(model, names)
    if path.exists():
        cached = json.loads(path.read_text(encoding="utf-8"))
        validate_batch(cached, names, schema)
        return cached

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            result = call_api(base_url, api_key, model, prompt, names)
            validate_batch(result, names, schema)
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            return result
        except Exception as exc:  # noqa: BLE001 - 这里要统一做有限重试
            last_error = exc
            if attempt < 2:
                time.sleep(2**attempt)
    raise RuntimeError(f"批次生成失败：{last_error}") from last_error


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env")
    parser.add_argument("--archive-path", type=Path, default=ARCHIVE)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--batch-size", type=int, default=60)
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    env = load_env(args.env_file)
    base_url = env.get("STEWARD_AI_BASE_URL", "")
    api_key = env.get("STEWARD_AI_API_KEY", "")
    model = env.get("STEWARD_AI_MODEL_PARSE", "")
    if not base_url or not api_key or not model:
        raise SystemExit("env 文件缺少 STEWARD_AI_BASE_URL / API_KEY / MODEL_PARSE")
    if not 1 <= args.batch_size <= 80:
        raise SystemExit("batch-size 必须在 1—80 之间")
    if not 1 <= args.concurrency <= 5:
        raise SystemExit("concurrency 必须在 1—5 之间")

    names = ingredients(args.archive_path)
    if args.limit:
        names = names[: args.limit]
    prompt = PROMPT_PATH.read_text(encoding="utf-8")
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

    grouped = list(batches(names, args.batch_size))
    results: list[dict | None] = [None] * len(grouped)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = {
            executor.submit(
                generate_batch,
                base_url=base_url,
                api_key=api_key,
                model=model,
                prompt=prompt,
                names=group,
                schema=schema,
            ): index
            for index, group in enumerate(grouped)
        }
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            index = futures[future]
            results[index] = future.result()
            completed += 1
            print(f"已完成 {completed}/{len(grouped)} 批", flush=True)

    all_items = [item for result in results if result for item in result["items"]]

    seasonal = {
        item["ingredient_name"]: {
            "normalized_name": item["normalized_name"],
            "seasons": seasons_for_months(item["months"]),
            "reason": item["reason"],
        }
        for item in all_items
        if item["kind"] == "seasonal_fresh"
    }
    source_hash = hashlib.sha256(
        json.dumps(names, ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    output = {
        "version": "seasonal-ingredients.v2",
        "prompt_version": PROMPT_VERSION,
        "schema_version": SCHEMA_VERSION,
        "region": "中国大陆华东、华中",
        "basis": "自然上市旺季，模型月份结果归并为春夏秋冬",
        "model": model,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_ingredient_count": len(names),
        "source_hash": source_hash,
        "ingredients": dict(sorted(seasonal.items())),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"完成：{len(names)} 项中保留 {len(seasonal)} 项时令主食材，写入 {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
