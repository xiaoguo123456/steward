// Package captures 拥有统一输入的临时域：Capture、Part、Candidate、Question 与 Conflict。
//
// 两条硬规则贯穿整个模块：
//  1. AI 只产候选，任何正式写入都必须经过用户确认后由 Go Domain 执行。
//  2. 未确认的内容不属于用户正式内容，不会出现在 Today、计划、笔记、数据与搜索中。
package captures

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// ObjectCommands 是 objects 模块公开的事务内写入能力。
type ObjectCommands interface {
	CreateTaskInTx(ctx context.Context, q *dbgen.Queries, userID string, cmd objects.CreateTaskCommand) (dbgen.Task, error)
	CreateEventInTx(ctx context.Context, q *dbgen.Queries, userID string, cmd objects.CreateEventCommand) (dbgen.Event, error)
	CreateNoteInTx(ctx context.Context, q *dbgen.Queries, userID string, cmd objects.CreateNoteCommand) (dbgen.Note, error)
	CreateProjectInTx(ctx context.Context, q *dbgen.Queries, userID string, cmd objects.CreateProjectCommand) (dbgen.Project, error)
}

// ListResolver 是 lists 模块公开的能力。
type ListResolver interface {
	ResolveListID(ctx context.Context, q *dbgen.Queries, userID string, listID *string) (string, error)
}

// UserProfile 是 users 模块公开的能力。
type UserProfile interface {
	Timezone(ctx context.Context, q *dbgen.Queries, userID string) (string, error)
}

// ActivityRecorder 是 activity 模块公开的写入能力。
type ActivityRecorder interface {
	Record(ctx context.Context, q *dbgen.Queries, userID string,
		source activity.Source, sourceID *string, entries []activity.EntryInput) (string, error)
}

// JobEnqueuer 在业务事务内登记异步任务。
//
// 必须与业务写入使用同一个事务：否则会出现 Capture 已创建但解析任务丢失，
// 用户永远停在“处理中”。
type JobEnqueuer interface {
	EnqueueCaptureParse(ctx context.Context, q *dbgen.Queries, args CaptureParseArgs) error
}

// CaptureParseArgs 是解析任务的参数。
// 它只携带引用，不包含用户正文、媒体或 Prompt。
type CaptureParseArgs struct {
	SchemaVersion  int    `json:"schema_version"`
	UserID         string `json:"user_id"`
	CaptureID      string `json:"resource_id"`
	Revision       int    `json:"resource_version"`
	IdempotencyKey string `json:"idempotency_key"`
	OperationID    string `json:"operation_id"`
}

// Service 是 Capture 的应用服务。
type Service struct {
	db       *database.DB
	parser   ai.CaptureParser
	objects  ObjectCommands
	trackers TrackerCommands
	lists    ListResolver
	users    UserProfile
	activity ActivityRecorder
	jobs     JobEnqueuer
}

// TrackerCommands 是 trackers 模块公开的事务内写入能力。
type TrackerCommands interface {
	CreateTrackerInTx(ctx context.Context, q *dbgen.Queries, userID string, name string,
		fields []httpapi.TrackerField, provenance []byte) (dbgen.Tracker, error)
	CreateRecordInTx(ctx context.Context, q *dbgen.Queries, userID, trackerID string,
		ts time.Time, values []httpapi.RecordValue, note *string, provenance []byte) (dbgen.Record, error)
}

// New 构造 Service。
func New(db *database.DB, parser ai.CaptureParser, obj ObjectCommands, trk TrackerCommands,
	lists ListResolver, users UserProfile, act ActivityRecorder, jobs JobEnqueuer) *Service {
	return &Service{
		db: db, parser: parser, objects: obj, trackers: trk,
		lists: lists, users: users, activity: act, jobs: jobs,
	}
}

// CreateResult 是提交 Capture 的结果。
type CreateResult struct {
	CaptureID   string
	OperationID string
}

