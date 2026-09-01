package captures

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	authpkg "github.com/guoxiaozheng1/steward/apps/backend/internal/platform/auth"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// ConfirmResult 是确认保存的结果。
type ConfirmResult struct {
	Detail    Detail
	Affected  []httpapi.AffectedResource
	BatchID   string
	SavedRows int
}

const confirmEndpoint = "captures.confirm"

// confirmReplay 是幂等记录中的最小响应快照。Capture 已在同一事务进入终态，
// 重放时重新加载只读详情，并复用首次确认产生的资源列表与批次引用。
type confirmReplay struct {
	Affected  []httpapi.AffectedResource `json:"affected_resources"`
	BatchID   string                     `json:"batch_id"`
	SavedRows int                        `json:"saved_rows"`
}

// Confirm 保存用户勾选的候选项。
//
// 全部创建、更新与关系变更在一个事务内完成，任一失败整体回滚（CFM-004）。
// 未列出的候选视为用户放弃，不进入任何正式内容（CFM-007）。
func (s *Service) Confirm(ctx context.Context, userID, captureID, idempotencyKey string,
	body httpapi.ConfirmCaptureRequest) (ConfirmResult, error) {

	if len(body.Items) == 0 {
		return ConfirmResult{}, apperr.Validation(apperr.Field("items", "至少需要选择一项才能保存。"))
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		return ConfirmResult{}, apperr.New(apperr.CodeIdempotencyKeyReq)
	}
	rawBody, err := json.Marshal(struct {
		CaptureID string                        `json:"capture_id"`
		Body      httpapi.ConfirmCaptureRequest `json:"body"`
	}{CaptureID: captureID, Body: body})
	if err != nil {
		return ConfirmResult{}, apperr.Internal(err)
	}
	requestHash := authpkg.HashToken(string(rawBody))

	var out ConfirmResult
	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if err := q.AcquireIdempotencyLock(ctx,
			confirmEndpoint+":"+userID+":"+idempotencyKey); err != nil {
			return apperr.Internal(err)
		}
		replayed, err := q.GetIdempotencyRecord(ctx, dbgen.GetIdempotencyRecordParams{
			UserID: userID, Endpoint: confirmEndpoint, Key: idempotencyKey,
		})
		if err == nil {
			if subtle.ConstantTimeCompare(replayed.RequestHash, requestHash) != 1 {
				return apperr.New(apperr.CodeIdempotencyReused)
			}
			var snapshot confirmReplay
			if err := json.Unmarshal(replayed.ResponseBody, &snapshot); err != nil {
				return apperr.Internal(err)
			}
			detail, err := s.loadDetail(ctx, q, captureID)
			if err != nil {
				return err
			}
			detail.Created = snapshot.Affected
			out = ConfirmResult{Detail: detail, Affected: snapshot.Affected,
				BatchID: snapshot.BatchID, SavedRows: snapshot.SavedRows}
			return nil
		}
		if !database.IsNoRows(err) {
			return apperr.Internal(err)
		}

		// 幂等键只串行化同一个重试键；Capture 行锁还要阻止两个不同键并发确认同一批候选。
		capture, err := q.GetCaptureForUpdate(ctx, captureID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这次输入")
			}
			return apperr.Internal(err)
		}
		if capture.Status == "confirmed" {
			return apperr.New(apperr.CodeCaptureAlreadyConfirm)
		}
		// 只允许确认最新 revision；旧 revision 只供审计。
		if int32(body.Revision) != capture.Revision {
			return apperr.New(apperr.CodeCaptureRevisionStale)
		}
		if capture.Status != "needs_confirmation" && capture.Status != "partially_failed" {
			return apperr.New(apperr.CodeCaptureNotReady)
		}

		loc := timeutil.LoadLocation(capture.Timezone)
		provenance := []objects.ProvenanceInput{{
			SourceType:     "capture",
			SourceID:       capture.ID,
			SourceRevision: intPtr(int(capture.Revision)),
			Action:         "created_from",
		}}
		provenanceJSON, err := json.Marshal(provenance)
		if err != nil {
			return apperr.Internal(err)
		}
		updateProvenance := append([]objects.ProvenanceInput(nil), provenance...)
		updateProvenance[0].Action = "updated_from"
		updateProvenanceJSON, err := json.Marshal(updateProvenance)
		if err != nil {
			return apperr.Internal(err)
		}

		// 本次新建的 Tracker 需要被同批 Record 引用，因此记录候选到实体的映射。
		createdTrackers := make(map[string]string)
		// Project 必须先于同批次中引用它的 Task、Event 与 Note 创建。
		createdProjects := make(map[string]string)
		confirmedResources := make(map[string]ConfirmedResource, len(body.Items))
		entries := make([]activity.EntryInput, 0, len(body.Items))
		affected := make([]httpapi.AffectedResource, 0, len(body.Items)+3)

		// 先处理 Tracker：Record 依赖它先存在。
		ordered, err := orderItems(ctx, q, capture, body.Items)
		if err != nil {
			return err
		}

		for _, item := range ordered {
			candidate := item.candidate
			payload := decodePayload(candidate.Payload)
			if item.override != nil {
				payload = *item.override
			}
			if unresolved := unresolvedConfirmationFields(
				candidate.CandidateType, payload, candidate.MissingFields,
			); len(unresolved) > 0 {
				// 原候选缺失字段可以由确认页 payload 补齐，但服务端必须重新检查，
				// 不能把“客户端提交了 override”等同于已经完成校验（CFM-001）。
				return apperr.Validation(apperr.Field(
					"items", "还有必填信息没有补全，请先完善后再保存："+
						strings.Join(unresolved, "、")))
			}
			if payload.Task != nil && item.listID != nil {
				payload.Task.ListId = item.listID
			}
			if isConfirmUpdate(item) {
				confirmed, title, err := s.updateConfirmedCandidate(
					ctx, q, userID, candidate, payload, createdProjects)
				if err != nil {
					return err
				}
				if err := appendCaptureUpdateProvenance(ctx, q, userID, confirmed, updateProvenanceJSON); err != nil {
					return err
				}
				confirmedResources[candidate.ID] = confirmed
				entries = append(entries, activity.EntryInput{
					Action: "updated", ResourceType: confirmed.Type, ResourceID: confirmed.ID,
					Title: title, Summary: "从一次输入更新了已有内容",
				})
				affected = append(affected, resource(affectedResourceType(confirmed.Type), confirmed.ID))
				continue
			}

			switch candidate.CandidateType {
			case "tracker":
				if payload.Tracker == nil {
					return apperr.Validation(apperr.Field("items", "记录项候选缺少内容。"))
				}
				row, err := s.trackers.CreateTrackerInTx(ctx, q, userID,
					payload.Tracker.Name, payload.Tracker.Fields, provenanceJSON)
				if err != nil {
					return err
				}
				createdTrackers[candidate.ID] = row.ID
				confirmedResources[candidate.ID] = ConfirmedResource{Type: "tracker", ID: row.ID}
				entries = append(entries, activity.EntryInput{
					Action: "created", ResourceType: "tracker", ResourceID: row.ID,
					Title: row.Name, Summary: "从一次输入创建了记录项",
				})
				affected = append(affected, resource(httpapi.AffectedResourceTypeTracker, row.ID))

			case "record":
				if payload.Record == nil {
					return apperr.Validation(apperr.Field("items", "记录候选缺少内容。"))
				}
				trackerID := ""
				if payload.Record.TrackerRef != nil {
					trackerID = *payload.Record.TrackerRef
					// 引用本次新建的 Tracker 时替换为实际 ID。
					if mapped, ok := createdTrackers[trackerID]; ok {
						trackerID = mapped
					}
				}
				if trackerID == "" {
					return apperr.Validation(apperr.Field("items", "记录必须先选择所属记录项。"))
				}
				values := payload.Record.Values
				row, err := s.trackers.CreateRecordInTx(ctx, q, userID, trackerID,
					payload.Record.Timestamp, values, payload.Record.Note, provenanceJSON)
				if err != nil {
					return err
				}
				confirmedResources[candidate.ID] = ConfirmedResource{Type: "record", ID: row.ID}
				entries = append(entries, activity.EntryInput{
					Action: "created", ResourceType: "record", ResourceID: row.ID,
					Title: row.Title, Summary: "从一次输入新增了记录",
				})
				affected = append(affected, resource(httpapi.AffectedResourceTypeRecord, row.ID))

			case "task":
				if payload.Task == nil {
					return apperr.Validation(apperr.Field("items", "任务候选缺少内容。"))
				}
				listID := ""
				if item.listID != nil {
					listID = *item.listID
				} else if payload.Task.ListId != nil {
					listID = *payload.Task.ListId
				}
				resolved, err := s.lists.ResolveListID(ctx, q, userID, optional(listID))
				if err != nil {
					return err
				}
				cmd := objects.CreateTaskCommand{
					Title:       payload.Task.Title,
					Description: payload.Task.Description,
					ListID:      resolved,
					CreatedBy:   "ai",
					Provenance:  provenance,
					DueTimezone: capture.Timezone,
					ProjectID:   resolveProjectRef(payload.Task.ProjectRef, createdProjects),
				}
				if payload.Task.Priority != nil {
					cmd.Priority = string(*payload.Task.Priority)
				}
				if payload.Task.DueDate != nil {
					d := payload.Task.DueDate.Time
					cmd.DueDate = &d
				}
				cmd.DueAt = payload.Task.DueAt
				row, err := s.objects.CreateTaskInTx(ctx, q, userID, cmd)
				if err != nil {
					return err
				}
				confirmedResources[candidate.ID] = ConfirmedResource{Type: "task", ID: row.ID}
				entries = append(entries, activity.EntryInput{
					Action: "created", ResourceType: "task", ResourceID: row.ID,
					Title: row.Title, Summary: "从一次输入创建了任务",
				})
				affected = append(affected, resource(httpapi.AffectedResourceTypeTask, row.ID))

			case "event":
				if payload.Event == nil {
					return apperr.Validation(apperr.Field("items", "日程候选缺少内容。"))
				}
				cmd := objects.CreateEventCommand{
					Title:            payload.Event.Title,
					AllDay:           payload.Event.AllDay,
					StartAt:          payload.Event.StartAt,
					EndAt:            payload.Event.EndAt,
					Location:         payload.Event.Location,
					Note:             payload.Event.Note,
					Timezone:         capture.Timezone,
					CreatedBy:        "ai",
					Provenance:       provenance,
					ProjectID:        resolveProjectRef(payload.Event.ProjectRef, createdProjects),
					ItineraryDetails: payload.Event.ItineraryDetails,
				}
				if payload.Event.EventKind != nil {
					cmd.EventKind = string(*payload.Event.EventKind)
				}
				if payload.Event.Recurrence != nil {
					cmd.Recurrence = string(*payload.Event.Recurrence)
				}
				if payload.Event.StartDate != nil {
					d := payload.Event.StartDate.Time
					cmd.StartDate = &d
				}
				if payload.Event.EndDate != nil {
					d := payload.Event.EndDate.Time
					cmd.EndDate = &d
				}
				row, err := s.objects.CreateEventInTx(ctx, q, userID, cmd)
				if err != nil {
					return err
				}
				confirmedResources[candidate.ID] = ConfirmedResource{Type: "event", ID: row.ID}
				entries = append(entries, activity.EntryInput{
					Action: "created", ResourceType: "event", ResourceID: row.ID,
					Title: row.Title, Summary: "从一次输入创建了日程",
				})
				affected = append(affected, resource(httpapi.AffectedResourceTypeEvent, row.ID))

			case "note":
				if payload.Note == nil {
					return apperr.Validation(apperr.Field("items", "笔记候选缺少内容。"))
				}
				cmd := objects.CreateNoteCommand{
					Title:      payload.Note.Title,
					Content:    payload.Note.Content,
					CreatedBy:  "ai",
					Provenance: provenance,
					ProjectID:  resolveProjectRef(payload.Note.ProjectRef, createdProjects),
				}
				if payload.Note.Tags != nil {
					cmd.Tags = *payload.Note.Tags
				}
				row, err := s.objects.CreateNoteInTx(ctx, q, userID, cmd)
				if err != nil {
					return err
				}
				confirmedResources[candidate.ID] = ConfirmedResource{Type: "note", ID: row.ID}
				entries = append(entries, activity.EntryInput{
					Action: "created", ResourceType: "note", ResourceID: row.ID,
					Title: row.Title, Summary: "从一次输入创建了笔记",
				})
				affected = append(affected, resource(httpapi.AffectedResourceTypeNote, row.ID))

			case "project":
				if payload.Project == nil {
					return apperr.Validation(apperr.Field("items", "项目候选缺少内容。"))
				}
				projectKind := "general"
				if payload.Project.ProjectKind != nil {
					projectKind = string(*payload.Project.ProjectKind)
				}
				description := payload.Project.Description
				if projectKind == "trip" {
					destination := ""
					if payload.Project.Destination != nil {
						destination = strings.TrimSpace(*payload.Project.Destination)
					}
					if destination == "" || payload.Project.StartDate == nil || payload.Project.TargetDate == nil {
						return apperr.Validation(apperr.Field(
							"items", "行程必须包含名称、目的地、开始日期和结束日期。"))
					}
					notes := ""
					if description != nil {
						notes = strings.TrimSpace(*description)
					}
					combined := destination
					if notes != "" {
						combined += "\n" + notes
					}
					description = &combined
				}
				cmd := objects.CreateProjectCommand{
					Title:       payload.Project.Title,
					Description: description,
					ProjectKind: projectKind,
					CreatedBy:   "ai",
					Provenance:  provenance,
				}
				if payload.Project.StartDate != nil {
					d := payload.Project.StartDate.Time
					cmd.StartDate = &d
				}
				if payload.Project.TargetDate != nil {
					d := payload.Project.TargetDate.Time
					cmd.TargetDate = &d
				}
				row, err := s.objects.CreateProjectInTx(ctx, q, userID, cmd)
				if err != nil {
					return err
				}
				createdProjects[candidate.ID] = row.ID
				confirmedResources[candidate.ID] = ConfirmedResource{Type: "project", ID: row.ID}
				summary := "从一次输入创建了项目"
				if projectKind == "trip" {
					summary = "从一次输入创建了行程"
				}
				entries = append(entries, activity.EntryInput{
					Action: "created", ResourceType: "project", ResourceID: row.ID,
					Title: row.Title, Summary: summary,
				})
				affected = append(affected, resource(httpapi.AffectedResourceTypeProject, row.ID))

			default:
				return apperr.Validation(apperr.Field("items", "存在无法保存的候选类型。"))
			}
		}

		relationCandidates, err := q.ListCaptureRelationCandidates(ctx, dbgen.ListCaptureRelationCandidatesParams{
			CaptureID: capture.ID, Revision: capture.Revision,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		relations, err := s.PersistConfirmedRelations(
			ctx, q, userID, relationCandidates, confirmedResources, provenanceJSON)
		if err != nil {
			return err
		}
		for _, relation := range relations {
			entries = append(entries, activity.EntryInput{
				Action: "created", ResourceType: "relation", ResourceID: relation.ID,
				Summary: "从一次输入保存了内容关系",
			})
		}

		_ = loc

		batchID, err := s.activity.Record(ctx, q, userID,
			activity.SourceCaptureConfirm, &capture.ID, entries)
		if err != nil {
			return err
		}

		if _, err := q.MarkCaptureConfirmed(ctx, dbgen.MarkCaptureConfirmedParams{
			ID: captureID, ActivityBatchID: &batchID,
		}); err != nil {
			return apperr.Internal(err)
		}

		affected = append(affected,
			resource(httpapi.AffectedResourceTypeToday, ""),
			resource(httpapi.AffectedResourceTypeCalendar, ""),
			resource(httpapi.AffectedResourceTypeActivity, ""),
		)

		detail, err := s.loadDetail(ctx, q, captureID)
		if err != nil {
			return err
		}
		detail.Created = affected
		out = ConfirmResult{Detail: detail, Affected: affected, BatchID: batchID, SavedRows: len(entries)}
		responseBody, err := json.Marshal(confirmReplay{
			Affected: affected, BatchID: batchID, SavedRows: len(entries),
		})
		if err != nil {
			return apperr.Internal(err)
		}
		if err := q.SaveIdempotencyRecord(ctx, dbgen.SaveIdempotencyRecordParams{
			UserID: userID, Endpoint: confirmEndpoint, Key: idempotencyKey,
			RequestHash: requestHash, StatusCode: 200, ResponseBody: responseBody,
			ResourceID: &captureID, ExpiresAt: time.Now().Add(24 * time.Hour),
		}); err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
	return out, err
}

// confirmItem 是一个待保存的候选与用户编辑。
type confirmItem struct {
	candidate           dbgen.CaptureCandidate
	override            *httpapi.CaptureDraftPayload
	listID              *string
	duplicateResolution *httpapi.ConfirmCaptureItemDuplicateResolution
}

// orderItems 校验候选归属，并把 Project、Tracker 排到依赖它们的对象之前。
func orderItems(ctx context.Context, q *dbgen.Queries, capture dbgen.Capture,
	items []httpapi.ConfirmCaptureItem) ([]confirmItem, error) {

	var projectsFirst, trackersSecond, rest []confirmItem
	for _, item := range items {
		candidate, err := q.GetCaptureCandidate(ctx, dbgen.GetCaptureCandidateParams{
			ID: item.CandidateId, CaptureID: capture.ID, Revision: capture.Revision,
		})
		if err != nil {
			if database.IsNoRows(err) {
				return nil, apperr.Newf(apperr.CodeCaptureRevisionStale,
					"选中的内容已经更新，请查看最新的整理结果。")
			}
			return nil, apperr.Internal(err)
		}
		if candidate.DuplicateOf != nil && item.DuplicateResolution == nil {
			return nil, apperr.Validation(apperr.Field(
				"items", "存在可能重复的内容，请明确选择更新原内容或仍然创建。"))
		}
		if candidate.DuplicateOf == nil && item.DuplicateResolution != nil {
			return nil, apperr.Validation(apperr.Field(
				"items", "未命中重复内容时不能提交重复处理选择。"))
		}
		ci := confirmItem{candidate: candidate, override: item.Payload, listID: item.ListId,
			duplicateResolution: item.DuplicateResolution}
		switch candidate.CandidateType {
		case "project":
			projectsFirst = append(projectsFirst, ci)
		case "tracker":
			trackersSecond = append(trackersSecond, ci)
		default:
			rest = append(rest, ci)
		}
	}
	ordered := append(projectsFirst, trackersSecond...)
	return append(ordered, rest...), nil
}

// loadDetail 在事务内重新读取 Capture 完整状态。
func (s *Service) loadDetail(ctx context.Context, q *dbgen.Queries, captureID string) (Detail, error) {
	var out Detail
	capture, err := q.GetCapture(ctx, captureID)
	if err != nil {
		return out, apperr.Internal(err)
	}
	out.Capture = capture
	if out.Parts, err = q.ListCaptureParts(ctx, dbgen.ListCapturePartsParams{
		CaptureID: captureID, Revision: capture.Revision,
	}); err != nil {
		return out, apperr.Internal(err)
	}
	if out.Candidates, err = q.ListCaptureCandidates(ctx, dbgen.ListCaptureCandidatesParams{
		CaptureID: captureID, Revision: capture.Revision,
	}); err != nil {
		return out, apperr.Internal(err)
	}
	if out.Relations, err = q.ListCaptureRelationCandidates(ctx, dbgen.ListCaptureRelationCandidatesParams{
		CaptureID: captureID, Revision: capture.Revision,
	}); err != nil {
		return out, apperr.Internal(err)
	}
	return out, nil
}

func decodePayload(raw []byte) httpapi.CaptureDraftPayload {
	var payload httpapi.CaptureDraftPayload
	_ = json.Unmarshal(raw, &payload)
	return payload
}

// unresolvedConfirmationFields 检查用户编辑后的 payload 是否真正补齐原候选的缺失字段。
// 字段名来自 AI Schema，但最终只在受控 DTO 序列化出的对象中读取；未知字段保持未解决。
func unresolvedConfirmationFields(candidateType string, payload httpapi.CaptureDraftPayload,
	missing []string) []string {
	if len(missing) == 0 {
		return nil
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return append([]string(nil), missing...)
	}
	var wrapper map[string]any
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return append([]string(nil), missing...)
	}
	object, _ := wrapper[candidateType].(map[string]any)
	if object == nil {
		return append([]string(nil), missing...)
	}

	unresolved := make([]string, 0, len(missing))
	for _, field := range missing {
		if confirmationFieldPresent(candidateType, object, field) {
			continue
		}
		unresolved = append(unresolved, field)
	}
	return unresolved
}

