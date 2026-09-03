package openai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

func TestTranscribeViaChatCompletions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			t.Fatalf("Qwen-ASR 应走 Chat Completions，实际路径：%s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Fatal("缺少 Provider 鉴权头")
		}

		var request struct {
			Model    string `json:"model"`
			Messages []struct {
				Content []struct {
					Type       string `json:"type"`
					InputAudio struct {
						Data string `json:"data"`
					} `json:"input_audio"`
				} `json:"content"`
			} `json:"messages"`
			ASROptions struct {
				Language  string `json:"language"`
				EnableITN bool   `json:"enable_itn"`
			} `json:"asr_options"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("解析请求失败：%v", err)
		}
		if request.Model != "qwen3-asr-flash" {
			t.Fatalf("转写模型错误：%s", request.Model)
		}
		if len(request.Messages) != 1 || len(request.Messages[0].Content) != 1 {
			t.Fatalf("音频消息结构错误：%+v", request.Messages)
		}
		part := request.Messages[0].Content[0]
		if part.Type != "input_audio" || !strings.HasPrefix(part.InputAudio.Data, "data:audio/wav;base64,") {
			t.Fatalf("音频必须以内联 data URI 发送，实际：%+v", part)
		}
		if request.ASROptions.Language != "zh" || !request.ASROptions.EnableITN {
			t.Fatalf("中文转写参数错误：%+v", request.ASROptions)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"你好，这是语音测试。"},"finish_reason":"stop"}],"usage":{"prompt_tokens":53,"completion_tokens":13}}`)
	}))
	defer server.Close()

	provider, err := New(Config{
		BaseURL:            server.URL,
		APIKey:             "test-key",
		ParseModel:         "qwen3.8-flash",
		TranscribeModel:    "qwen3-asr-flash",
		TranscribeProtocol: "chat-completions",
	})
	if err != nil {
		t.Fatalf("创建 Provider 失败：%v", err)
	}

	text, usage, err := provider.Transcribe(context.Background(), ai.MediaInput{
		ContentType: "audio/wav",
		Data:        []byte("audio-bytes"),
	})
	if err != nil {
		t.Fatalf("转写失败：%v", err)
	}
	if text != "你好，这是语音测试。" {
		t.Fatalf("转写正文错误：%q", text)
	}
	if usage.InputTokens != 53 || usage.OutputTokens != 13 {
		t.Fatalf("转写用量没有映射：%+v", usage)
	}
}

func TestTranscribeDefaultsToAudioTranscriptions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/audio/transcriptions" {
			t.Fatalf("默认协议路径错误：%s", r.URL.Path)
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatalf("解析 multipart 失败：%v", err)
		}
		if r.FormValue("model") != "whisper-1" || r.FormValue("language") != "zh" {
			t.Fatalf("标准转写参数错误：model=%s language=%s", r.FormValue("model"), r.FormValue("language"))
		}
		_, _ = io.WriteString(w, `{"text":" 标准转写 "}`)
	}))
	defer server.Close()

	provider, err := New(Config{
		BaseURL:         server.URL,
		APIKey:          "test-key",
		ParseModel:      "parse-model",
		TranscribeModel: "whisper-1",
	})
	if err != nil {
		t.Fatalf("创建 Provider 失败：%v", err)
	}

	text, _, err := provider.Transcribe(context.Background(), ai.MediaInput{
		ContentType: "audio/wav",
		Data:        []byte("audio-bytes"),
	})
	if err != nil || text != "标准转写" {
		t.Fatalf("标准协议回归失败：text=%q err=%v", text, err)
	}
}

func TestProviderRejectsUnknownTranscribeProtocol(t *testing.T) {
	_, err := New(Config{
		BaseURL:            "https://ai.example.com",
		APIKey:             "test-key",
		ParseModel:         "parse-model",
		TranscribeProtocol: "unknown",
	})
	if err == nil {
		t.Fatal("未知语音转写协议必须拒绝启动")
	}
}
