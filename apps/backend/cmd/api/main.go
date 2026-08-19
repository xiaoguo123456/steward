// Command api 启动 HTTP API 进程。
//
// 默认只负责处理请求与入队；异步任务由 worker 进程执行。
// 本地开发可以设置 STEWARD_EMBEDDED_WORKER=true，让单个进程同时跑 Worker。
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
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
		logger.Error("API 进程退出", "error", err)
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

	embedded := os.Getenv("STEWARD_EMBEDDED_WORKER") == "true"
	app, err := bootstrap.New(ctx, cfg, logger, bootstrap.Options{RunWorkers: embedded})
	if err != nil {
		return err
	}
	defer app.Close()

	if embedded {
		logger.Info("本进程同时执行队列任务（仅建议用于本地开发）")
		if err := app.Jobs.Start(ctx); err != nil {
			return err
		}
		defer func() {
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			_ = app.Jobs.Stop(shutdownCtx)
		}()
	}

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           app.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("API 已启动",
			"addr", cfg.HTTPAddr,
			"ai_provider", app.Parser.Name(),
			"embedded_worker", embedded)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		logger.Info("收到退出信号，正在优雅关闭")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return server.Shutdown(shutdownCtx)
}
