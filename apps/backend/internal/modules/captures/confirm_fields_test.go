package captures

import (
	"testing"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
)

func TestUnresolvedConfirmationFieldsAcceptsEditedTask(t *testing.T) {
	due := time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC)
	payload := httpapi.CaptureDraftPayload{Task: &httpapi.CaptureTaskDraft{
		Title:   "提交材料",
		DueDate: datePtr(due),
	}}

	if unresolved := unresolvedConfirmationFields("task", payload, []string{"title", "due_date"}); len(unresolved) != 0 {
		t.Fatalf("补齐后仍被判定缺失：%v", unresolved)
	}
}

func TestUnresolvedConfirmationFieldsRejectsUnknownOrEmptyField(t *testing.T) {
	payload := httpapi.CaptureDraftPayload{Task: &httpapi.CaptureTaskDraft{Title: "  "}}
	unresolved := unresolvedConfirmationFields("task", payload, []string{"title", "unknown_field"})
	if len(unresolved) != 2 {
		t.Fatalf("期望两个字段未解决，实际为：%v", unresolved)
	}
}

func TestUnresolvedConfirmationFieldsReadsRecordValue(t *testing.T) {
	trackerID := "trk_1"
	payload := httpapi.CaptureDraftPayload{Record: &httpapi.CaptureRecordDraft{
		TrackerRef: &trackerID,
		Timestamp:  time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC),
		Values: []httpapi.RecordValue{{
			Key:         "amount",
			NumberValue: floatPtr(28.5),
		}},
	}}

	if unresolved := unresolvedConfirmationFields("record", payload, []string{"tracker_ref", "amount"}); len(unresolved) != 0 {
		t.Fatalf("Record 字段补齐后仍被判定缺失：%v", unresolved)
	}
}

func datePtr(value time.Time) *openapi_types.Date { return &openapi_types.Date{Time: value} }

func floatPtr(value float64) *float64 { return &value }
