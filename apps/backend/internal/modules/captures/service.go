// Package captures 拥有统一输入的临时域：Capture、Part、Candidate、Question 与 Conflict。
//
// 两条硬规则贯穿整个模块：
//  1. AI 只产候选，任何正式写入都必须经过用户确认后由 Go Domain 执行。
//  2. 未确认的内容不属于用户正式内容，不会出现在 Today、计划、笔记、数据与搜索中。
package captures

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/aiaudit"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	authpkg "github.com/guoxiaozheng1/steward/apps/backend/internal/platform/auth"
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
	UpdateTaskCommandInTx(ctx context.Context, q *dbgen.Queries, userID, taskID string, body httpapi.UpdateTaskRequest, expectedVersion int32) (dbgen.Task, error)
	UpdateEventCommandInTx(ctx context.Context, q *dbgen.Queries, userID, eventID string, body httpapi.UpdateEventRequest, expectedVersion int32) (dbgen.Event, error)
	UpdateNoteCommandInTx(ctx context.Context, q *dbgen.Queries, userID, noteID string, body httpapi.UpdateNoteRequest, expectedVersion int32) (dbgen.Note, error)
	UpdateProjectCommandInTx(ctx context.Context, q *dbgen.Queries, userID, projectID string, body httpapi.UpdateProjectRequest, expectedVersion int32) (dbgen.Project, error)
}

// ListResolver 是 lists 模块公开的能力。
type ListResolver interface {
	ResolveListID(ctx context.Context, q *dbgen.Queries, userID string, listID *string) (string, error)
}

// UserProfile 是 users 模块公开的能力。
type UserProfile interface {
	Timezone(ctx context.Context, q *dbgen.Queries, userID string) (string, error)
	AiSettingsInTx(ctx context.Context, q *dbgen.Queries, userID string) (dbgen.UserAiSetting, error)
}

// ActivityRecorder 是 activity 模块公开的写入能力。
type ActivityRecorder interface {
	Record(ctx context.Context, q *dbgen.Queries, userID string,
		source activity.Source, sourceID *string, entries []activity.EntryInput) (string, error)
}

// MediaReader 是 media 模块公开的读取能力。
type MediaReader interface {
	ResolveForParse(ctx context.Context, userID, mediaID string) (dbgen.MediaAsset, error)
	ReadBytes(ctx context.Context, objectKey string, limit int64) ([]byte, error)
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
	db     *database.DB
	parser ai.CaptureParser
	media  MediaReader
	// processor 为空时不做 OCR 与转写，媒体输入项会被标记为失败并提示用户改用文字。
	processor ai.MediaProcessor
	objects   ObjectCommands
	trackers  TrackerCommands
	lists     ListResolver
	users     UserProfile
	activity  ActivityRecorder
	jobs      JobEnqueuer
	// audit 记录每一次模型调用的形状。为空时不记录。
	audit *aiaudit.Recorder
}

// TrackerCommands 是 trackers 模块公开的事务内写入能力。
type TrackerCommands interface {
	CreateTrackerInTx(ctx context.Context, q *dbgen.Queries, userID string, name string,
		fields []httpapi.TrackerField, provenance []byte) (dbgen.Tracker, error)
	CreateRecordInTx(ctx context.Context, q *dbgen.Queries, userID, trackerID string,
		ts time.Time, values []httpapi.RecordValue, note *string, provenance []byte) (dbgen.Record, error)
	UpdateTrackerCommandInTx(ctx context.Context, q *dbgen.Queries, userID, trackerID string,
		body httpapi.UpdateTrackerRequest, expectedVersion int32) (dbgen.Tracker, error)
	UpdateRecordCommandInTx(ctx context.Context, q *dbgen.Queries, userID, recordID string,
		body httpapi.UpdateRecordRequest, expectedVersion int32) (dbgen.GetRecordRow, error)
}

// New 构造 Service。
func New(db *database.DB, parser ai.CaptureParser, processor ai.MediaProcessor,
	mediaReader MediaReader, obj ObjectCommands, trk TrackerCommands,
	lists ListResolver, users UserProfile, act ActivityRecorder, jobs JobEnqueuer,
	audit *aiaudit.Recorder) *Service {
	return &Service{
		db: db, parser: parser, processor: processor, media: mediaReader,
		objects: obj, trackers: trk,
		lists: lists, users: users, activity: act, jobs: jobs, audit: audit,
	}
}

