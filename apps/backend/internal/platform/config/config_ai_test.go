package config

import (
	"strings"
	"testing"
)

func TestAIConfigValidateFakeEnvironmentGate(t *testing.T) {
	for _, environment := range []string{"development", "test"} {
		if err := (AIConfig{Provider: "fake"}).validate(environment); err != nil {
			t.Fatalf("%s 环境应允许显式 fake Provider：%v", environment, err)
		}
	}

	err := (AIConfig{Provider: "fake"}).validate("production")
	if err == nil || !strings.Contains(err.Error(), "生产环境禁止") {
		t.Fatalf("生产环境必须拒绝 fake Provider，实际为：%v", err)
	}

	// 未设置 Provider 会走本地默认 fake，同样不能在生产环境静默启动。
	if err := (AIConfig{}).validate("production"); err == nil {
		t.Fatal("生产环境未显式配置真实 AI Provider 时必须启动失败")
	}
}

func TestDefaultAIEngine(t *testing.T) {
	if got := defaultAIEngine("test"); got != "eino" {
		t.Fatalf("测试环境应默认灰度 Eino，实际 %q", got)
	}
	for _, environment := range []string{"development", "production"} {
		if got := defaultAIEngine(environment); got != "direct" {
			t.Fatalf("%s 环境应默认 DirectEngine，实际 %q", environment, got)
		}
	}
}

func TestAIConfigValidateOpenAI(t *testing.T) {
	valid := AIConfig{
		Provider:           "openai",
		Engine:             "eino",
		APIKey:             "test-key",
		BaseURL:            "https://ai.example.com",
		ModelParse:         "parse-model",
		ThinkingMode:       "disabled",
		TranscribeProtocol: "chat-completions",
		ModelTranscribe:    "qwen3-asr-flash",
	}
	if err := valid.validate("production"); err != nil {
		t.Fatalf("生产环境完整 OpenAI 配置应当有效：%v", err)
	}

	invalid := valid
	invalid.ModelParse = ""
	if err := invalid.validate("production"); err == nil {
		t.Fatal("缺少解析模型时必须启动失败")
	}

	invalid = valid
	invalid.TranscribeProtocol = "unknown"
	if err := invalid.validate("production"); err == nil {
		t.Fatal("未知语音转写协议必须启动失败")
	}

	invalid = valid
	invalid.ThinkingMode = "slow"
	if err := invalid.validate("production"); err == nil {
		t.Fatal("未知思考模式必须启动失败")
	}

	invalid = valid
	invalid.Engine = "multi-agent"
	if err := invalid.validate("production"); err == nil {
		t.Fatal("未知编排引擎必须启动失败")
	}
}
