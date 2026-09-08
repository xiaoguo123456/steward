package auth

import (
	"context"
	"crypto/hmac"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	platformauth "github.com/guoxiaozheng1/steward/apps/backend/internal/platform/auth"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

var (
	adminPhonePattern = regexp.MustCompile(`^1[3-9][0-9]{9}$`)
	adminCodePattern  = regexp.MustCompile(`^[0-9]{6}$`)
	ErrPasswordSetup  = errors.New("请设置首次登录密码")
	ErrCodeInvalid    = errors.New("验证码错误或已失效，请重新获取")
	ErrSMSUnavailable = errors.New("短信暂时无法发送，请稍后重试")
	ErrInputInvalid   = errors.New("请检查手机号、验证码和密码格式")
)

// CodeSender 仅复用短信传输能力，不复用 App 验证码或身份。
type CodeSender interface {
	SendCode(context.Context, string, string, string) error
}

func (s *Service) SetCodeSender(sender CodeSender) { s.sender = sender }

type loginCredentials struct {
	Phone, Method, Password, ChallengeID, Code, NewPassword string
}

func validNewPassword(password string) bool {
	n := utf8.RuneCountInString(password)
	return n >= 12 && n <= 128 && strings.TrimSpace(password) != ""
}

func (s *Service) requestCode(ctx context.Context, phone, purpose string) (string, error) {
	if !adminPhonePattern.MatchString(phone) || (purpose != "login" && purpose != "password_reset") {
		return "", ErrInputInvalid
	}
	id, err := randomToken()
	if err != nil {
		return "", err
	}
	code := s.cfg.DevSMSCode
	if s.cfg.Environment == "production" {
		code = ""
	}
	if code == "" {
		if s.sender == nil {
			return "", ErrSMSUnavailable
		}
		code, err = platformauth.GenerateNumericCode(6)
		if err != nil {
			return "", err
		}
	}
	authorized := false
	err = s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		account, err := q.FindAdminAccountByPhone(ctx, phone)
		if database.IsNoRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if !account.Enabled {
			return nil
		}
		counts, err := q.AdminCodeSendCounts(ctx, account.ID)
		if err != nil {
			return err
		}
		// 已授权和未授权号码对外均返回统一提示，不泄露管理员名单。
		if counts.Recent > 0 || counts.Hourly >= 5 || counts.Daily >= 10 {
			return nil
		}
		if err = q.InvalidateAdminPhoneChallenges(ctx, account.ID); err != nil {
			return err
		}
		if err = q.CreateAdminPhoneChallenge(ctx, dbgen.CreateAdminPhoneChallengeParams{ID: id, AdminID: account.ID, Purpose: purpose, CodeHash: s.hashToken("admin-code:" + id + ":" + code), ExpiresAt: time.Now().Add(5 * time.Minute)}); err != nil {
			return err
		}
		authorized = true
		return q.PurgeAdminPhoneChallenges(ctx)
	})
	if err != nil {
		return "", err
	}
	if !authorized {
		return id, nil
	}
	if s.cfg.Environment == "production" || s.cfg.DevSMSCode == "" {
		if err = s.sender.SendCode(ctx, phone, code, "admin_"+purpose); err != nil {
			cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
			defer cancel()
			_ = s.db.InTxAnonymous(cleanup, func(ctx context.Context, q *dbgen.Queries) error { return q.ConsumeAdminPhoneChallenge(ctx, id) })
			return "", ErrSMSUnavailable
		}
	}
	err = s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error { return q.MarkAdminPhoneChallengeSent(ctx, id) })
	return id, err
}

// checkCode 的业务拒绝单独返回，调用方提交失败计数，不能随事务回滚。
func (s *Service) checkCode(ctx context.Context, q *dbgen.Queries, accountID, purpose, id, code string) (error, error) {
	if !adminCodePattern.MatchString(code) || len(id) > 64 {
		return ErrCodeInvalid, nil
	}
	record, err := q.FindAdminPhoneChallenge(ctx, dbgen.FindAdminPhoneChallengeParams{ID: id, AdminID: accountID, Purpose: purpose})
	if database.IsNoRows(err) {
		return ErrCodeInvalid, nil
	}
	if err != nil {
		return nil, err
	}
	if record.ConsumedAt != nil || record.SentAt == nil || time.Now().After(record.ExpiresAt) || record.Attempts >= 5 {
		return ErrCodeInvalid, nil
	}
	if !hmac.Equal(record.CodeHash, s.hashToken("admin-code:"+id+":"+code)) {
		return ErrCodeInvalid, q.FailAdminPhoneChallengeAttempt(ctx, id)
	}
	return nil, nil
}

