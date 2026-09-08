// Package auth 是后台的登录、会话与 CSRF。
//
// 仅复用短信 Provider；管理员名单、验证码用途和服务端会话与 App 身份独立。
// 两套鉴权的威胁模型不同，混用会让「改一处会不会影响另一处」变得说不清。
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Argon2id 参数。
//
// 取值参照 OWASP 的口令存储建议（内存 19MiB、迭代 2、并行 1）。
// 这套参数在普通服务器上单次校验约几十毫秒——**慢是特性不是缺陷**：
// 它让离线爆破的成本和在线登录的体验之间有个可接受的比值。
const (
	argonTime    = 2
	argonMemory  = 19 * 1024 // KiB
	argonThreads = 1
	argonKeyLen  = 32
	argonSaltLen = 16
)

// HashPassword 生成 Argon2id 散列，格式与 PHC 字符串一致。
//
// 首次设密、密码重设及命令行工具共用同一散列实现。
func HashPassword(password string) (string, error) {
	if strings.TrimSpace(password) == "" {
		return "", errors.New("口令不能为空")
	}
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

// VerifyPassword 校验口令。
//
// **散列不合法时返回 false 而不是错误**，并且仍然走完一次完整的
// Argon2 计算：否则「配置里的散列坏了」和「口令不对」会有可观测的
// 时间差，而前者恰恰是攻击者最想知道的信息。
func VerifyPassword(password, encoded string) bool {
	params, salt, want, err := parseArgon2id(encoded)
	if err != nil {
		// 用一组固定参数做一次等价计算，保持时间特征稳定。
		_ = argon2.IDKey([]byte(password), make([]byte, argonSaltLen),
			argonTime, argonMemory, argonThreads, argonKeyLen)
		return false
	}
	got := argon2.IDKey([]byte(password), salt, params.time, params.memory, params.threads, uint32(len(want)))
	// 定长比较：普通的 bytes.Equal 会在第一个不同的字节处返回，
	// 逐字节地泄漏正确前缀的长度。
	return subtle.ConstantTimeCompare(got, want) == 1
}

type argon2Params struct {
	memory  uint32
	time    uint32
	threads uint8
}

func parseArgon2id(encoded string) (argon2Params, []byte, []byte, error) {
	parts := strings.Split(encoded, "$")
	// 形如 ["", "argon2id", "v=19", "m=...,t=...,p=...", salt, hash]
	if len(parts) != 6 || parts[1] != "argon2id" {
		return argon2Params{}, nil, nil, errors.New("不是 Argon2id 散列")
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return argon2Params{}, nil, nil, err
	}
	if version != argon2.Version {
		return argon2Params{}, nil, nil, errors.New("Argon2 版本不匹配")
	}

	var p argon2Params
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.memory, &p.time, &p.threads); err != nil {
		return argon2Params{}, nil, nil, err
	}
	if p.memory == 0 || p.time == 0 || p.threads == 0 {
		return argon2Params{}, nil, nil, errors.New("Argon2 参数不合法")
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return argon2Params{}, nil, nil, err
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return argon2Params{}, nil, nil, err
	}
	if len(salt) == 0 || len(key) == 0 {
		return argon2Params{}, nil, nil, errors.New("Argon2 散列为空")
	}
	return p, salt, key, nil
}
