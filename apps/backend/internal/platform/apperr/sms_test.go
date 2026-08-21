package apperr

import (
	"net/http"
	"testing"
)

func TestSMSProviderUnavailable(t *testing.T) {
	err := New(CodeSMSProviderUnavailable)
	if err.HTTPStatus() != http.StatusServiceUnavailable {
		t.Fatalf("期望 HTTP 503，实际为 %d", err.HTTPStatus())
	}
	if !err.Retryable() {
		t.Fatal("短信 Provider 暂时不可用应允许重试")
	}
	if err.Message == "" {
		t.Fatal("必须提供面向用户的中文提示")
	}
}