func confirmationFieldPresent(candidateType string, object map[string]any, field string) bool {
	if candidateType == "record" {
		recordKey := field
		if field == "amount" {
			recordKey = "amount"
		}
		if values, ok := object["values"].([]any); ok {
			for _, rawValue := range values {
				value, _ := rawValue.(map[string]any)
				if value["key"] == recordKey &&
					(presentJSONValue(value["number_value"]) || presentJSONValue(value["text_value"])) {
					return true
				}
			}
		}
	}

	for _, candidate := range confirmationFieldCandidates(candidateType, field) {
		if presentJSONValue(readJSONPath(object, candidate)) {
			return true
		}
	}
	return false
}

func confirmationFieldCandidates(candidateType, field string) []string {
	if field == "date" {
		switch candidateType {
		case "task":
			return []string{"due_date", "due_at"}
		case "event":
			return []string{"start_date", "start_at"}
		case "project":
			return []string{"start_date", "target_date"}
		}
	}
	if field == "time" {
		switch candidateType {
		case "task":
			return []string{"due_at", "scheduled_start_at"}
		case "event":
			return []string{"start_at", "end_at"}
		}
	}
	return []string{field}
}

func readJSONPath(object map[string]any, path string) any {
	var current any = object
	for _, segment := range strings.Split(path, ".") {
		item, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = item[segment]
	}
	return current
}

