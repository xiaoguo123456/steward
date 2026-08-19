package users

import (
	"context"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// ProfileAPI 把生成的 strict server 接口映射到用户服务。
type ProfileAPI struct {
	svc *Service
}

// NewProfileAPI 构造 ProfileAPI。
func NewProfileAPI(svc *Service) *ProfileAPI { return &ProfileAPI{svc: svc} }

// GetCurrentUser 读取当前用户资料。
func (h *ProfileAPI) GetCurrentUser(ctx context.Context, _ httpapi.GetCurrentUserRequestObject) (httpapi.GetCurrentUserResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.Get(ctx, userID)
	if err != nil {
		return nil, err
	}
	return httpapi.GetCurrentUser200JSONResponse{Data: MapUser(row), Meta: httpx.Meta(ctx)}, nil
}

// UpdateCurrentUser 修改当前用户资料。
func (h *ProfileAPI) UpdateCurrentUser(ctx context.Context, req httpapi.UpdateCurrentUserRequestObject) (httpapi.UpdateCurrentUserResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.Update(ctx, userID, *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.UpdateCurrentUser200JSONResponse{Data: MapUser(row), Meta: httpx.Meta(ctx)}, nil
}

// GetUserPreferences 读取显式偏好。
func (h *ProfileAPI) GetUserPreferences(ctx context.Context, _ httpapi.GetUserPreferencesRequestObject) (httpapi.GetUserPreferencesResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.Preferences(ctx, userID)
	if err != nil {
		return nil, err
	}
	return httpapi.GetUserPreferences200JSONResponse{Data: mapPreferences(row), Meta: httpx.Meta(ctx)}, nil
}

// UpdateUserPreferences 修改显式偏好。
func (h *ProfileAPI) UpdateUserPreferences(ctx context.Context, req httpapi.UpdateUserPreferencesRequestObject) (httpapi.UpdateUserPreferencesResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.UpdatePreferences(ctx, userID, *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.UpdateUserPreferences200JSONResponse{Data: mapPreferences(row), Meta: httpx.Meta(ctx)}, nil
}

// GetAiSettings 读取 AI 开关。
func (h *ProfileAPI) GetAiSettings(ctx context.Context, _ httpapi.GetAiSettingsRequestObject) (httpapi.GetAiSettingsResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.AiSettings(ctx, userID)
	if err != nil {
		return nil, err
	}
	return httpapi.GetAiSettings200JSONResponse{Data: mapAiSettings(row), Meta: httpx.Meta(ctx)}, nil
}

// UpdateAiSettings 修改 AI 开关。
func (h *ProfileAPI) UpdateAiSettings(ctx context.Context, req httpapi.UpdateAiSettingsRequestObject) (httpapi.UpdateAiSettingsResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	row, err := h.svc.UpdateAiSettings(ctx, userID, *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.UpdateAiSettings200JSONResponse{Data: mapAiSettings(row), Meta: httpx.Meta(ctx)}, nil
}

// MapUser 把用户行映射成契约 DTO。手机号始终脱敏返回。
func MapUser(row dbgen.User) httpapi.User {
	return httpapi.User{
		Id:          row.ID,
		Phone:       MaskPhone(row.Phone),
		DisplayName: row.DisplayName,
		AvatarUrl:   row.AvatarUrl,
		Timezone:    row.Timezone,
		Initialized: row.Initialized,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}

func mapPreferences(row dbgen.UserPreference) httpapi.UserPreferences {
	return httpapi.UserPreferences{
		WeekStart:                httpapi.UserPreferencesWeekStart(row.WeekStart),
		WorkDayStart:             row.WorkDayStart,
		WorkDayEnd:               row.WorkDayEnd,
		DefaultReminderLocalTime: row.DefaultReminderLocalTime,
		UpdatedAt:                row.UpdatedAt,
	}
}

func mapAiSettings(row dbgen.UserAiSetting) httpapi.AiSettings {
	return httpapi.AiSettings{
		CaptureParseEnabled:   row.CaptureParseEnabled,
		SuggestionEnabled:     row.SuggestionEnabled,
		MemoryLearningEnabled: row.MemoryLearningEnabled,
		UpdatedAt:             row.UpdatedAt,
	}
}
