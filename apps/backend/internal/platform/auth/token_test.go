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
