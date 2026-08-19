package captures

import (
	"encoding/json"
	"strings"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

// buildPayload 把 Provider 的中立候选转换成契约的判别联合快照，
// 并返回仍然缺失的必填字段。
func buildPayload(c ai.CandidateDraft, defaultListID string, loc *time.Location) ([]byte, []string, error) {
	var payload httpapi.CaptureDraftPayload
	var missing []string

	switch c.Type {
	case "task":
		if strings.TrimSpace(c.Title) == "" {
			missing = append(missing, "title")
		}
		listID := c.ListID
		if listID == "" {
			listID = defaultListID
		}
		draft := httpapi.CaptureTaskDraft{Title: c.Title}
		if c.Description != "" {
			draft.Description = &c.Description
		}
		if c.Priority != "" {
			p := httpapi.TaskPriority(c.Priority)
			draft.Priority = &p
		}
		if c.DueDate != nil {
			draft.DueDate = &openapi_types.Date{Time: *c.DueDate}
		}
		draft.DueAt = c.DueAt
		if listID != "" {
			draft.ListId = &listID
		}
		payload.Task = &draft

	case "event":
		if strings.TrimSpace(c.Title) == "" {
			missing = append(missing, "title")
		}
		draft := httpapi.CaptureEventDraft{Title: c.Title, AllDay: c.AllDay}
		if c.EventKind != "" {
			k := httpapi.EventKind(c.EventKind)
			draft.EventKind = &k
		}
		draft.StartAt = c.StartAt
		if c.StartDate != nil {
			draft.StartDate = &openapi_types.Date{Time: *c.StartDate}
		}
		if c.Location != "" {
			draft.Location = &c.Location
		}
		// 全天与定时两组字段互斥，缺少开始信息时必须由用户补全。
		if c.AllDay && draft.StartDate == nil {
			missing = append(missing, "start_date")
		}
		if !c.AllDay && draft.StartAt == nil {
			missing = append(missing, "start_at")
		}
		payload.Event = &draft

	case "note":
		content := c.Content
		if strings.TrimSpace(content) == "" {
			content = c.Title
		}
		if strings.TrimSpace(content) == "" {
			missing = append(missing, "content")
		}
		draft := httpapi.CaptureNoteDraft{Content: content}
		if c.Title != "" {
			title := c.Title
			draft.Title = &title
		}
		if len(c.Tags) > 0 {
			tags := c.Tags
			draft.Tags = &tags
		}
		payload.Note = &draft

	case "project":
		if strings.TrimSpace(c.Title) == "" {
			missing = append(missing, "title")
		}
		draft := httpapi.CaptureProjectDraft{Title: c.Title}
		if c.Description != "" {
			draft.Description = &c.Description
		}
		payload.Project = &draft

	case "record":
		ts := time.Now()
		if c.Timestamp != nil {
			ts = *c.Timestamp
		}
		draft := httpapi.CaptureRecordDraft{Timestamp: ts}
		if c.TrackerID != "" {
			id := c.TrackerID
			draft.TrackerRef = &id
		} else {
			missing = append(missing, "tracker_ref")
		}
		for _, v := range c.RecordValues {
			value := httpapi.RecordValue{Key: v.Key}
			if v.Number != nil {
				n := *v.Number
				value.NumberValue = &n
			}
			if v.Text != "" {
				t := v.Text
				value.TextValue = &t
			}
			draft.Values = append(draft.Values, value)
		}
		if len(draft.Values) == 0 {
			missing = append(missing, "values")
		}
		payload.Record = &draft

	case "tracker":
		draft := httpapi.CaptureTrackerDraft{Name: c.Title}
		if strings.TrimSpace(c.Title) == "" {
			missing = append(missing, "name")
		}
		payload.Tracker = &draft

	default:
		return nil, nil, apperr.Newf(apperr.CodeAISchemaInvalid, "无法识别的候选类型。")
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, apperr.Internal(err)
	}
	return raw, missing, nil
}

func mapConfidences(in []ai.Confidence) []httpapi.CaptureFieldConfidence {
	out := make([]httpapi.CaptureFieldConfidence, 0, len(in))
	for _, c := range in {
		item := httpapi.CaptureFieldConfidence{
			Field: c.Field,
			Level: httpapi.CaptureFieldConfidenceLevel(c.Level),
		}
		refs := mapSources(c.Sources)
		item.SourceRefs = &refs
		out = append(out, item)
	}
	return out
}

func mapSources(in []ai.SourceSpan) []httpapi.CaptureSourceRef {
	out := make([]httpapi.CaptureSourceRef, 0, len(in))
	for _, s := range in {
		ref := httpapi.CaptureSourceRef{PartId: s.PartID}
		if s.TextEnd > s.TextStart {
			start, end := s.TextStart, s.TextEnd
			ref.TextStart = &start
			ref.TextEnd = &end
		}
		out = append(out, ref)
	}
	return out
}

func mapConflictOptions(in []ai.ConflictOption) []map[string]any {
	out := make([]map[string]any, 0, len(in))
	for _, o := range in {
		out = append(out, map[string]any{
			"value":       o.Value,
			"source_refs": mapSources(o.Sources),
		})
	}
	return out
}

// captureSummary 生成一句话摘要，供全局待答入口展示。
func captureSummary(result ai.CaptureParseResult) string {
	if len(result.Candidates) == 0 {
		return "待补充说明的输入"
	}
	title := result.Candidates[0].Title
	runes := []rune(title)
	if len(runes) > 18 {
		return string(runes[:18]) + "…"
	}
	return title
}

// MapCapture 把读模型映射成契约 DTO。
func MapCapture(d Detail) httpapi.Capture {
	out := httpapi.Capture{
		Id:              d.Capture.ID,
		Status:          httpapi.CaptureStatus(d.Capture.Status),
		Revision:        int(d.Capture.Revision),
		Origin:          httpapi.CaptureOrigin(d.Capture.Origin),
		InstructionNote: d.Capture.InstructionNote,
		CreatedAt:       d.Capture.CreatedAt,
		UpdatedAt:       d.Capture.UpdatedAt,
		ConfirmedAt:     d.Capture.ConfirmedAt,
		Parts:           make([]httpapi.CapturePart, 0, len(d.Parts)),
		Candidates:      make([]httpapi.CaptureCandidate, 0, len(d.Candidates)),
	}
	if d.Capture.ActivityBatchID != nil {
		out.ActivityBatchId = d.Capture.ActivityBatchID
	}
	if len(d.Capture.Error) > 0 {
		var body httpapi.ErrorBody
		if err := json.Unmarshal(d.Capture.Error, &body); err == nil {
			out.Error = &body
		}
	}

	for _, p := range d.Parts {
		part := httpapi.CapturePart{
			Id:       p.ID,
			Kind:     httpapi.CapturePartKind(p.Kind),
			Status:   httpapi.CapturePartStatus(p.Status),
			Position: int(p.Position),
			Text:     p.Text,
			MediaUrl: p.MediaUrl,
		}
		if p.DurationMs != nil {
			d := int(*p.DurationMs)
			part.DurationMs = &d
		}
		out.Parts = append(out.Parts, part)
	}

	for _, c := range d.Candidates {
		candidate := httpapi.CaptureCandidate{
			Id:            c.ID,
			CandidateType: httpapi.CaptureCandidateType(c.CandidateType),
			Action:        httpapi.CaptureCandidateAction(c.Action),
			Selected:      c.Selected,
			Payload:       decodePayload(c.Payload),
			TargetId:      c.TargetID,
			DuplicateOf:   c.DuplicateOf,
		}
		if c.TargetExpectedVersion != nil {
			v := int(*c.TargetExpectedVersion)
			candidate.TargetExpectedVersion = &v
		}
		var confidences []httpapi.CaptureFieldConfidence
		if err := json.Unmarshal(c.FieldConfidences, &confidences); err == nil {
			candidate.FieldConfidences = &confidences
		}
		var sources []httpapi.CaptureSourceRef
		if err := json.Unmarshal(c.SourceRefs, &sources); err == nil {
			candidate.SourceRefs = &sources
		}
		missing := c.MissingFields
		candidate.MissingFields = &missing
		warnings := c.Warnings
		candidate.Warnings = &warnings
		out.Candidates = append(out.Candidates, candidate)
	}

	questions := make([]httpapi.CaptureQuestion, 0, len(d.Questions))
	for _, q := range d.Questions {
		questions = append(questions, MapQuestion(q))
	}
	out.Questions = &questions

	conflicts := make([]httpapi.CaptureConflict, 0, len(d.Conflicts))
	for _, c := range d.Conflicts {
		conflict := httpapi.CaptureConflict{Id: c.ID, Field: c.Field}
		if c.Description != "" {
			desc := c.Description
			conflict.Description = &desc
		}
		_ = json.Unmarshal(c.Options, &conflict.Options)
		conflicts = append(conflicts, conflict)
	}
	out.Conflicts = &conflicts

	if len(d.Created) > 0 {
		created := d.Created
		out.CreatedObjects = &created
	}
	return out
}

// MapQuestion 把追问映射成契约 DTO。
func MapQuestion(q dbgen.CaptureQuestion) httpapi.CaptureQuestion {
	answers := q.QuickAnswers
	return httpapi.CaptureQuestion{
		Id:             q.ID,
		CaptureId:      q.CaptureID,
		Question:       q.Question,
		Blocking:       q.Blocking,
		Status:         httpapi.CaptureQuestionStatus(q.Status),
		QuickAnswers:   &answers,
		CaptureSummary: &q.CaptureSummary,
		CreatedAt:      q.CreatedAt,
		AnsweredAt:     q.AnsweredAt,
	}
}
