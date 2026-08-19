// Command worker 启动 River Worker 进程。
//
// 它与 API 使用不同的进程入口，但共享同一个数据库角色与 JWT 密钥。
// Worker 负责 capture.parse 等用户级任务；跨用户的维护任务在独立 profile 中运行。
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/bootstrap"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	if err := run(logger); err != nil {
		logger.Error("Worker 进程退出", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	app, err := bootstrap.New(ctx, cfg, logger, bootstrap.Options{RunWorkers: true})
	if err != nil {
		return err
	}
	defer app.Close()

	if err := app.Jobs.Start(ctx); err != nil {
		return err
	}
	logger.Info("Worker 已启动", "ai_provider", app.Parser.Name())

	<-ctx.Done()
	logger.Info("收到退出信号，等待进行中的任务结束")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return app.Jobs.Stop(shutdownCtx)
}