// Create 保存输入并登记解析任务。
func (s *Service) Create(ctx context.Context, userID string, body httpapi.CreateCaptureRequest) (CreateResult, error) {
	if len(body.Parts) == 0 {
		return CreateResult{}, apperr.Validation(apperr.Field("parts", "至少需要一项输入。"))
	}

	var out CreateResult
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		tz, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		if body.Timezone != nil && strings.TrimSpace(*body.Timezone) != "" {
			tz = *body.Timezone
		}

		origin := "home"
		if body.Origin != nil {
			origin = string(*body.Origin)
		}

		// 只有文字时直接进入 parsing；含媒体时先进入 preprocessing。
		hasMedia := false
		for _, p := range body.Parts {
			if p.Kind != httpapi.CapturePartKindText {
				hasMedia = true
			}
		}
		status := "parsing"
		if hasMedia {
			status = "preprocessing"
		}

		capture, err := q.CreateCapture(ctx, dbgen.CreateCaptureParams{
			ID:                 idgen.New(idgen.PrefixCapture),
			UserID:             userID,
			Status:             status,
			Origin:             origin,
			SuggestedProjectID: body.SuggestedProjectId,
			Timezone:           tz,
		})
		if err != nil {
			return apperr.Internal(err)
		}

		for i, p := range body.Parts {
			kind := string(p.Kind)
			partStatus := "succeeded"
			if kind != "text" {
				// 媒体项等待 Worker 处理；当前没有接入真实转写与 OCR。
				partStatus = "pending"
			}
			if kind == "text" && (p.Text == nil || strings.TrimSpace(*p.Text) == "") {
				return apperr.Validation(apperr.Field("parts", "文字输入不能为空。"))
			}
			if kind != "text" && (p.MediaId == nil || *p.MediaId == "") {
				return apperr.Validation(apperr.Field("parts", "音频与图片输入必须提供 media_id。"))
			}
			if _, err := q.CreateCapturePart(ctx, dbgen.CreateCapturePartParams{
				ID:        idgen.New(idgen.PrefixCapturePart),
				UserID:    userID,
				CaptureID: capture.ID,
				Revision:  capture.Revision,
				Kind:      kind,
				Status:    partStatus,
				Position:  int32(i),
				Text:      p.Text,
				MediaID:   p.MediaId,
			}); err != nil {
				return apperr.Internal(err)
			}
		}

		op, err := q.CreateOperation(ctx, dbgen.CreateOperationParams{
			ID:     idgen.New(idgen.PrefixOperation),
			UserID: userID,
			Kind:   "capture.parse",
		})
		if err != nil {
			return apperr.Internal(err)
		}

		// 与业务写入同一事务入队，避免业务成功而任务丢失。
		if err := s.jobs.EnqueueCaptureParse(ctx, q, CaptureParseArgs{
			SchemaVersion:  1,
			UserID:         userID,
			CaptureID:      capture.ID,
			Revision:       int(capture.Revision),
			OperationID:    op.ID,
			IdempotencyKey: fmt.Sprintf("capture:%s:revision:%d:parse", capture.ID, capture.Revision),
		}); err != nil {
			return err
		}

		out = CreateResult{CaptureID: capture.ID, OperationID: op.ID}
		return nil
	})
	return out, err
}

