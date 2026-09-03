package bootstrap

import (
	"context"
	"io"
	"log/slog"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

func TestNewEngineFollowsConfiguration(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	provider := bootstrapTestProvider{}

	tests := []struct {
		name       string
		provider   ai.ChatProvider
		engineType string
		want       string
	}{
		{name: "默认薄循环", provider: provider, engineType: "direct", want: "direct"},
		{name: "Eino 单 Agent", provider: provider, engineType: "eino", want: "eino"},
		{name: "Provider 不可用", provider: nil, engineType: "eino", want: "unavailable"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			engine := newEngine(tc.provider, tc.engineType, logger)
			if got := ai.EngineType(engine); got != tc.want {
				t.Fatalf("引擎类型不对：want=%s got=%s", tc.want, got)
			}
			if ai.EngineVersion(engine) == "unknown" {
				t.Fatal("实际引擎必须提供可审计版本")
			}
		})
	}
}

type bootstrapTestProvider struct{}

func (bootstrapTestProvider) Complete(context.Context, ai.CompletionRequest) (ai.CompletionResult, error) {
	return ai.CompletionResult{Content: "测试"}, nil
}

func (bootstrapTestProvider) Name() string      { return "bootstrap-test" }
func (bootstrapTestProvider) ModelName() string { return "bootstrap-test-v1" }
