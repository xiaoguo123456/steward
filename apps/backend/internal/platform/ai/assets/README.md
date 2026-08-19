# 生成目录

本目录是 `packages/ai-contracts` 的副本，由 `scripts/sync-ai-contracts.sh` 生成，
供 Go 的 `go:embed` 使用。**禁止手工修改**。

要改 Prompt 或 Schema，请修改 `packages/ai-contracts` 后运行 `make generate`。
Go 只能 embed 自身 module 内的文件，所以必须保留这份副本；
权威版本始终是 `packages/ai-contracts`。
