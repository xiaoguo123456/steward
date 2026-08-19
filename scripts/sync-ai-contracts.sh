#!/usr/bin/env bash
# 把 packages/ai-contracts 中的权威 Prompt 与 Schema 同步到后端供 go:embed。
#
# Go 只能 embed 自身 module 内的文件，因此必须复制一份。
# packages/ai-contracts 始终是唯一事实来源；后端目录下的副本是生成产物，
# 由 make generate 重新生成，禁止手工修改。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/packages/ai-contracts"
DST="$ROOT/apps/backend/internal/platform/ai/assets"

rm -rf "$DST/prompts" "$DST/schemas"
mkdir -p "$DST/prompts" "$DST/schemas"

cp -R "$SRC/prompts/." "$DST/prompts/"
cp -R "$SRC/schemas/." "$DST/schemas/"

cat > "$DST/README.md" <<'NOTE'
# 生成目录

本目录是 `packages/ai-contracts` 的副本，由 `scripts/sync-ai-contracts.sh` 生成，
供 Go 的 `go:embed` 使用。**禁止手工修改**。

要改 Prompt 或 Schema，请修改 `packages/ai-contracts` 后运行 `make generate`。
Go 只能 embed 自身 module 内的文件，所以必须保留这份副本；
权威版本始终是 `packages/ai-contracts`。
NOTE

echo "OK   AI 契约与 Prompt 已同步到 $DST"
