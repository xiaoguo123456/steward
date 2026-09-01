package objects

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/aiaudit"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	authpkg "github.com/guoxiaozheng1/steward/apps/backend/internal/platform/auth"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// ListResolver 是 lists 模块公开的最小能力：校验清单归属并回退到默认清单。
// objects 不直接访问 task_lists 表。
type ListResolver interface {
	ResolveListID(ctx context.Context, q *dbgen.Queries, userID string, listID *string) (string, error)
}

// UserProfile 是 users 模块公开的最小能力：读取用户时区。
// 时间语义依赖时区，因此这是 objects 唯一需要的用户信息。
type UserProfile interface {
	Timezone(ctx context.Context, q *dbgen.Queries, userID string) (string, error)
	AiSettings(ctx context.Context, userID string) (dbgen.UserAiSetting, error)
}

// ActivityRecorder 是 activity 模块公开的写入能力。
type ActivityRecorder interface {
	Record(ctx context.Context, q *dbgen.Queries, userID string,
		source activity.Source, sourceID *string, entries []activity.EntryInput) (string, error)
}

// MediaResolver 是 media 模块公开的最小能力：校验行程票据图片的归属与上传状态。
// objects 只保存媒体 ID，不接触对象存储地址。
type MediaResolver interface {
	ValidateImageReferences(ctx context.Context, q *dbgen.Queries, userID string, mediaIDs []string) error
}

// PersonLinker 是 relationships 模块公开的最小能力：校验人物归属并关联 Task。
type PersonLinker interface {
	LinkTask(ctx context.Context, q *dbgen.Queries, userID, taskID, personID string) error
}

// Service 是 Task、Event、Project 与 Note 的应用服务。
type Service struct {
	db       *database.DB
	lists    ListResolver
	users    UserProfile
	activity ActivityRecorder
	media    MediaResolver
	people   PersonLinker
	polisher ai.ChatProvider
	audit    *aiaudit.Recorder
}

// New 构造 Service。
func New(db *database.DB, lists ListResolver, users UserProfile, act ActivityRecorder, media MediaResolver) *Service {
	return &Service{db: db, lists: lists, users: users, activity: act, media: media}
}

// WithPersonLinker 注入亲友关联能力；启动组装完成后再处理请求。
func (s *Service) WithPersonLinker(linker PersonLinker) *Service {
	s.people = linker
	return s
}

// WithNotePolisher 注入显式的一键润色能力。Provider 为空时普通笔记 CRUD 仍可用。
func (s *Service) WithNotePolisher(chat ai.ChatProvider, audit *aiaudit.Recorder) *Service {
	s.polisher = chat
	s.audit = audit
	return s
}

// DB 暴露连接供同模块 Handler 使用。
func (s *Service) DB() *database.DB { return s.db }

const objectIdempotencyTTL = 24 * time.Hour

// beginObjectReplay 在业务事务内串行化相同幂等键，并返回首次响应快照。
// request 必须只包含稳定的契约字段；Token、验证码等秘密不能传入这里。
func beginObjectReplay(ctx context.Context, q *dbgen.Queries, userID, endpoint string,
	request any) (responseBody []byte, replayed bool, requestHash []byte, err error) {
	key := httpx.IdempotencyKey(ctx)
	if key == "" {
		return nil, false, nil, nil
	}
	body, err := json.Marshal(request)
	if err != nil {
		return nil, false, nil, apperr.Internal(err)
	}
	requestHash = authHash(body)
	if err := q.AcquireIdempotencyLock(ctx, endpoint+":"+userID+":"+key); err != nil {
		return nil, false, nil, apperr.Internal(err)
	}
	record, err := q.GetIdempotencyRecord(ctx, dbgen.GetIdempotencyRecordParams{
		UserID: userID, Endpoint: endpoint, Key: key,
	})
	if database.IsNoRows(err) {
		return nil, false, requestHash, nil
	}
	if err != nil {
		return nil, false, nil, apperr.Internal(err)
	}
	if subtle.ConstantTimeCompare(record.RequestHash, requestHash) != 1 {
		return nil, false, nil, apperr.New(apperr.CodeIdempotencyReused)
	}
	if len(record.ResponseBody) == 0 {
		return nil, false, nil, apperr.Internal(errors.New("幂等记录缺少响应快照"))
	}
	return record.ResponseBody, true, requestHash, nil
}

func saveObjectReplay(ctx context.Context, q *dbgen.Queries, userID, endpoint string,
	requestHash []byte, status int32, resourceID string, response any) error {
	key := httpx.IdempotencyKey(ctx)
	if key == "" {
		return nil
	}
	snapshot, err := json.Marshal(response)
	if err != nil {
		return apperr.Internal(err)
	}
	if err := q.SaveIdempotencyRecord(ctx, dbgen.SaveIdempotencyRecordParams{
		UserID: userID, Endpoint: endpoint, Key: key, RequestHash: requestHash,
		StatusCode: status, ResponseBody: snapshot, ResourceID: &resourceID,
		ExpiresAt: time.Now().Add(objectIdempotencyTTL),
	}); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

func authHash(value []byte) []byte {
	// idempotency_keys 只需要不可逆且稳定的请求摘要，不包含秘密字段。
	// 复用平台 Token 哈希的 SHA-256 实现，避免维护第二套摘要算法。
	return authpkg.HashToken(string(value))
}