// CreateResult 是提交 Capture 的结果。
type CreateResult struct {
	CaptureID   string
	OperationID string
}

// Create 保存输入并登记解析任务。
func (s *Service) Create(ctx context.Context, userID, idempotencyKey string, body httpapi.CreateCaptureRequest) (CreateResult, error) {
	if len(body.Parts) == 0 {
		return CreateResult{}, apperr.Validation(apperr.Field("parts", "至少需要一项输入。"))
	}
	if idempotencyKey == "" {
		return CreateResult{}, apperr.New(apperr.CodeIdempotencyKeyReq)
	}
	rawBody, err := json.Marshal(body)
	if err != nil {
		return CreateResult{}, apperr.Internal(err)
	}
	requestHash := authpkg.HashToken(string(rawBody))

	var out CreateResult
	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if err := q.AcquireIdempotencyLock(ctx,
			"captures.create:"+userID+":"+idempotencyKey); err != nil {
			return apperr.Internal(err)
		}
		replayed, err := q.GetIdempotencyRecord(ctx, dbgen.GetIdempotencyRecordParams{
			UserID: userID, Endpoint: "captures.create", Key: idempotencyKey,
		})
		if err == nil {
			if subtle.ConstantTimeCompare(replayed.RequestHash, requestHash) != 1 {
				return apperr.New(apperr.CodeIdempotencyReused)
			}
			if err := json.Unmarshal(replayed.ResponseBody, &out); err != nil {
				return apperr.Internal(err)
			}
			return nil
		}
		if !database.IsNoRows(err) {
			return apperr.Internal(err)
		}

		tz, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		if body.Timezone != nil && strings.TrimSpace(*body.Timezone) != "" {
			tz = *body.Timezone
		}
		// 解析「明天」「下周三」全靠这个时区，坏值会让相对时间整体偏一天。
		if err := timeutil.ValidateLocation(tz); err != nil {
			return apperr.Validation(apperr.Field("timezone", "时区名称不合法。"))
		}
		if body.SuggestedProjectId != nil {
			if _, err := q.GetProject(ctx, *body.SuggestedProjectId); err != nil {
				if database.IsNoRows(err) {
					return apperr.NotFound("项目")
				}
				return apperr.Internal(err)
			}
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
			if kind == "text" && (p.Text == nil || !ai.HasVisibleText(*p.Text)) {
				return apperr.Validation(apperr.Field("parts", "文字输入不能为空。"))
			}
			if kind != "text" && (p.MediaId == nil || *p.MediaId == "") {
				return apperr.Validation(apperr.Field("parts", "音频与图片输入必须提供 media_id。"))
			}
			if kind != "text" {
				// 媒体必须确实存在、属于当前用户且已完成上传。
				// RLS 保证跨用户不可见，这里再确认状态，避免引用到半成品对象。
				asset, err := q.GetMediaAsset(ctx, *p.MediaId)
				if err != nil {
					if database.IsNoRows(err) {
						return apperr.Validation(apperr.Field("parts", "引用的文件不存在，请重新上传。"))
					}
					return apperr.Internal(err)
				}
				if asset.Status != "uploaded" {
					return apperr.Validation(apperr.Field("parts", "文件还没有上传完成，请稍候再提交。"))
				}
				if asset.Kind != kind {
					return apperr.Validation(apperr.Field("parts", "文件类型与输入类型不一致。"))
				}
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
		responseBody, err := json.Marshal(out)
		if err != nil {
			return apperr.Internal(err)
		}
		if err := q.SaveIdempotencyRecord(ctx, dbgen.SaveIdempotencyRecordParams{
			UserID: userID, Endpoint: "captures.create", Key: idempotencyKey,
			RequestHash: requestHash, StatusCode: 202, ResponseBody: responseBody,
			ResourceID: &capture.ID, ExpiresAt: time.Now().Add(24 * time.Hour),
		}); err != nil {
			return apperr.Internal(err)
		}
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
		capture        dbgen.Capture
		parts          []dbgen.CapturePart
		clarifications []dbgen.CaptureQuestion
		lists          []ai.ListRef
		trackers       []ai.TrackerRef
		skip           bool
		// parseEnabled 为 false 时整轮不调用模型：用户在设置里关掉了智能整理，
		// 那就只保留原始输入，让他自己填。
		parseEnabled bool
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

		settings, err := s.users.AiSettingsInTx(ctx, q, args.UserID)
		if err != nil {
			return err
		}
		parseEnabled = settings.CaptureParseEnabled

		parts, err = q.ListCaptureParts(ctx, dbgen.ListCapturePartsParams{
			CaptureID: args.CaptureID, Revision: c.Revision,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		clarifications, err = q.ListAnsweredCaptureQuestionsForCapture(ctx,
			dbgen.ListAnsweredCaptureQuestionsForCaptureParams{
				CaptureID: args.CaptureID, ActiveRevision: c.Revision,
			})
		if err != nil {
			return apperr.Internal(err)
		}

		listRows, err := q.ListTaskListsByKind(ctx, dbgen.ListTaskListsByKindParams{
			IncludeArchived: false,
			ListKind:        "tasks",
		})
		if err != nil {
			return apperr.Internal(err)
		}
		for _, l := range listRows {
			lists = append(lists, ai.ListRef{ID: l.ID, Name: l.Name, IsDefault: l.IsDefault})
		}

		trackerRows, err := q.ListTrackers(ctx, dbgen.ListTrackersParams{Status: strPtr("active")})
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
					Required: f.Required,
				})
			}
			trackers = append(trackers, ref)
		}
		return nil
	})
	if err != nil || skip {
		return err
	}

	// 关掉智能整理时到此为止：不做 OCR、不做转写、不调用解析模型。
	// Capture 直接进入待确认，用户在确认页手工填写。
	if !parseEnabled {
		return s.finishWithoutParse(ctx, args, capture)
	}

	// 第二步：事务外完成媒体预处理。
	// 这一步对应状态机里的 preprocessing：先把图片与音频转成文字，再统一理解。
	parts = s.preprocessMedia(ctx, args, parts)
	if err := ctx.Err(); err != nil {
		return err
	}
	if status := mediaPreprocessStatus(parts); status != "" {
		return s.finishMediaPreprocessBlocked(ctx, args, capture, status)
	}

	// 第三步：事务外调用 Provider 做结构化解析。
	req := ai.CaptureParseRequest{
		RunID:          idgen.New(idgen.PrefixRun),
		Timezone:       capture.Timezone,
		Now:            time.Now(),
		Lists:          lists,
		Trackers:       trackers,
		Clarifications: buildCaptureClarifications(parts, clarifications),
	}
	if capture.SuggestedProjectID != nil {
		req.SuggestedProjectID = *capture.SuggestedProjectID
	}
	for _, p := range parts {
		text := ""
		if p.Text != nil {
			text = *p.Text
		}
		req.Parts = append(req.Parts, ai.InputPart{
			ID: p.ID, Kind: ai.PartKind(p.Kind), Position: int(p.Position), Text: text,
			MediaID: valueOrEmpty(p.MediaID),
		})
	}

	result, parseErr := s.parser.ParseCapture(ctx, req)

	// 记一笔审计。**只记形状不记正文**：输入输出都压成哈希，
	// 想知道用户说了什么去看他自己的 Capture，那份有 RLS 管着。
	s.audit.Record(ctx, aiaudit.Entry{
		UserID:  args.UserID,
		Feature: aiaudit.FeatureCapture,
		// 用 Capture 自己的 ID 当 run_id：一次整理就是一次运行，
		// 出问题时能直接从审计跳回那条 Capture。
		RunID:         args.CaptureID,
		EngineType:    "single_shot",
		Provider:      s.parser.Name(),
		ModelPolicy:   "parse",
		ProviderModel: result.ProviderModel,
		PromptVersion: result.PromptVersion,
		SchemaVersion: result.SchemaVersion,
		InputRefs:     partIDs(parts),
		InputHash:     aiaudit.Hash(captureParseInputTexts(req)...),
		OutputHash:    hashCandidates(result.Candidates),
		Status:        aiaudit.StatusFor(parseErr),
		ErrorClass:    aiaudit.ClassifyError(parseErr),
		Usage:         result.Usage,
	})

	// 第四步：短事务保存结果。
	return s.db.InTx(ctx, args.UserID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetCaptureForUpdate(ctx, args.CaptureID)
		if err != nil {
			if database.IsNoRows(err) {
				return nil
			}
			return apperr.Internal(err)
		}
		// Provider 调用期间用户可能放弃、确认，或补充说明推进 revision。
		// 必须在持有行锁时重新校验，迟到结果只能结束自己的 Operation，不能覆盖权威状态。
		if int(current.Revision) != args.Revision || isCaptureTerminal(current.Status) {
			resultRef, _ := json.Marshal(map[string]any{
				"type": "capture_parse_superseded", "capture_id": args.CaptureID,
				"requested_revision": args.Revision, "active_revision": current.Revision,
			})
			return s.finishOperation(ctx, q, args, "succeeded", nil, resultRef)
		}
		capture = current
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

		if err := s.saveParseResult(ctx, q, args, capture, parts, trackers, result); err != nil {
			return err
		}
		return nil
	})
}