// RunParse 执行一次解析任务。Worker 调用它。
//
// 外部 Provider 调用不在数据库事务内：先用短事务读上下文，
// 事务外调用 Provider，再用短事务保存结果。
func (s *Service) RunParse(ctx context.Context, args CaptureParseArgs) error {
	// 第一步：短事务读取上下文。
	var (
		capture  dbgen.Capture
		parts    []dbgen.CapturePart
		lists    []ai.ListRef
		trackers []ai.TrackerRef
		skip     bool
	)
	err := s.db.InTx(ctx, args.UserID, func(ctx context.Context, q *dbgen.Queries) error {
		if done, err := q.GetProcessedJob(ctx, args.IdempotencyKey); err == nil && done.IdempotencyKey != "" {
			// 同一 revision 已经解析过，迟到重试不产生第二次效果。
			skip = true
			return nil
		} else if err != nil && !database.IsNoRows(err) {
			return apperr.Internal(err)
		}

		c, err := q.GetCapture(ctx, args.CaptureID)
		if err != nil {
			if database.IsNoRows(err) {
				skip = true
				return nil
			}
			return apperr.Internal(err)
		}
		// revision 已推进说明有更新的解析在跑，本次结果作废。
		if int(c.Revision) != args.Revision || c.Status == "discarded" || c.Status == "confirmed" {
			skip = true
			return nil
		}
		capture = c

		parts, err = q.ListCaptureParts(ctx, dbgen.ListCapturePartsParams{
			CaptureID: args.CaptureID, Revision: c.Revision,
		})
		if err != nil {
			return apperr.Internal(err)
		}

		listRows, err := q.ListTaskLists(ctx, false)
		if err != nil {
			return apperr.Internal(err)
		}
		for _, l := range listRows {
			lists = append(lists, ai.ListRef{ID: l.ID, Name: l.Name, IsDefault: l.IsDefault})
		}

		trackerRows, err := q.ListTrackers(ctx, strPtr("active"))
		if err != nil {
			return apperr.Internal(err)
		}
		for _, t := range trackerRows {
			var fields []httpapi.TrackerField
			if err := json.Unmarshal(t.Fields, &fields); err != nil {
				continue
			}
			ref := ai.TrackerRef{ID: t.ID, Name: t.Name}
			for _, f := range fields {
				unit := ""
				if f.Unit != nil {
					unit = *f.Unit
				}
				ref.Fields = append(ref.Fields, ai.TrackerFieldRef{
					Key: f.Key, Label: f.Label, Type: string(f.Type), Unit: unit,
				})
			}
			trackers = append(trackers, ref)
		}
		return nil
	})
	if err != nil || skip {
		return err
	}

	// 第二步：事务外调用 Provider。
	req := ai.CaptureParseRequest{
		RunID:    idgen.New(idgen.PrefixRun),
		Timezone: capture.Timezone,
		Now:      time.Now(),
		Lists:    lists,
		Trackers: trackers,
	}
	for _, p := range parts {
		text := ""
		if p.Text != nil {
			text = *p.Text
		}
		req.Parts = append(req.Parts, ai.InputPart{
			ID: p.ID, Kind: ai.PartKind(p.Kind), Position: int(p.Position), Text: text,
		})
	}

	result, parseErr := s.parser.ParseCapture(ctx, req)

	// 第三步：短事务保存结果。
	return s.db.InTx(ctx, args.UserID, func(ctx context.Context, q *dbgen.Queries) error {
		if parseErr != nil {
			errBody, _ := json.Marshal(map[string]any{
				"code":      string(apperr.CodeAIProviderUnavailable),
				"message":   "智能整理暂时不可用，你仍然可以手动填写。",
				"retryable": true,
			})
			if _, err := q.UpdateCaptureStatus(ctx, dbgen.UpdateCaptureStatusParams{
				ID: args.CaptureID, Status: "failed", Error: errBody,
			}); err != nil {
				return apperr.Internal(err)
			}
			return s.finishOperation(ctx, q, args, "failed", errBody, nil)
		}

		if err := s.saveParseResult(ctx, q, args, capture, result); err != nil {
			return err
		}
		return nil
	})
}

// saveParseResult 把解析结果落库并推进 Capture 状态。
func (s *Service) saveParseResult(ctx context.Context, q *dbgen.Queries,
	args CaptureParseArgs, capture dbgen.Capture, result ai.CaptureParseResult) error {

	loc := timeutil.LoadLocation(capture.Timezone)
	defaultListID := ""
	if id, err := s.lists.ResolveListID(ctx, q, args.UserID, nil); err == nil {
		defaultListID = id
	}

	for i, c := range result.Candidates {
		payload, missing, err := buildPayload(c, defaultListID, loc)
		if err != nil {
			return err
		}
		confidences, err := json.Marshal(mapConfidences(c.Confidences))
		if err != nil {
			return apperr.Internal(err)
		}
		sources, err := json.Marshal(mapSources(c.Sources))
		if err != nil {
			return apperr.Internal(err)
		}
		warnings := c.Warnings
		if warnings == nil {
			warnings = []string{}
		}
		if missing == nil {
			missing = []string{}
		}

		if _, err := q.CreateCaptureCandidate(ctx, dbgen.CreateCaptureCandidateParams{
			ID:               idgen.New(idgen.PrefixCandidate),
			UserID:           args.UserID,
			CaptureID:        capture.ID,
			Revision:         capture.Revision,
			CandidateType:    c.Type,
			Action:           c.Action,
			Selected:         len(missing) == 0,
			Payload:          payload,
			FieldConfidences: confidences,
			SourceRefs:       sources,
			MissingFields:    missing,
			Warnings:         warnings,
			Position:         int32(i),
		}); err != nil {
			return apperr.Internal(err)
		}
	}

	for _, conflict := range result.Conflicts {
		options, err := json.Marshal(mapConflictOptions(conflict.Options))
		if err != nil {
			return apperr.Internal(err)
		}
		if err := q.CreateCaptureConflict(ctx, dbgen.CreateCaptureConflictParams{
			ID:          idgen.New(idgen.PrefixCaptureConflict),
			UserID:      args.UserID,
			CaptureID:   capture.ID,
			Revision:    capture.Revision,
			Field:       conflict.Field,
			Description: conflict.Description,
			Options:     options,
		}); err != nil {
			return apperr.Internal(err)
		}
	}

	blocking := false
	summary := captureSummary(result)
	for _, question := range result.Questions {
		if question.Blocking {
			blocking = true
		}
		answers := question.QuickAnswers
		if answers == nil {
			answers = []string{}
		}
		qSummary := question.Summary
		if qSummary == "" {
			qSummary = summary
		}
		if _, err := q.CreateCaptureQuestion(ctx, dbgen.CreateCaptureQuestionParams{
			ID:             idgen.New(idgen.PrefixCaptureQuestion),
			UserID:         args.UserID,
			CaptureID:      capture.ID,
			Revision:       capture.Revision,
			Question:       question.Question,
			Blocking:       question.Blocking,
			QuickAnswers:   answers,
			CaptureSummary: qSummary,
		}); err != nil {
			return apperr.Internal(err)
		}
	}

	status := "needs_confirmation"
	if blocking {
		status = "awaiting_instruction"
	}
	var instruction *string
	if result.InstructionNote != "" {
		instruction = &result.InstructionNote
	}
	if _, err := q.UpdateCaptureStatus(ctx, dbgen.UpdateCaptureStatusParams{
		ID: capture.ID, Status: status, InstructionNote: instruction,
	}); err != nil {
		return apperr.Internal(err)
	}

	resultRef, _ := json.Marshal(map[string]any{
		"type":       "capture",
		"capture_id": capture.ID,
		"revision":   capture.Revision,
	})
	return s.finishOperation(ctx, q, args, "succeeded", nil, resultRef)
}

