package auth

import (
	"strings"
	"testing"
	"time"
)

// 口令散列的测试。
//
// 后台是全站权限最高的入口，这几条守的是「拿到数据库也换不出口令」
// 和「猜口令的成本足够高」。

func TestHashAndVerify(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("生成散列失败：%v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Errorf("散列格式不对：%s", hash)
	}
	if !VerifyPassword("correct horse battery staple", hash) {
		t.Error("正确口令应当通过")
	}
	if VerifyPassword("wrong password", hash) {
		t.Error("错误口令不该通过")
	}
}

// 同一个口令每次生成的散列都不同——盐是随机的。
//
// 否则相同口令会有相同散列，一张彩虹表就能同时打穿所有用相同口令的账号。
func TestHashUsesRandomSalt(t *testing.T) {
	first, _ := HashPassword("same-password-12345")
	second, _ := HashPassword("same-password-12345")
	if first == second {
		t.Error("两次散列不该相同，说明盐没有随机")
	}
	// 但两个都要能验通过。
	if !VerifyPassword("same-password-12345", first) || !VerifyPassword("same-password-12345", second) {
		t.Error("随机盐不该影响校验")
	}
}

func TestHashRejectsEmpty(t *testing.T) {
	if _, err := HashPassword("   "); err == nil {
		t.Error("空口令应当被拒")
	}
}

// 散列损坏时返回 false 而不是 panic，也不能返回 true。
func TestVerifyRejectsMalformedHash(t *testing.T) {
	cases := []string{
		"", "plaintext-password", "$argon2i$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA",
		"$argon2id$v=19$m=0,t=0,p=0$c2FsdA$aGFzaA",
		"$argon2id$v=19$m=19456,t=2,p=1$不是base64$aGFzaA",
		"$argon2id$broken",
	}
	for _, encoded := range cases {
		if VerifyPassword("anything", encoded) {
			t.Errorf("损坏的散列不该通过：%q", encoded)
		}
	}
}

// 配置里放明文口令时必须验不过。
//
// 这是防呆：有人图省事把明文填进 STEWARD_ADMIN_PASSWORD_HASH，
// 如果这里「刚好」能匹配上，那道 Argon2id 就形同虚设。
// 配置加载那一层也会拦（要求 $argon2id$ 前缀），这里是第二道。
func TestVerifyNeverMatchesPlaintext(t *testing.T) {
	if VerifyPassword("hunter2", "hunter2") {
		t.Error("明文当散列用绝不能通过")
	}
}

// 校验耗时要足够长，否则离线爆破的成本就没有意义。
//
// 只测下限不测上限：机器有快有慢，但「快到不可能算过 Argon2」
// 一定说明参数被调没了或者走了短路分支。
func TestVerifyIsDeliberatelySlow(t *testing.T) {
	hash, _ := HashPassword("benchmark-password-1")
	start := time.Now()
	VerifyPassword("benchmark-password-1", hash)
	elapsed := time.Since(start)
	if elapsed < 5*time.Millisecond {
		t.Errorf("校验只用了 %v，Argon2 参数可能被调得太低", elapsed)
	}
}

// 散列损坏时**也要**走完一次等价计算。
//
// 否则「配置里的散列坏了」和「口令不对」会有可观测的时间差，
// 而前者恰恰是攻击者最想先确认的事。
func TestVerifyKeepsTimingStableOnMalformedHash(t *testing.T) {
	start := time.Now()
	VerifyPassword("some-password", "totally-not-a-hash")
	elapsed := time.Since(start)
	if elapsed < 5*time.Millisecond {
		t.Errorf("散列损坏时只用了 %v，说明提前返回了，会泄漏配置状态", elapsed)
	}
}