const clarificationPartPositionBase int32 = 1000

func clarificationPartPosition(questionRevision int32) int32 {
	return clarificationPartPositionBase + questionRevision
}

// buildCaptureClarifications 恢复按时间正序的“问题—回答”上下文。
//
// 新数据使用 1000 + Question revision 精确绑定回答 Part。旧数据曾把所有回答都放在
// position=1000，这里按回答正文匹配尚未使用的 Part，使升级后的首轮重试也不会继续把
// 历史回答倒序送给模型。正文只在内存中比较，不进入日志。
func buildCaptureClarifications(parts []dbgen.CapturePart,
	questions []dbgen.CaptureQuestion) []ai.CaptureClarification {

	used := make(map[string]struct{}, len(questions))
	findPart := func(question dbgen.CaptureQuestion) *dbgen.CapturePart {
		if question.AnswerText == nil {
			return nil
		}
		expectedPosition := clarificationPartPosition(question.Revision)
		for i := range parts {
			part := &parts[i]
			if part.Kind == "text" && part.Position == expectedPosition &&
				part.Text != nil && *part.Text == *question.AnswerText {
				return part
			}
		}
		for i := range parts {
			part := &parts[i]
			if _, exists := used[part.ID]; exists {
				continue
			}
			if part.Kind == "text" && part.Position >= clarificationPartPositionBase &&
				part.Text != nil && *part.Text == *question.AnswerText {
				return part
			}
		}
		return nil
	}

	out := make([]ai.CaptureClarification, 0, len(questions))
	for _, question := range questions {
		if question.AnswerText == nil || strings.TrimSpace(*question.AnswerText) == "" {
			continue
		}
		item := ai.CaptureClarification{
			Question: question.Question,
			Answer:   *question.AnswerText,
		}
		if part := findPart(question); part != nil {
			item.AnswerPartID = part.ID
			used[part.ID] = struct{}{}
		}
		out = append(out, item)
	}
	return out
}

