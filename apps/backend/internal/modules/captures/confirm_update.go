package captures

import (
	"context"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

// updateConfirmedCandidate 把 Capture 的完整候选草稿转换为正式领域 PATCH。
// expected_version 来自用户看到的 Candidate Snapshot，事务内 Command 再做 CAS。
func (s *Service) updateConfirmedCandidate(ctx context.Context, q *dbgen.Queries, userID string,
	candidate dbgen.CaptureCandidate, payload httpapi.CaptureDraftPayload,
	createdProjects map[string]string) (ConfirmedResource, string, error) {
	if candidate.TargetID == nil || candidate.TargetExpectedVersion == nil {
		return ConfirmedResource{}, "", apperr.Validation(apperr.Field(
			"items", "更新候选缺少目标实体或版本，请重新整理。"))
	}
	targetID, version := *candidate.TargetID, *candidate.TargetExpectedVersion
	switch candidate.CandidateType {
	case "task":
		if payload.Task == nil {
			return ConfirmedResource{}, "", invalidUpdatePayload()
		}
		body := httpapi.UpdateTaskRequest{
			Title: &payload.Task.Title, Description: payload.Task.Description,
			DueAt: payload.Task.DueAt, DueDate: payload.Task.DueDate,
			DueTimezone: payload.Task.DueTimezone, EstimatedMinutes: payload.Task.EstimatedMinutes,
			Priority: payload.Task.Priority, ScheduledStartAt: payload.Task.ScheduledStartAt,
			ScheduledEndAt: payload.Task.ScheduledEndAt, ScheduledTimezone: payload.Task.ScheduledTimezone,
		}
		if payload.Task.ListId != nil {
			body.ListId = payload.Task.ListId
		}
		body.ProjectId = resolveProjectRef(payload.Task.ProjectRef, createdProjects)
		row, err := s.objects.UpdateTaskCommandInTx(ctx, q, userID, targetID, body, version)
		return ConfirmedResource{Type: "task", ID: row.ID}, row.Title, err
	case "event":
		if payload.Event == nil {
			return ConfirmedResource{}, "", invalidUpdatePayload()
		}
		body := httpapi.UpdateEventRequest{
			Title: &payload.Event.Title, AllDay: &payload.Event.AllDay,
			StartAt: payload.Event.StartAt, EndAt: payload.Event.EndAt,
			StartDate: payload.Event.StartDate, EndDate: payload.Event.EndDate,
			Timezone: payload.Event.Timezone, Location: payload.Event.Location, Note: payload.Event.Note,
			Participants: payload.Event.Participants, EventKind: payload.Event.EventKind,
			Recurrence: payload.Event.Recurrence, ItineraryDetails: payload.Event.ItineraryDetails,
			ProjectId: resolveProjectRef(payload.Event.ProjectRef, createdProjects),
		}
		row, err := s.objects.UpdateEventCommandInTx(ctx, q, userID, targetID, body, version)
		return ConfirmedResource{Type: "event", ID: row.ID}, row.Title, err
	case "note":
		if payload.Note == nil {
			return ConfirmedResource{}, "", invalidUpdatePayload()
		}
		content := httpapi.NoteContentPlainText{Format: httpapi.PlainText, Text: payload.Note.Content}
		body := httpapi.UpdateNoteRequest{Title: payload.Note.Title,
			Content: &content, Tags: payload.Note.Tags,
			ProjectId: resolveProjectRef(payload.Note.ProjectRef, createdProjects)}
		row, err := s.objects.UpdateNoteCommandInTx(ctx, q, userID, targetID, body, version)
		return ConfirmedResource{Type: "note", ID: row.ID}, row.Title, err
	case "project":
		if payload.Project == nil {
			return ConfirmedResource{}, "", invalidUpdatePayload()
		}
		body := httpapi.UpdateProjectRequest{Title: &payload.Project.Title,
			Description: payload.Project.Description, StartDate: payload.Project.StartDate,
			TargetDate: payload.Project.TargetDate}
		row, err := s.objects.UpdateProjectCommandInTx(ctx, q, userID, targetID, body, version)
		return ConfirmedResource{Type: "project", ID: row.ID}, row.Title, err
	case "tracker":
		if payload.Tracker == nil {
			return ConfirmedResource{}, "", invalidUpdatePayload()
		}
		body := httpapi.UpdateTrackerRequest{Name: &payload.Tracker.Name,
			Description: payload.Tracker.Description, Fields: &payload.Tracker.Fields}
		row, err := s.trackers.UpdateTrackerCommandInTx(ctx, q, userID, targetID, body, version)
		return ConfirmedResource{Type: "tracker", ID: row.ID}, row.Name, err
	case "record":
		if payload.Record == nil {
			return ConfirmedResource{}, "", invalidUpdatePayload()
		}
		body := httpapi.UpdateRecordRequest{Timestamp: &payload.Record.Timestamp,
			Values: &payload.Record.Values, Note: payload.Record.Note}
		row, err := s.trackers.UpdateRecordCommandInTx(ctx, q, userID, targetID, body, version)
		return ConfirmedResource{Type: "record", ID: row.ID}, row.Title, err
	default:
		return ConfirmedResource{}, "", apperr.Validation(apperr.Field("items", "存在无法更新的候选类型。"))
	}
}

func invalidUpdatePayload() error {
	return apperr.Validation(apperr.Field("items", "更新候选缺少内容。"))
}

func isConfirmUpdate(item confirmItem) bool {
	if item.candidate.Action == "update" {
		return true
	}
	return item.duplicateResolution != nil && strings.EqualFold(string(*item.duplicateResolution), "update")
}

func appendCaptureUpdateProvenance(ctx context.Context, q *dbgen.Queries, userID string,
	resource ConfirmedResource, provenance []byte) error {
	var (
		rows int64
		err  error
	)
	switch resource.Type {
	case "task":
		rows, err = q.AppendTaskCaptureProvenance(ctx, dbgen.AppendTaskCaptureProvenanceParams{
			ProvenanceRefs: provenance, ID: resource.ID, UserID: userID})
	case "event":
		rows, err = q.AppendEventCaptureProvenance(ctx, dbgen.AppendEventCaptureProvenanceParams{
			ProvenanceRefs: provenance, ID: resource.ID, UserID: userID})
	case "project":
		rows, err = q.AppendProjectCaptureProvenance(ctx, dbgen.AppendProjectCaptureProvenanceParams{
			ProvenanceRefs: provenance, ID: resource.ID, UserID: userID})
	case "note":
		rows, err = q.AppendNoteCaptureProvenance(ctx, dbgen.AppendNoteCaptureProvenanceParams{
			ProvenanceRefs: provenance, ID: resource.ID, UserID: userID})
	case "tracker":
		rows, err = q.AppendTrackerCaptureProvenance(ctx, dbgen.AppendTrackerCaptureProvenanceParams{
			ProvenanceRefs: provenance, ID: resource.ID, UserID: userID})
	case "record":
		rows, err = q.AppendRecordCaptureProvenance(ctx, dbgen.AppendRecordCaptureProvenanceParams{
			ProvenanceRefs: provenance, ID: resource.ID, UserID: userID})
	}
	if err != nil {
		return apperr.Internal(err)
	}
	if rows != 1 {
		return apperr.New(apperr.CodeVersionConflict)
	}
	return nil
}
