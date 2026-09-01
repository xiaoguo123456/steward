package auth

import (
	"testing"
	"time"
)

func TestDeletionTokensAreDeterministicAndDomainSeparated(t *testing.T) {
	tokens := NewTokenService("test-account-deletion-secret-at-least-32-bytes", time.Hour, 24*time.Hour)
	statusA := tokens.DeriveDeletionStatusToken("del_1")
	statusReplay := tokens.DeriveDeletionStatusToken("del_1")
	statusB := tokens.DeriveDeletionStatusToken("del_2")
	reauth := tokens.DeriveDeletionReauthToken("usr_1", "key_1")

	if statusA == "" || statusA != statusReplay {
		t.Fatal("状态凭证必须可稳定派生，才能安全幂等重放")
	}
	if statusA == statusB || statusA == reauth {
		t.Fatal("不同请求和不同用途不能派生相同凭证")
	}
	if reauth == tokens.DeriveDeletionReauthToken("usr_2", "key_1") ||
		reauth == tokens.DeriveDeletionReauthToken("usr_1", "key_2") {
		t.Fatal("重新认证凭证必须同时绑定账号与幂等键")
	}
	if string(tokens.DeriveDeletionUserFingerprint("usr_1")) ==
		string(tokens.DeriveDeletionUserFingerprint("usr_2")) {
		t.Fatal("删除重放账号指纹必须按账号隔离")
	}
}

func TestAccessTokenCarriesSessionID(t *testing.T) {
	tokens := NewTokenService("test-access-session-secret-at-least-32-bytes", time.Hour, 24*time.Hour)
	raw, _, err := tokens.IssueAccessTokenForSession("usr_session", "rt_session", time.Now())
	if err != nil {
		t.Fatalf("签发带会话 Access Token 失败：%v", err)
	}
	userID, sessionID, err := tokens.ParseAccessTokenWithSession(raw)
	if err != nil {
		t.Fatalf("解析带会话 Access Token 失败：%v", err)
	}
	if userID != "usr_session" || sessionID != "rt_session" {
		t.Fatalf("Access Token 会话绑定错误：user=%s session=%s", userID, sessionID)
	}

	legacy, _, err := tokens.IssueAccessToken("usr_legacy", time.Now())
	if err != nil {
		t.Fatalf("签发兼容 Access Token 失败：%v", err)
	}
	userID, sessionID, err = tokens.ParseAccessTokenWithSession(legacy)
	if err != nil || userID != "usr_legacy" || sessionID != "" {
		t.Fatalf("旧版无 sid Access Token 兼容失败：user=%s session=%s err=%v", userID, sessionID, err)
	}
}

func TestChangePhoneRequestFingerprintIsStableAndScoped(t *testing.T) {
	tokens := NewTokenService("test-change-phone-secret-at-least-32-bytes", time.Hour, 24*time.Hour)
	first := tokens.DeriveChangePhoneRequestFingerprint("usr_1", "13800138001", "123456", "654321")
	replay := tokens.DeriveChangePhoneRequestFingerprint("usr_1", "13800138001", "123456", "654321")
	changed := tokens.DeriveChangePhoneRequestFingerprint("usr_1", "13800138002", "123456", "654321")
	otherUser := tokens.DeriveChangePhoneRequestFingerprint("usr_2", "13800138001", "123456", "654321")
	if string(first) != string(replay) {
		t.Fatal("相同换绑请求必须产生稳定指纹")
	}
	if string(first) == string(changed) || string(first) == string(otherUser) {
		t.Fatal("换绑请求指纹必须绑定账号和请求内容")
	}
}