// finishMediaPreprocessBlocked 在媒体失败时结束本轮 Operation，并阻断解析器。
//
// partially_failed 是一次成功抵达、但需要用户处理的业务状态，因此 Operation
// 正常结束并返回 Capture 引用；全部媒体均不可用时才把 Operation 标记为 failed。
func (s *Service) finishMediaPreprocessBlocked(ctx context.Context, args CaptureParseArgs,
	capture dbgen.Capture, status string) error {

	return s.db.InTx(ctx, args.UserID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetCaptureForUpdate(ctx, capture.ID)
		if err != nil {
			if database.IsNoRows(err) {
				return nil
			}
			return apperr.Internal(err)
		}
		if int(current.Revision) != args.Revision || isCaptureTerminal(current.Status) {
			resultRef, _ := json.Marshal(map[string]any{
				"type": "capture_parse_superseded", "capture_id": args.CaptureID,
				"requested_revision": args.Revision, "active_revision": current.Revision,
			})
			return s.finishOperation(ctx, q, args, "succeeded", nil, resultRef)
		}
		capture = current

		var errBody []byte
		if status == "failed" {
			errBody, _ = json.Marshal(map[string]any{
				"code":      string(apperr.CodeValidationFailed),
				"message":   "所有媒体都处理失败了，请重试或替换失败项。",
				"retryable": true,
			})
		}
		if _, err := q.UpdateCaptureStatus(ctx, dbgen.UpdateCaptureStatusParams{
			ID: capture.ID, Status: status, Error: errBody,
		}); err != nil {
			return apperr.Internal(err)
		}

		resultRef, _ := json.Marshal(map[string]any{
			"type":       "capture",
			"capture_id": capture.ID,
			"revision":   capture.Revision,
		})
		operationStatus := "succeeded"
		if status == "failed" {
			operationStatus = "failed"
		}
		return s.finishOperation(ctx, q, args, operationStatus, errBody, resultRef)
	})
}

