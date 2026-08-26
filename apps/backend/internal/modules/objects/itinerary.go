package objects

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

var emptyJSONObject = []byte("{}")

type itineraryState struct {
	ProjectID *string
	AllDay    bool
	StartAt   *time.Time
	EndAt     *time.Time
	Location  *string
}

// normalizeItineraryDetails 校验并规范化行程 Event 的结构化信息。
// 普通 Event 使用空对象；只有 trip Project 下的 Event 才能携带该信息。
func (s *Service) normalizeItineraryDetails(
	ctx context.Context,
	q *dbgen.Queries,
	userID string,
	details *httpapi.ItineraryEventDetails,
	state itineraryState,
) ([]byte, error) {
	if details == nil {
		return emptyJSONObject, nil
	}
	if state.ProjectID == nil || strings.TrimSpace(*state.ProjectID) == "" {
		return nil, apperr.Validation(apperr.Field("project_id", "行程安排必须归属一个行程。"))
	}
	if err := s.assertTripProject(ctx, q, *state.ProjectID); err != nil {
		return nil, err
	}

	normalized := *details
	if !normalized.Kind.Valid() {
		return nil, apperr.Validation(apperr.Field("itinerary_details.kind", "安排类型不合法。"))
	}
	if !normalized.BookingStatus.Valid() {
		return nil, apperr.Validation(apperr.Field("itinerary_details.booking_status", "预订状态不合法。"))
	}
	normalized.Origin = normalizedText(normalized.Origin)
	normalized.Destination = normalizedText(normalized.Destination)
	normalized.ServiceNumber = normalizedText(normalized.ServiceNumber)
	normalized.Seat = normalizedText(normalized.Seat)
	normalized.AttachmentMediaIds = uniqueNonEmpty(normalized.AttachmentMediaIds)
	if len(normalized.AttachmentMediaIds) > 9 {
		return nil, apperr.Validation(apperr.Field("itinerary_details.attachment_media_ids", "票据图片最多保留 9 张。"))
	}

	switch normalized.Kind {
	case httpapi.ItineraryItemKindTransport:
		if normalized.TransportMode == nil || !normalized.TransportMode.Valid() {
			return nil, apperr.Validation(apperr.Field("itinerary_details.transport_mode", "请选择交通方式。"))
		}
		if normalized.Origin == nil {
			return nil, apperr.Validation(apperr.Field("itinerary_details.origin", "请填写出发地。"))
		}
		if normalized.Destination == nil {
			return nil, apperr.Validation(apperr.Field("itinerary_details.destination", "请填写到达地。"))
		}
		if state.AllDay || state.StartAt == nil || state.EndAt == nil {
			return nil, apperr.Validation(apperr.Field("start_at", "交通安排需要完整的出发和到达时间。"))
		}
	case httpapi.ItineraryItemKindLodging:
		normalized.TransportMode = nil
		normalized.Origin = nil
		normalized.Destination = nil
		if normalizedText(state.Location) == nil {
			return nil, apperr.Validation(apperr.Field("location", "请填写住宿地点。"))
		}
		if state.AllDay || state.StartAt == nil || state.EndAt == nil {
			return nil, apperr.Validation(apperr.Field("start_at", "住宿安排需要入住和离店时间。"))
		}
	case httpapi.ItineraryItemKindActivity:
		normalized.TransportMode = nil
		normalized.Origin = nil
		normalized.Destination = nil
	}

	if len(normalized.AttachmentMediaIds) > 0 {
		if s.media == nil {
			return nil, apperr.Newf(apperr.CodeValidationFailed, "当前环境不能校验票据图片。")
		}
		if err := s.media.ValidateImageReferences(ctx, q, userID, normalized.AttachmentMediaIds); err != nil {
			return nil, err
		}
	}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return raw, nil
}

func (s *Service) assertTripProject(ctx context.Context, q *dbgen.Queries, projectID string) error {
	project, err := q.GetProject(ctx, projectID)
	if err != nil {
		if database.IsNoRows(err) {
			return apperr.NotFound("行程")
		}
		return apperr.Internal(err)
	}
	if project.ProjectKind != "trip" {
		return apperr.Validation(apperr.Field("project_id", "只能向行程项目添加行程安排。"))
	}
	return nil
}

func unmarshalItineraryDetails(raw []byte) *httpapi.ItineraryEventDetails {
	if len(raw) == 0 || string(raw) == "{}" || string(raw) == "null" {
		return nil
	}
	var details httpapi.ItineraryEventDetails
	if err := json.Unmarshal(raw, &details); err != nil || !details.Kind.Valid() {
		return nil
	}
	if details.AttachmentMediaIds == nil {
		details.AttachmentMediaIds = []string{}
	}
	return &details
}

func normalizedText(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func uniqueNonEmpty(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
