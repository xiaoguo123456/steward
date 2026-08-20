// Command admin-api 是后台管理的 HTTP 进程。
//
// **和公共 API 是两个进程、两个端口、两个数据库账号。**
// 它挂了不影响用户；用户端被打爆也不影响你还能不能进后台看发生了什么。
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

	"github.com/guoxiaozheng1/steward/apps/backend/internal/adminbootstrap"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.LoadAdmin()
	if err != nil {
		logger.Error("后台配置不完整", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	app, closeDB, err := adminbootstrap.New(ctx, cfg, logger)
	if err != nil {
		logger.Error("后台启动失败", "error", err)
		os.Exit(1)
	}
	defer closeDB()

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           app.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		logger.Info("后台 API 已启动",
			"addr", cfg.HTTPAddr,
			"environment", cfg.Environment,
			"reporting_timezone", cfg.ReportingTimezone)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("后台 API 进程退出", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	logger.Info("正在关闭后台 API")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("关闭超时", "error", err)
	}
}