// finishWithoutParse 在用户关闭智能整理时收尾。
//
// 原始输入照常保留，只是没有候选：确认页会是一张空表单，
// 用户自己填。这比假装整理过、却给不出任何结果要诚实。
func (s *Service) finishWithoutParse(ctx context.Context, args CaptureParseArgs,
	capture dbgen.Capture) error {

	return s.db.InTx(ctx, args.UserID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetCaptureForUpdate(ctx, capture.ID)
		if err != nil {
			if database.IsNoRows(err) {
				return nil
			}
			return apperr.Internal(err)
		}
		if int(current.Revision) != args.Revision || isCaptureTerminal(current.Status) {
			resultRef, _ := json.Marshal(map[string]any{
				"type": "capture_parse_superseded", "capture_id": args.CaptureID,
				"requested_revision": args.Revision, "active_revision": current.Revision,
			})
			return s.finishOperation(ctx, q, args, "succeeded", nil, resultRef)
		}
		capture = current
		// 媒体项标记为 ignored：它们没有被识别过，界面不该显示成"处理中"。
		if err := q.IgnoreUnprocessedParts(ctx, dbgen.IgnoreUnprocessedPartsParams{
			CaptureID: capture.ID, Revision: capture.Revision,
		}); err != nil {
			return apperr.Internal(err)
		}
		note := "智能整理已关闭，这次输入原样保留，请手动填写。"
		if _, err := q.UpdateCaptureStatus(ctx, dbgen.UpdateCaptureStatusParams{
			ID: capture.ID, Status: "needs_confirmation", InstructionNote: &note,
		}); err != nil {
			return apperr.Internal(err)
		}
		resultRef, _ := json.Marshal(map[string]any{
			"type":       "capture",
			"capture_id": capture.ID,
			"revision":   capture.Revision,
		})
		return s.finishOperation(ctx, q, args, "succeeded", nil, resultRef)
	})
}

