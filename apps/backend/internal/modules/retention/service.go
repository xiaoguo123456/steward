// Package retention 拥有账号删除受理、状态查询与物理清理。
package retention

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	authpkg "github.com/guoxiaozheng1/steward/apps/backend/internal/platform/auth"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/storage"
)

// JobEnqueuer 在受理事务内登记删除任务。
type JobEnqueuer interface {
	EnqueueAccountDeletion(ctx context.Context, q *dbgen.Queries, args AccountDeletionArgs) error
}

// AccountDeletionArgs 只携带不可反查身份的请求 ID。
type AccountDeletionArgs struct {
	RequestID string `json:"request_id"`
}

// Accepted 是账号删除受理结果。
type Accepted struct {
	RequestID       string
	StatusToken     string
	Status          string
	AcceptedAt      time.Time
	BackupExpiresAt time.Time
}

// Service 是账号删除应用服务。
type Service struct {
	db              *database.DB
	store           storage.ObjectStore
	tokens          *authpkg.TokenService
	jobs            JobEnqueuer
	backupRetention time.Duration
}

// New 构造 Service。
func New(db *database.DB, store storage.ObjectStore, tokens *authpkg.TokenService,
	jobs JobEnqueuer, backupRetention time.Duration) *Service {
	return &Service{db: db, store: store, tokens: tokens, jobs: jobs,
		backupRetention: backupRetention}
}

// Request 在一个用户事务中正式受理删除。
func (s *Service) Request(ctx context.Context, userID, reauthToken, idempotencyKey string,
	acknowledgement bool) (Accepted, error) {
	if !acknowledgement {
		return Accepted{}, apperr.Validation(apperr.Field(
			"acknowledgement", "请先确认已了解删除范围与不可恢复影响。"))
	}
	if idempotencyKey == "" {
		return Accepted{}, apperr.New(apperr.CodeIdempotencyKeyReq)
	}

	requestBody, _ := json.Marshal(struct {
		ReauthToken    string `json:"reauth_token"`
		Acknowledgment bool   `json:"acknowledgement"`
	}{reauthToken, acknowledgement})
	requestHash := authpkg.HashToken(string(requestBody))
	now := time.Now()
	replayUserHash := s.tokens.DeriveDeletionUserFingerprint(userID)
	idempotencyKeyHash := authpkg.HashToken(idempotencyKey)

	// 主用户记录可能已经被 Worker 物理删除。状态镜像只保留用途隔离的账号指纹
	// 和请求摘要，同键响应丢失时仍能恢复首次 request_id 与 status_token。
	if replayed, found, err := s.replayAccepted(ctx, replayUserHash, idempotencyKeyHash, requestHash); err != nil {
		return Accepted{}, err
	} else if found {
		return replayed, nil
	}

	var out Accepted
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if err := q.AcquireIdempotencyLock(ctx, "account-deletion.request:"+userID); err != nil {
			return apperr.Internal(err)
		}
		existing, err := q.GetAccountDeletionRequestByUser(ctx, userID)
		if err == nil {
			if existing.IdempotencyKey != idempotencyKey ||
				subtle.ConstantTimeCompare(existing.RequestHash, requestHash) != 1 {
				return apperr.New(apperr.CodeDeletionAlreadyReq)
			}
			out = s.accepted(existing.ID, existing.Status, existing.AcceptedAt,
				existing.BackupExpiresAt)
			return nil
		}
		if !database.IsNoRows(err) {
			return apperr.Internal(err)
		}

		user, err := q.GetUser(ctx, userID)
		if err != nil || user.AccountStatus != "active" {
			return apperr.New(apperr.CodeAccountNotActive)
		}

		reauth, err := q.GetAccountDeletionReauthTokenForUpdate(ctx, authpkg.HashToken(reauthToken))
		if err != nil || reauth.UserID != userID || reauth.ConsumedAt != nil {
			return apperr.New(apperr.CodeReauthTokenInvalid)
		}
		if now.After(reauth.ExpiresAt) {
			return apperr.New(apperr.CodeReauthTokenExpired)
		}

		requestID := idgen.New(idgen.PrefixDeletionRequest)
		backupExpiresAt := now.Add(s.backupRetention)
		statusToken := s.tokens.DeriveDeletionStatusToken(requestID)

		if err := q.ConsumeAccountDeletionReauthToken(ctx, reauth.ID); err != nil {
			return apperr.Internal(err)
		}
		created, err := q.CreateAccountDeletionRequest(ctx, dbgen.CreateAccountDeletionRequestParams{
			ID: requestID, UserID: userID, IdempotencyKey: idempotencyKey,
			RequestHash: requestHash, AcceptedAt: now, BackupExpiresAt: backupExpiresAt,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		if _, err := q.CreateAccountDeletionStatusRecord(ctx,
			dbgen.CreateAccountDeletionStatusRecordParams{
				RequestID: requestID, ReplayUserHash: replayUserHash,
				IdempotencyKeyHash: idempotencyKeyHash, RequestHash: requestHash,
				StatusTokenHash: authpkg.HashToken(statusToken),
				AcceptedAt:      now, BackupExpiresAt: backupExpiresAt,
			}); err != nil {
			return apperr.Internal(err)
		}
		if err := q.MarkUserDeletionPending(ctx, userID); err != nil {
			return apperr.Internal(err)
		}
		if err := q.RevokeAllRefreshTokens(ctx, userID); err != nil {
			return apperr.Internal(err)
		}
		if err := q.CancelUserOperationsForDeletion(ctx, userID); err != nil {
			return apperr.Internal(err)
		}
		if err := s.jobs.EnqueueAccountDeletion(ctx, q, AccountDeletionArgs{RequestID: requestID}); err != nil {
			return err
		}
		out = s.accepted(created.ID, created.Status, created.AcceptedAt,
			created.BackupExpiresAt)
		return nil
	})
	return out, err
}

