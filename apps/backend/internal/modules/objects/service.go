package objects

import (
	"context"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/aiaudit"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
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

// Service 是 Task、Event、Project 与 Note 的应用服务。
type Service struct {
	db       *database.DB
	lists    ListResolver
	users    UserProfile
	activity ActivityRecorder
	media    MediaResolver
	polisher ai.ChatProvider
	audit    *aiaudit.Recorder
}

// New 构造 Service。
func New(db *database.DB, lists ListResolver, users UserProfile, act ActivityRecorder, media MediaResolver) *Service {
	return &Service{db: db, lists: lists, users: users, activity: act, media: media}
}

// WithNotePolisher 注入显式的一键润色能力。Provider 为空时普通笔记 CRUD 仍可用。
func (s *Service) WithNotePolisher(chat ai.ChatProvider, audit *aiaudit.Recorder) *Service {
	s.polisher = chat
	s.audit = audit
	return s
}

// DB 暴露连接供同模块 Handler 使用。
func (s *Service) DB() *database.DB { return s.db }