// saveParseResult 把解析结果落库并推进 Capture 状态。
func (s *Service) saveParseResult(ctx context.Context, q *dbgen.Queries,
	args CaptureParseArgs, capture dbgen.Capture, parts []dbgen.CapturePart,
	trackers []ai.TrackerRef, result ai.CaptureParseResult) error {

	loc := timeutil.LoadLocation(capture.Timezone)
	defaultListID := ""
	if id, err := s.lists.ResolveListID(ctx, q, args.UserID, nil); err == nil {
		defaultListID = id
	}
	sourceMedia := make(map[string]string, len(parts))
	candidateRefs := make(map[string]string, len(result.Candidates))
	for _, part := range parts {
		if part.Kind == "image" && part.MediaID != nil && *part.MediaID != "" {
			sourceMedia[part.ID] = *part.MediaID
		}
	}

	for i, c := range result.Candidates {
		payload, missing, err := buildPayload(c, defaultListID, loc, sourceMedia, trackers)
		if err != nil {
			return err
		}
		if c.Action == "" {
			c.Action = "create"
		}
		var duplicateOf *string
		if c.Action == "create" {
			match, err := s.detectDuplicate(ctx, q, args.UserID, c.Type, decodePayload(payload))
			if err != nil {
				return err
			}
			if match != nil {
				duplicateOf = &match.id
				// 保存用户看到重复提示时的版本；选择“更新原内容”必须按此版本 CAS。
				c.TargetID = match.id
				c.TargetExpectedVersion = &match.version
			}
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

		candidateID := idgen.New(idgen.PrefixCandidate)
		if strings.TrimSpace(c.Ref) != "" {
			if _, exists := candidateRefs[c.Ref]; exists {
				return apperr.Validation(apperr.Field("candidates", "候选引用不能重复。"))
			}
			candidateRefs[c.Ref] = candidateID
		}
		if c.Action == "update" && (strings.TrimSpace(c.TargetID) == "" || c.TargetExpectedVersion == nil) {
			missing = appendMissing(missing, "target_id")
		}
		if _, err := q.CreateCaptureCandidate(ctx, dbgen.CreateCaptureCandidateParams{
			ID:                    candidateID,
			UserID:                args.UserID,
			CaptureID:             capture.ID,
			Revision:              capture.Revision,
			CandidateType:         c.Type,
			Action:                c.Action,
			TargetID:              optional(strings.TrimSpace(c.TargetID)),
			TargetExpectedVersion: c.TargetExpectedVersion,
			Selected:              len(missing) == 0,
			Payload:               payload,
			FieldConfidences:      confidences,
			SourceRefs:            sources,
			MissingFields:         missing,
			Warnings:              warnings,
			DuplicateOf:           duplicateOf,
			Position:              int32(i),
		}); err != nil {
			return apperr.Internal(err)
		}
	}

	for _, relation := range result.Relations {
		fromRef := relation.FromRef
		if mapped, ok := candidateRefs[fromRef]; ok {
			fromRef = mapped
		}
		toRef := relation.ToRef
		if mapped, ok := candidateRefs[toRef]; ok {
			toRef = mapped
		}
		if fromRef == "" || toRef == "" || fromRef == toRef {
			return apperr.Validation(apperr.Field("relations", "关系端点不合法。"))
		}
		if relation.Kind != "requires" && relation.Kind != "related_to" {
			return apperr.Validation(apperr.Field("relations", "关系类型不合法。"))
		}
		if err := q.CreateCaptureRelationCandidate(ctx, dbgen.CreateCaptureRelationCandidateParams{
			ID: idgen.New(idgen.PrefixRelation), UserID: args.UserID,
			CaptureID: capture.ID, Revision: capture.Revision,
			Kind: relation.Kind, FromRef: fromRef, ToRef: toRef,
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
	if len(result.Candidates) == 0 && len(result.Questions) == 0 {
		status = "discarded"
	}
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
	Relations  []dbgen.CaptureRelationCandidate
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
		if out.Relations, err = q.ListCaptureRelationCandidates(ctx, dbgen.ListCaptureRelationCandidatesParams{
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
		// 与确认和 Worker 收尾共用 Capture 行锁，避免检查状态后被并发写入穿透。
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
		if _, err := q.UpdateCaptureStatus(ctx, dbgen.UpdateCaptureStatusParams{
			ID: captureID, Status: "discarded",
		}); err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
}

func strPtr(v string) *string { return &v }

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func isCaptureTerminal(status string) bool {
	switch status {
	case "confirmed", "discarded", "expired":
		return true
	default:
		return false
	}
}

// partIDs 取输入项 ID，用于把审计指回具体的分片。ID 不是正文。
func partIDs(parts []dbgen.CapturePart) []string {
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		out = append(out, p.ID)
	}
	return out
}

// captureParseInputTexts 取完整解析上下文，**只用于当场算哈希**，不会被存下来。
// 问题也属于模型输入；纳入哈希后，相同回答针对不同问题不会被误判为同一次输入。
func captureParseInputTexts(req ai.CaptureParseRequest) []string {
	out := make([]string, 0, len(req.Parts)+len(req.Clarifications)*2)
	for _, p := range req.Parts {
		out = append(out, p.Text)
	}
	for _, clarification := range req.Clarifications {
		out = append(out, clarification.Question, clarification.Answer)
	}
	return out
}

// hashCandidates 用候选的类型与标题算摘要。
//
// 摘要的用途是「两次解析结果一不一样」，所以取能代表结果的少数字段即可；
// 把整个候选序列化进去反而会因为 ID 每次不同而永远不相等。
func hashCandidates(candidates []ai.CandidateDraft) []byte {
	if len(candidates) == 0 {
		return nil
	}
	parts := make([]string, 0, len(candidates)*2)
	for _, c := range candidates {
		parts = append(parts, string(c.Type), c.Title)
	}
	return aiaudit.Hash(parts...)
}
