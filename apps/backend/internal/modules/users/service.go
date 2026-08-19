// Package users 拥有用户资料、显式偏好与 AI 开关。
//
// 显式设置优先于任何学习到的偏好：两者表达同一语义时以这里的值为准。
package users

import (
	"context"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// DefaultListEnsurer 是 lists 模块公开的能力，用于初始化默认清单。
type DefaultListEnsurer interface {
	EnsureDefaultList(ctx context.Context, q *dbgen.Queries, userID string) (dbgen.TaskList, error)
}

// Service 是用户模块的应用服务。
type Service struct {
	db    *database.DB
	lists DefaultListEnsurer
}

// New 构造 Service。
func New(db *database.DB, lists DefaultListEnsurer) *Service {
	return &Service{db: db, lists: lists}
}

// Timezone 返回用户时区，实现 objects.UserProfile。
// 时区是全部日期语义的基准，因此调用方必须在同一事务内获取。
func (s *Service) Timezone(ctx context.Context, q *dbgen.Queries, userID string) (string, error) {
	row, err := q.GetUser(ctx, userID)
	if err != nil {
		if database.IsNoRows(err) {
			return "", apperr.New(apperr.CodeUnauthenticated)
		}
		return "", apperr.Internal(err)
	}
	if strings.TrimSpace(row.Timezone) == "" {
		return timeutil.DefaultTimezone, nil
	}
	return row.Timezone, nil
}

// EnsureDefaults 补齐用户的偏好、AI 设置与默认清单。
// 登录与首次访问都可以重复调用，保证新用户不会看到空白状态。
func (s *Service) EnsureDefaults(ctx context.Context, q *dbgen.Queries, userID string) error {
	if _, err := q.EnsureUserPreferences(ctx, userID); err != nil {
		return apperr.Internal(err)
	}
	if _, err := q.EnsureAiSettings(ctx, userID); err != nil {
		return apperr.Internal(err)
	}
	if _, err := s.lists.EnsureDefaultList(ctx, q, userID); err != nil {
		return err
	}
	if err := q.MarkUserInitialized(ctx, userID); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

// Get 读取用户资料。
func (s *Service) Get(ctx context.Context, userID string) (dbgen.User, error) {
	var out dbgen.User
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetUser(ctx, userID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.New(apperr.CodeUnauthenticated)
			}
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// Update 修改用户资料。
func (s *Service) Update(ctx context.Context, userID string, body httpapi.UpdateUserRequest) (dbgen.User, error) {
	if body.Timezone != nil {
		// 非法时区会让全部日期语义失去意义，必须在写入前拒绝。
		if _, err := timeutil.ParseDate("2000-01-01", timeutil.LoadLocation(*body.Timezone)); err != nil {
			return dbgen.User{}, apperr.Validation(apperr.Field("timezone", "时区名称不合法。"))
		}
	}
	if body.DisplayName != nil && strings.TrimSpace(*body.DisplayName) == "" {
		return dbgen.User{}, apperr.Validation(apperr.Field("display_name", "昵称不能为空。"))
	}

	var out dbgen.User
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.UpdateUser(ctx, dbgen.UpdateUserParams{
			ID:          userID,
			DisplayName: body.DisplayName,
			AvatarUrl:   body.AvatarUrl,
			ClearAvatar: false,
			Timezone:    body.Timezone,
		})
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.New(apperr.CodeUnauthenticated)
			}
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// Preferences 读取显式偏好。
func (s *Service) Preferences(ctx context.Context, userID string) (dbgen.UserPreference, error) {
	var out dbgen.UserPreference
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.EnsureUserPreferences(ctx, userID)
		if err != nil {
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// UpdatePreferences 修改显式偏好。
func (s *Service) UpdatePreferences(ctx context.Context, userID string, body httpapi.UpdateUserPreferencesRequest) (dbgen.UserPreference, error) {
	for name, value := range map[string]*string{
		"work_day_start":              body.WorkDayStart,
		"work_day_end":                body.WorkDayEnd,
		"default_reminder_local_time": body.DefaultReminderLocalTime,
	} {
		if value == nil {
			continue
		}
		if _, _, err := timeutil.ParseLocalTime(*value); err != nil {
			return dbgen.UserPreference{}, apperr.Validation(apperr.Field(name, "时刻必须是 HH:MM 格式。"))
		}
	}

	var weekStart *string
	if body.WeekStart != nil {
		v := string(*body.WeekStart)
		weekStart = &v
	}

	var out dbgen.UserPreference
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.EnsureUserPreferences(ctx, userID); err != nil {
			return apperr.Internal(err)
		}
		row, err := q.UpdateUserPreferences(ctx, dbgen.UpdateUserPreferencesParams{
			UserID:                   userID,
			WeekStart:                weekStart,
			WorkDayStart:             body.WorkDayStart,
			WorkDayEnd:               body.WorkDayEnd,
			DefaultReminderLocalTime: body.DefaultReminderLocalTime,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// AiSettings 读取 AI 开关。
func (s *Service) AiSettings(ctx context.Context, userID string) (dbgen.UserAiSetting, error) {
	var out dbgen.UserAiSetting
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := s.AiSettingsInTx(ctx, q, userID)
		if err != nil {
			return err
		}
		out = row
		return nil
	})
	return out, err
}

// AiSettingsInTx 在调用方的事务内读取 AI 开关。
//
// Assistant 组装上下文时需要它来决定本轮能拿到哪些能力，
// 那已经在一个事务里了，不该为了读三个布尔值再开一个。
func (s *Service) AiSettingsInTx(ctx context.Context, q *dbgen.Queries, userID string) (dbgen.UserAiSetting, error) {
	row, err := q.EnsureAiSettings(ctx, userID)
	if err != nil {
		return dbgen.UserAiSetting{}, apperr.Internal(err)
	}
	return row, nil
}

// UpdateAiSettings 修改 AI 开关。
func (s *Service) UpdateAiSettings(ctx context.Context, userID string, body httpapi.UpdateAiSettingsRequest) (dbgen.UserAiSetting, error) {
	var out dbgen.UserAiSetting
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.EnsureAiSettings(ctx, userID); err != nil {
			return apperr.Internal(err)
		}
		row, err := q.UpdateAiSettings(ctx, dbgen.UpdateAiSettingsParams{
			UserID:                userID,
			CaptureParseEnabled:   body.CaptureParseEnabled,
			SuggestionEnabled:     body.SuggestionEnabled,
			MemoryLearningEnabled: body.MemoryLearningEnabled,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// MaskPhone 把手机号中间四位替换为星号，用于展示。
func MaskPhone(phone string) string {
	if len(phone) != 11 {
		return phone
	}
	return phone[:3] + "****" + phone[7:]
}