func (s *Service) replayAccepted(
	ctx context.Context, replayUserHash, idempotencyKeyHash, requestHash []byte,
) (Accepted, bool, error) {
	var out Accepted
	found := false
	err := s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetAccountDeletionReplayByKey(ctx, dbgen.GetAccountDeletionReplayByKeyParams{
			ReplayUserHash: replayUserHash, IdempotencyKeyHash: idempotencyKeyHash,
		})
		if database.IsNoRows(err) {
			return nil
		}
		if err != nil {
			return apperr.Internal(err)
		}
		if subtle.ConstantTimeCompare(row.RequestHash, requestHash) != 1 {
			return apperr.New(apperr.CodeDeletionAlreadyReq)
		}
		out = s.accepted(row.RequestID, row.Status, row.AcceptedAt, row.BackupExpiresAt)
		found = true
		return nil
	})
	return out, found, err
}

func (s *Service) accepted(requestID, status string, acceptedAt, backupExpiresAt time.Time) Accepted {
	return Accepted{RequestID: requestID,
		StatusToken: s.tokens.DeriveDeletionStatusToken(requestID), Status: status,
		AcceptedAt: acceptedAt, BackupExpiresAt: backupExpiresAt}
}

// Status 使用独立凭证读取不含身份信息的状态镜像。
func (s *Service) Status(ctx context.Context, requestID, statusToken string) (dbgen.AccountDeletionStatusRecord, error) {
	var out dbgen.AccountDeletionStatusRecord
	err := s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetAccountDeletionStatusByToken(ctx,
			dbgen.GetAccountDeletionStatusByTokenParams{
				RequestID: requestID, StatusTokenHash: authpkg.HashToken(statusToken),
			})
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.New(apperr.CodeDeletionStatusInvalid)
			}
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// RunDeletion 清理对象存储、派生数据与在线主库。重复执行是安全的。
func (s *Service) RunDeletion(ctx context.Context, requestID string) error {
	if err := s.setStatus(ctx, requestID, "revoking_sessions", nil); err != nil {
		return err
	}
	keys, err := s.mediaKeys(ctx, requestID)
	if err != nil {
		return err
	}
	if err := s.setStatus(ctx, requestID, "purging_assets", nil); err != nil {
		return err
	}
	for _, key := range keys {
		if err := s.store.Delete(ctx, key); err != nil && !errors.Is(err, storage.ErrNotFound) {
			return fmt.Errorf("清理账号媒体对象失败：%w", err)
		}
	}
	if err := s.setStatus(ctx, requestID, "purging_derivatives", nil); err != nil {
		return err
	}
	if err := s.setStatus(ctx, requestID, "purging_primary", nil); err != nil {
		return err
	}
	if err := s.purgePrimary(ctx, requestID); err != nil {
		return err
	}
	return s.setStatus(ctx, requestID, "completed", nil)
}

// MarkFailed 仅在 River 已耗尽重试次数时公开失败状态。
func (s *Service) MarkFailed(ctx context.Context, requestID string) error {
	message := "删除处理暂时未完成，我们会保留状态并继续人工核查。"
	return s.setStatus(ctx, requestID, "failed", &message)
}

func (s *Service) setStatus(ctx context.Context, requestID, status string, publicError *string) error {
	return s.db.InTxAnonymous(ctx, func(ctx context.Context, q *dbgen.Queries) error {
		if err := q.UpdateAccountDeletionStatus(ctx, dbgen.UpdateAccountDeletionStatusParams{
			RequestID: requestID, Status: status, PublicError: publicError,
		}); err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
}

func (s *Service) mediaKeys(ctx context.Context, requestID string) ([]string, error) {
	var keys []string
	err := s.withAnonymousTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT object_key FROM account_deletion_worker_media_keys($1)`, requestID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var key string
			if err := rows.Scan(&key); err != nil {
				return err
			}
			keys = append(keys, key)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return keys, nil
}

func (s *Service) purgePrimary(ctx context.Context, requestID string) error {
	return s.withAnonymousTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var purged bool
		if err := tx.QueryRow(ctx,
			`SELECT account_deletion_worker_purge_primary($1)`, requestID).Scan(&purged); err != nil {
			return err
		}
		// 请求已在此前重试中清理时，状态镜像仍可直接推进到 completed。
		return nil
	})
}

func (s *Service) withAnonymousTx(ctx context.Context, fn func(context.Context, pgx.Tx) error) error {
	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(ctx, tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
