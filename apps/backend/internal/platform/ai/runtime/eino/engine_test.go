package eino

import (
	"log/slog"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/runtime/internal/conformancetest"
)

func TestEngineConformance(t *testing.T) {
	conformancetest.Run(t, func(provider ai.ChatProvider, logger *slog.Logger) ai.OrchestrationEngine {
		return New(provider, logger)
	})
}
