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
	cd $(BACKEND) && GOWORK=off go tool oapi-codegen -config oapi-codegen.yaml ../../$(CONTRACTS)/dist/openapi.bundle.yaml
	cd $(BACKEND) && GOWORK=off go tool oapi-codegen -config oapi-codegen-admin.yaml ../../$(CONTRACTS)/dist/admin.bundle.yaml
	cd $(BACKEND) && GOWORK=off go tool sqlc generate

.PHONY: generate-client
generate-client: ## 由 OpenAPI 生成 TypeScript Client 与 Zod 校验器
	pnpm --filter @steward/api-client run generate
	pnpm --filter @steward/admin-api-client run generate

.PHONY: admin-api
admin-api: ## 启动后台管理 API
	cd $(BACKEND) && go run ./cmd/admin-api

.PHONY: admin-passwd
admin-passwd: ## 生成管理员口令的 Argon2id 散列
	cd $(BACKEND) && go run ./cmd/admin-passwd

.PHONY: migrate
migrate: ## 应用数据库迁移
	cd $(BACKEND) && go run ./cmd/migrate up

.PHONY: migrate-test
migrate-test: ## 把测试库迁到最新（行级安全集成测试需要）
	cd $(BACKEND) && STEWARD_MIGRATE_DATABASE_URL="$${STEWARD_TEST_MIGRATE_URL:-postgres://$$USER@localhost:5432/steward_test?sslmode=disable}" go run ./cmd/migrate up

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
test: test-backend test-mobile ## 运行全部测试

.PHONY: test-backend
test-backend: ## Go 单元测试
	cd $(BACKEND) && go test ./...

.PHONY: test-mobile
test-mobile: ## 运行移动端确定性逻辑测试
	pnpm mobile:test

.PHONY: test-race
test-race: ## 核心并发路径 race 检测
	cd $(BACKEND) && go test -race ./internal/platform/... ./internal/modules/...

.PHONY: eval
eval: ## 跑 AI 评测套件并打印质量基线（硬门槛已包含在 make test 里）
	cd $(BACKEND) && go test -v -count=1 ./internal/platform/ai/eval/

.PHONY: eval-update
eval-update: ## 把本次结果固化为新基线；确认过变化再跑，然后提交 baseline.json
	cd $(BACKEND) && STEWARD_EVAL_UPDATE_BASELINE=1 go test -v -count=1 ./internal/platform/ai/eval/

.PHONY: typecheck
typecheck: ## 移动端与后台类型检查
	pnpm mobile:typecheck
	pnpm admin:typecheck

.PHONY: check
check: format-check lint test typecheck test-admin ## 提交前全套检查

.PHONY: test-admin
test-admin: ## 后台前端测试
	pnpm admin:test

.PHONY: format-check
format-check: ## 校验 Go 代码已格式化
	@out=$$(cd $(BACKEND) && gofmt -l .); \
	if [ -n "$$out" ]; then echo "以下文件未格式化："; echo "$$out"; exit 1; fi

.PHONY: build
build: ## 构建后端二进制
	mkdir -p .local/bin
	cd $(BACKEND) && go build -o ../../.local/bin/api ./cmd/api
	cd $(BACKEND) && go build -o ../../.local/bin/worker ./cmd/worker
	cd $(BACKEND) && go build -o ../../.local/bin/admin-api ./cmd/admin-api
	cd $(BACKEND) && go build -o ../../.local/bin/migrate ./cmd/migrate
