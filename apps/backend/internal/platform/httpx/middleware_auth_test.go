package httpx

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/auth"
)

func TestAccountDeletionStatusIsPublicButOrdinaryUserRoutesCheckLiveState(t *testing.T) {
	tokens := auth.NewTokenService("test-account-deletion-secret-at-least-32-bytes", time.Hour, 24*time.Hour)
	access, _, err := tokens.IssueAccessToken("usr_test", time.Now())
	if err != nil {
		t.Fatal(err)
	}

	checkerCalls := 0
	checker := func(context.Context, string) (bool, error) {
		checkerCalls++
		return false, nil
	}
	handler := AuthMiddleware(tokens, checker)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/account-deletions/del_test" {
			if userID, err := UserID(r.Context()); err != nil || userID != "usr_test" {
				t.Fatalf("Handler 没有收到已验证用户：%q, %v", userID, err)
			}
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	publicRequest := httptest.NewRequest(http.MethodGet, "/v1/account-deletions/del_test", nil)
	publicResponse := httptest.NewRecorder()
	handler.ServeHTTP(publicResponse, publicRequest)
	if publicResponse.Code != http.StatusNoContent || checkerCalls != 0 {
		t.Fatalf("删除状态查询不应要求普通会话：status=%d calls=%d",
			publicResponse.Code, checkerCalls)
	}

	ordinaryRequest := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
	ordinaryRequest.Header.Set("Authorization", "Bearer "+access)
	ordinaryResponse := httptest.NewRecorder()
	handler.ServeHTTP(ordinaryResponse, ordinaryRequest)
	if ordinaryResponse.Code != http.StatusUnauthorized ||
		!strings.Contains(ordinaryResponse.Body.String(), "ACCOUNT_NOT_ACTIVE") {
		t.Fatalf("非 active 账号仍访问了普通接口：status=%d body=%s",
			ordinaryResponse.Code, ordinaryResponse.Body.String())
	}
	if checkerCalls != 1 {
		t.Fatalf("普通接口应检查实时账号状态，实际 %d 次", checkerCalls)
	}
}

func TestAccountDeletionReplayBypassesOnlyLiveStateAndStillRequiresJWT(t *testing.T) {
	tokens := auth.NewTokenService("test-account-deletion-secret-at-least-32-bytes", time.Hour, 24*time.Hour)
	access, _, err := tokens.IssueAccessToken("usr_test", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	checkerCalls := 0
	handler := AuthMiddleware(tokens, func(context.Context, string) (bool, error) {
		checkerCalls++
		return false, nil
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, err := UserID(r.Context())
		if err != nil || userID != "usr_test" {
			t.Fatalf("重放请求没有保留 JWT 身份：%q, %v", userID, err)
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	withoutToken := httptest.NewRequest(http.MethodPost, "/v1/me/account-deletion", nil)
	withoutTokenResponse := httptest.NewRecorder()
	handler.ServeHTTP(withoutTokenResponse, withoutToken)
	if withoutTokenResponse.Code != http.StatusUnauthorized {
		t.Fatalf("删除重放缺少 JWT 时没有拒绝：%d", withoutTokenResponse.Code)
	}

	withToken := httptest.NewRequest(http.MethodPost, "/v1/me/account-deletion", nil)
	withToken.Header.Set("Authorization", "Bearer "+access)
	withTokenResponse := httptest.NewRecorder()
	handler.ServeHTTP(withTokenResponse, withToken)
	if withTokenResponse.Code != http.StatusNoContent {
		t.Fatalf("有效旧 JWT 的精确重放路径被拒绝：%d", withTokenResponse.Code)
	}
	if checkerCalls != 0 {
		t.Fatalf("精确重放路径不应经过 active 检查，实际 %d 次", checkerCalls)
	}
}