// finishOperation 更新异步任务状态并登记幂等结果。
func (s *Service) finishOperation(ctx context.Context, q *dbgen.Queries,
	args CaptureParseArgs, status string, errBody, resultRef []byte) error {

	progress := int32(100)
	if _, err := q.UpdateOperationStatus(ctx, dbgen.UpdateOperationStatusParams{
		ID: args.OperationID, Status: status, Progress: &progress,
		ResultRef: resultRef, Error: errBody,
	}); err != nil {
		return apperr.Internal(err)
	}
	if err := q.SaveProcessedJob(ctx, dbgen.SaveProcessedJobParams{
		IdempotencyKey: args.IdempotencyKey,
		UserID:         args.UserID,
		Kind:           "capture.parse",
		ResultRef:      resultRef,
	}); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

// Detail 是 Capture 的完整读模型。
type Detail struct {
	Capture    dbgen.Capture
	Parts      []dbgen.CapturePart
	Candidates []dbgen.CaptureCandidate
	Questions  []dbgen.CaptureQuestion
	Conflicts  []dbgen.CaptureConflict
	Created    []httpapi.AffectedResource
}

// Get 读取 Capture 状态与候选。
func (s *Service) Get(ctx context.Context, userID, captureID string) (Detail, error) {
	var out Detail
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		capture, err := q.GetCapture(ctx, captureID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这次输入")
			}
			return apperr.Internal(err)
		}
		out.Capture = capture

		if out.Parts, err = q.ListCaptureParts(ctx, dbgen.ListCapturePartsParams{
			CaptureID: captureID, Revision: capture.Revision,
		}); err != nil {
			return apperr.Internal(err)
		}
		if out.Candidates, err = q.ListCaptureCandidates(ctx, dbgen.ListCaptureCandidatesParams{
			CaptureID: captureID, Revision: capture.Revision,
		}); err != nil {
			return apperr.Internal(err)
		}
		if out.Questions, err = q.ListCaptureQuestionsForCapture(ctx, dbgen.ListCaptureQuestionsForCaptureParams{
			CaptureID: captureID, Revision: capture.Revision,
		}); err != nil {
			return apperr.Internal(err)
		}
		if out.Conflicts, err = q.ListCaptureConflicts(ctx, dbgen.ListCaptureConflictsParams{
			CaptureID: captureID, Revision: capture.Revision,
		}); err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
	return out, err
}

// Discard 放弃本次输入。
func (s *Service) Discard(ctx context.Context, userID, captureID string) error {
	return s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		capture, err := q.GetCapture(ctx, captureID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这次输入")
			}
			return apperr.Internal(err)
		}
		if capture.Status == "confirmed" {
			return apperr.New(apperr.CodeCaptureAlreadyConfirm)
		}
		if _, err := q.UpdateCaptureStatus(ctx, dbgen.UpdateCaptureStatusParams{
			ID: captureID, Status: "discarded",
		}); err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
}

func strPtr(v string) *string { return &v }
