SHELL := /bin/bash
.DEFAULT_GOAL := help

BACKEND := apps/backend
CONTRACTS := packages/contracts

.PHONY: help
help: ## 显示可用目标
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: install
install: ## 安装 TypeScript 依赖
	pnpm install

.PHONY: generate
generate: generate-contracts generate-ai-contracts generate-backend generate-client ## 运行全部代码生成

.PHONY: generate-ai-contracts
generate-ai-contracts: ## 把 AI Prompt 与 Schema 同步到后端供 go:embed
	./scripts/sync-ai-contracts.sh

.PHONY: generate-contracts
generate-contracts: ## 校验并打包 OpenAPI 为单文件 bundle
	pnpm --filter @steward/contracts run bundle

.PHONY: generate-backend
generate-backend: ## 由 OpenAPI 生成 Go DTO 与 strict server，并运行 sqlc
	cd $(BACKEND) && go tool oapi-codegen -config oapi-codegen.yaml ../../$(CONTRACTS)/dist/openapi.bundle.yaml
	cd $(BACKEND) && go tool sqlc generate

.PHONY: generate-client
generate-client: ## 由 OpenAPI 生成 TypeScript Client 与 Zod 校验器
	pnpm --filter @steward/api-client run generate

.PHONY: migrate
migrate: ## 应用数据库迁移
	cd $(BACKEND) && go run ./cmd/migrate up

.PHONY: migrate-down
migrate-down: ## 回滚最后一次迁移
	cd $(BACKEND) && go run ./cmd/migrate down

.PHONY: seed
seed: ## 写入本地示例数据
	cd $(BACKEND) && go run ./cmd/seed

.PHONY: api
api: ## 启动 HTTP API 进程
	cd $(BACKEND) && go run ./cmd/api

.PHONY: worker
worker: ## 启动 River Worker 进程
	cd $(BACKEND) && go run ./cmd/worker

.PHONY: format
format: ## 格式化 Go 代码
	cd $(BACKEND) && go fmt ./...

.PHONY: lint
lint: lint-backend lint-mobile ## 运行全部 Lint

.PHONY: lint-backend
lint-backend: ## Go vet 与架构依赖检查
	cd $(BACKEND) && go vet ./...

.PHONY: lint-mobile
lint-mobile: ## 移动端 ESLint
	pnpm mobile:lint

.PHONY: test
test: test-backend ## 运行全部测试

.PHONY: test-backend
test-backend: ## Go 单元测试
	cd $(BACKEND) && go test ./...

.PHONY: test-race
test-race: ## 核心并发路径 race 检测
	cd $(BACKEND) && go test -race ./internal/platform/... ./internal/modules/...

.PHONY: typecheck
typecheck: ## 移动端类型检查
	pnpm mobile:typecheck

.PHONY: check
check: format-check lint test typecheck ## 提交前全套检查

.PHONY: format-check
format-check: ## 校验 Go 代码已格式化
	@out=$$(cd $(BACKEND) && gofmt -l .); \
	if [ -n "$$out" ]; then echo "以下文件未格式化："; echo "$$out"; exit 1; fi

.PHONY: build
build: ## 构建后端二进制
	cd $(BACKEND) && go build -o ../../.local/bin/api ./cmd/api
	cd $(BACKEND) && go build -o ../../.local/bin/worker ./cmd/worker