func (s *Service) authenticate(ctx context.Context, input loginCredentials, userAgent string, ipHash []byte) (string, Session, error) {
	if !adminPhonePattern.MatchString(input.Phone) || utf8.RuneCountInString(input.Password) > 128 || (input.Method != "password" && input.Method != "sms") {
		return "", Session{}, ErrInvalidLogin
	}
	passwordHash := ""
	if input.NewPassword != "" {
		if !validNewPassword(input.NewPassword) {
			return "", Session{}, ErrInputInvalid
		}
		var err error
		passwordHash, err = HashPassword(input.NewPassword)
		if err != nil {
			return "", Session{}, err
		}
	}
	var token string
	var session Session
	var rejected error
	err := s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		account, err := q.FindAdminAccountByPhone(ctx, input.Phone)
		if database.IsNoRows(err) {
			if input.Method == "password" {
				VerifyPassword(input.Password, "")
			}
			rejected = ErrInvalidLogin
			if input.Method == "sms" {
				rejected = ErrCodeInvalid
			}
			return nil
		}
		if err != nil {
			return err
		}
		if input.Method == "password" {
			hash := ""
			if account.PasswordHash != nil {
				hash = *account.PasswordHash
			}
			passOK := VerifyPassword(input.Password, hash)
			if !account.Enabled || !passOK {
				rejected = ErrInvalidLogin
				return nil
			}
		} else {
			if !account.Enabled {
				rejected = ErrCodeInvalid
				return nil
			}
			rejected, err = s.checkCode(ctx, q, account.ID, "login", input.ChallengeID, input.Code)
			if err != nil || rejected != nil {
				return err
			}
			if account.PasswordHash == nil && passwordHash == "" {
				rejected = ErrPasswordSetup
				return nil
			}
			if account.PasswordHash != nil && passwordHash != "" {
				rejected = ErrInputInvalid
				return nil
			}
			if account.PasswordHash == nil {
				account, err = q.UpdateAdminPassword(ctx, dbgen.UpdateAdminPasswordParams{ID: account.ID, PasswordHash: &passwordHash})
				if err != nil {
					return err
				}
				if err = recordCredentialAudit(ctx, q, account.ID, "admin_password_set"); err != nil {
					return err
				}
			}
			if err = q.ConsumeAdminPhoneChallenge(ctx, input.ChallengeID); err != nil {
				return err
			}
		}
		token, session, err = s.createSession(ctx, q, account, userAgent, ipHash)
		return err
	})
	if err != nil {
		return "", Session{}, err
	}
	if rejected != nil {
		return "", Session{}, rejected
	}
	return token, session, nil
}

func (s *Service) resetPassword(ctx context.Context, phone, id, code, password string) error {
	if !adminPhonePattern.MatchString(phone) || !validNewPassword(password) {
		return ErrInputInvalid
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	var rejected error
	err = s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		account, err := q.FindAdminAccountByPhone(ctx, phone)
		if database.IsNoRows(err) {
			rejected = ErrCodeInvalid
			return nil
		}
		if err != nil {
			return err
		}
		if !account.Enabled {
			rejected = ErrCodeInvalid
			return nil
		}
		rejected, err = s.checkCode(ctx, q, account.ID, "password_reset", id, code)
		if err != nil || rejected != nil {
			return err
		}
		if _, err = q.UpdateAdminPassword(ctx, dbgen.UpdateAdminPasswordParams{ID: account.ID, PasswordHash: &hash}); err != nil {
			return err
		}
		if err = q.InvalidateAdminPhoneChallenges(ctx, account.ID); err != nil {
			return err
		}
		if err = q.RevokeAccountAdminSessions(ctx, &account.ID); err != nil {
			return err
		}
		return recordCredentialAudit(ctx, q, account.ID, "admin_password_reset")
	})
	if err != nil {
		return err
	}
	return rejected
}

// 只记录稳定身份与动作，不保存号码、口令、验证码或请求正文。
func recordCredentialAudit(ctx context.Context, q *dbgen.Queries, accountID, action string) error {
	_, err := q.RecordAdminAudit(ctx, dbgen.RecordAdminAuditParams{ID: idgen.New(idgen.PrefixAdminAudit), OccurredAt: time.Now(), ActorUsername: accountID, Action: action, Outcome: "succeeded", RequestID: httpx.RequestID(ctx)})
	return err
}
