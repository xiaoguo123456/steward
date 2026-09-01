// Package auth 负责签发与校验 Access Token，以及 Refresh Token 的哈希处理。
//
// Refresh Token 只以哈希形式落库：数据库泄漏时无法直接还原可用凭证。
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ErrInvalidToken 表示令牌不合法、已过期或签名不匹配。
var ErrInvalidToken = errors.New("令牌无效")

// TokenService 签发和校验令牌。
type TokenService struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
}

type accessClaims struct {
	SessionID string `json:"sid,omitempty"`
	jwt.RegisteredClaims
}

// NewTokenService 构造令牌服务。secret 必须由 API 与 Worker 共享。
func NewTokenService(secret string, accessTTL, refreshTTL time.Duration) *TokenService {
	return &TokenService{secret: []byte(secret), accessTTL: accessTTL, refreshTTL: refreshTTL}
}

// AccessTTL 返回 Access Token 有效期。
func (s *TokenService) AccessTTL() time.Duration { return s.accessTTL }

// RefreshTTL 返回 Refresh Token 有效期。
func (s *TokenService) RefreshTTL() time.Duration { return s.refreshTTL }

// DeriveDeletionStatusToken 从删除请求 ID 派生独立的高熵状态凭证。
//
// 数据库只保存其哈希；相同 request_id 可以在删除受理幂等重放时重新得到
// 完全相同的明文，避免把可直接使用的状态凭证另存一份密文。
func (s *TokenService) DeriveDeletionStatusToken(requestID string) string {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte("account-deletion-status:v1:" + requestID))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// DeriveDeletionReauthToken 从账号和幂等键派生单用途重新认证凭证。
//
// 这样网络丢包后的同键重放可以返回同一明文，而数据库仍只保存哈希；
// 幂等键不能跨账号复用，领域隔离字符串也避免与状态凭证混用。
func (s *TokenService) DeriveDeletionReauthToken(userID, idempotencyKey string) string {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte("account-deletion-reauth:v1:" + userID + ":" + idempotencyKey))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// DeriveDeletionUserFingerprint 生成只用于删除受理重放的不可逆账号指纹。
// 主用户记录物理删除后，状态镜像仍可据此精确恢复首次受理响应。
func (s *TokenService) DeriveDeletionUserFingerprint(userID string) []byte {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte("account-deletion-user-fingerprint:v1:" + userID))
	return mac.Sum(nil)
}

// DeriveChangePhoneRequestFingerprint 为换绑幂等比较生成带密钥指纹。
// 手机号与验证码都不能使用可离线枚举的普通哈希落库。
func (s *TokenService) DeriveChangePhoneRequestFingerprint(
	userID, newPhone, currentCode, newCode string,
) []byte {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte("change-phone-request:v1\x00" + userID + "\x00" +
		newPhone + "\x00" + currentCode + "\x00" + newCode))
	return mac.Sum(nil)
}

// IssueAccessToken 为用户签发 Access Token。
func (s *TokenService) IssueAccessToken(userID string, now time.Time) (string, time.Time, error) {
	return s.IssueAccessTokenForSession(userID, "", now)
}

// IssueAccessTokenForSession 签发绑定 Refresh Session 的 Access Token。
// sid 只保存服务端随机 ID，不包含 Refresh Token 本身。
func (s *TokenService) IssueAccessTokenForSession(userID, sessionID string, now time.Time) (string, time.Time, error) {
	expiresAt := now.Add(s.accessTTL)
	claims := accessClaims{
		SessionID: sessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject: userID, IssuedAt: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt), Issuer: "steward",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(s.secret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("签发令牌失败：%w", err)
	}
	return signed, expiresAt, nil
}

// ParseAccessToken 校验 Access Token 并返回其中的用户 ID。
func (s *TokenService) ParseAccessToken(raw string) (string, error) {
	userID, _, err := s.ParseAccessTokenWithSession(raw)
	return userID, err
}

// ParseAccessTokenWithSession 同时返回签发该 Access Token 的 Refresh Session ID。
// 旧版 Token 没有 sid 时 sessionID 为空，普通接口仍可使用；需要精确识别当前设备的
// 高风险操作必须拒绝空 sid 并要求重新登录或刷新。
func (s *TokenService) ParseAccessTokenWithSession(raw string) (userID, sessionID string, err error) {
	token, err := jwt.ParseWithClaims(raw, &accessClaims{},
		func(t *jwt.Token) (any, error) {
			// 只接受 HMAC，拒绝 alg=none 与非对称算法混淆攻击。
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("不支持的签名算法 %v", t.Header["alg"])
			}
			return s.secret, nil
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer("steward"),
	)
	if err != nil || !token.Valid {
		return "", "", ErrInvalidToken
	}
	claims, ok := token.Claims.(*accessClaims)
	if !ok || claims.Subject == "" {
		return "", "", ErrInvalidToken
	}
	return claims.Subject, claims.SessionID, nil
}

// GenerateRefreshToken 返回随机的 Refresh Token 明文及其哈希。
// 明文只返回给客户端一次，服务端只保存哈希。
func GenerateRefreshToken() (plain string, hash []byte, err error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", nil, fmt.Errorf("生成刷新令牌失败：%w", err)
	}
	plain = base64.RawURLEncoding.EncodeToString(buf)
	sum := HashToken(plain)
	return plain, sum, nil
}

// HashToken 计算令牌哈希。
func HashToken(plain string) []byte {
	sum := sha256.Sum256([]byte(plain))
	return sum[:]
}

// GenerateNumericCode 生成 n 位数字验证码，使用密码学随机源。
func GenerateNumericCode(n int) (string, error) {
	const digits = "0123456789"
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("生成验证码失败：%w", err)
	}
	out := make([]byte, n)
	for i, b := range buf {
		out[i] = digits[int(b)%len(digits)]
	}
	return string(out), nil
}

// CompareCode 以恒定时间比较验证码哈希，避免计时侧信道。
func CompareCode(stored []byte, candidate string) bool {
	sum := HashToken(candidate)
	return subtle.ConstantTimeCompare(stored, sum) == 1
}
