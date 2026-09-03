package openai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

func TestDisabledThinkingIsSentAcrossChatPaths(t *testing.T) {
	var (
		mu       sync.Mutex
		requests []map[string]any
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		mu.Lock()
		requests = append(requests, body)
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		if streaming, _ := body["stream"].(bool); streaming {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"完成\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			return
		}
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"完成"},"finish_reason":"stop"}]}`)
	}))
	defer server.Close()

	provider, err := New(Config{
		BaseURL:      server.URL,
		APIKey:       "test-key",
		ParseModel:   "qwen3.8-flash",
		ChatModel:    "qwen3.8-flash",
		ThinkingMode: "disabled",
	})
	if err != nil {
		t.Fatalf("创建 Provider 失败：%v", err)
	}

	if _, _, err := provider.chat(context.Background(), provider.cfg.ParseModel,
		[]chatMessage{{Role: "user", Content: "返回 JSON"}}, true); err != nil {
		t.Fatalf("结构化请求失败：%v", err)
	}
	if _, err := provider.Complete(context.Background(), ai.CompletionRequest{
		Messages: []ai.Message{{Role: ai.RoleUser, Content: "查询今天任务"}},
		Tools: []ai.ToolSpec{{
			Name:       "tasks.search",
			Parameters: map[string]any{"type": "object"},
		}},
	}); err != nil {
		t.Fatalf("工具请求失败：%v", err)
	}
	if _, err := provider.CompleteStream(context.Background(), ai.CompletionRequest{
		Messages: []ai.Message{{Role: ai.RoleUser, Content: "你好"}},
	}, nil); err != nil {
		t.Fatalf("流式请求失败：%v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(requests) != 3 {
		t.Fatalf("预期捕获三条请求，实际 %d", len(requests))
	}
	for index, request := range requests {
		value, exists := request["enable_thinking"]
		if !exists || value != false {
			t.Errorf("第 %d 条请求必须显式关闭思考，实际值=%v，存在=%v", index+1, value, exists)
		}
	}
}

func TestProviderDefaultThinkingOmitsExtensionField(t *testing.T) {
	var request map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&request)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"完成"},"finish_reason":"stop"}]}`)
	}))
	defer server.Close()

	provider, err := New(Config{
		BaseURL:    server.URL,
		APIKey:     "test-key",
		ParseModel: "generic-model",
	})
	if err != nil {
		t.Fatalf("创建 Provider 失败：%v", err)
	}
	if _, _, err := provider.chat(context.Background(), provider.cfg.ParseModel,
		[]chatMessage{{Role: "user", Content: "你好"}}, false); err != nil {
		t.Fatalf("默认请求失败：%v", err)
	}
	if _, exists := request["enable_thinking"]; exists {
		t.Fatal("provider-default 不应向通用 OpenAI 兼容服务发送扩展字段")
	}
}

func TestProviderRejectsUnknownThinkingMode(t *testing.T) {
	_, err := New(Config{
		BaseURL:      "https://ai.example.com",
		APIKey:       "test-key",
		ParseModel:   "parse-model",
		ThinkingMode: "slow",
	})
	if err == nil {
		t.Fatal("未知思考模式必须拒绝启动")
	}
}
