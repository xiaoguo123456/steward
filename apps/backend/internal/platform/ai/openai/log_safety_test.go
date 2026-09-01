package openai

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

func TestProviderErrorLogDoesNotContainRawResponse(t *testing.T) {
	const secret = "用户私密正文-不要写日志"
	tests := []struct {
		name   string
		status int
		body   string
	}{
		{name: "HTTP错误正文", status: http.StatusBadGateway, body: secret},
		{name: "业务错误消息", status: http.StatusOK,
			body: `{"error":{"type":"provider_error","message":"` + secret + `"}}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()

			var logs bytes.Buffer
			provider, err := New(Config{
				BaseURL: server.URL, APIKey: "test-key", ParseModel: "test-model",
				Logger: slog.New(slog.NewJSONHandler(&logs, nil)),
			})
			if err != nil {
				t.Fatalf("创建 Provider 失败：%v", err)
			}
			_, _ = provider.Complete(context.Background(), ai.CompletionRequest{
				Messages: []ai.Message{{Role: ai.RoleUser, Content: "测试"}},
			})
			if strings.Contains(logs.String(), secret) {
				t.Fatalf("Provider 原始错误正文泄漏到日志：%s", logs.String())
			}
		})
	}
}