func presentJSONValue(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case string:
		return strings.TrimSpace(typed) != ""
	case float64:
		return typed > 0
	case bool:
		return true
	case []any:
		return len(typed) > 0
	case map[string]any:
		return len(typed) > 0
	default:
		return true
	}
}

func resource(kind httpapi.AffectedResourceType, id string) httpapi.AffectedResource {
	res := httpapi.AffectedResource{Type: kind}
	if id != "" {
		res.Id = &id
	}
	return res
}

func affectedResourceType(objectType string) httpapi.AffectedResourceType {
	switch objectType {
	case "task":
		return httpapi.AffectedResourceTypeTask
	case "event":
		return httpapi.AffectedResourceTypeEvent
	case "project":
		return httpapi.AffectedResourceTypeProject
	case "note":
		return httpapi.AffectedResourceTypeNote
	case "tracker":
		return httpapi.AffectedResourceTypeTracker
	case "record":
		return httpapi.AffectedResourceTypeRecord
	default:
		return httpapi.AffectedResourceType(objectType)
	}
}

func optional(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

func resolveProjectRef(ref *string, created map[string]string) *string {
	if ref == nil || strings.TrimSpace(*ref) == "" {
		return nil
	}
	value := strings.TrimSpace(*ref)
	if mapped, ok := created[value]; ok {
		value = mapped
	}
	return &value
}

func intPtr(v int) *int { return &v }

var _ = time.Now
