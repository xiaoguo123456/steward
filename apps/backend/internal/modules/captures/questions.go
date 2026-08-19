package captures

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// ListQuestions 分页读取待答问题。
//
// 这是全局 AI 待答入口的权威来源：App 按 ID 读取，
// 不把问题正文复制到全局状态。
func (s *Service) ListQuestions(ctx context.Context, userID, status string,
	cursorTime *time.Time, cursorID *string, limit int32) ([]dbgen.CaptureQuestion, error) {

	var out []dbgen.CaptureQuestion
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListCaptureQuestions(ctx, dbgen.ListCaptureQuestionsParams{
			Status:          status,
			CursorCreatedAt: cursorTime,
			CursorID:        cursorID,
			RowLimit:        limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = rows
		return nil
	})
	return out, err
}

// AnswerResult 是回答问题的结果。
type AnswerResult struct {
	CaptureID   string
	OperationID string
}

// AnswerQuestion 记录用户补充说明并触发新一轮解析。
//
// 回答不会直接修改旧候选：Captures 创建新 revision 重新解析，
// 旧 revision 只保留为审计记录。
func (s *Service) AnswerQuestion(ctx context.Context, userID, questionID, answer string) (AnswerResult, error) {
	answer = strings.TrimSpace(answer)
	if answer == "" {
		return AnswerResult{}, apperr.Validation(apperr.Field("answer", "请填写补充说明。"))
	}

	var out AnswerResult
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		question, err := q.GetCaptureQuestion(ctx, questionID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这个问题")
			}
			return apperr.Internal(err)
		}
		if question.Status != "open" {
			return apperr.New(apperr.CodeCaptureQuestionResolved)
		}

		capture, err := q.GetCapture(ctx, question.CaptureID)
		if err != nil {
			return apperr.Internal(err)
		}
		if capture.Status == "confirmed" || capture.Status == "discarded" {
			return apperr.New(apperr.CodeCaptureAlreadyConfirm)
		}

		if _, err := q.AnswerCaptureQuestion(ctx, dbgen.AnswerCaptureQuestionParams{
			ID: questionID, AnswerText: &answer,
		}); err != nil {
			if database.IsNoRows(err) {
				return apperr.New(apperr.CodeCaptureQuestionResolved)
			}
			return apperr.Internal(err)
		}

		// 推进 revision：新的一轮解析基于原输入加上这次补充说明。
		bumped, err := q.BumpCaptureRevision(ctx, dbgen.BumpCaptureRevisionParams{
			ID: capture.ID, Status: "parsing",
		})
		if err != nil {
			return apperr.Internal(err)
		}

		// 复制原有输入项到新 revision，保留已有处理结果。
		if err := q.CopyCapturePartsToRevision(ctx, dbgen.CopyCapturePartsToRevisionParams{
			IDPrefix:    fmt.Sprintf("r%d-", bumped.Revision),
			CaptureID:   capture.ID,
			OldRevision: capture.Revision,
			NewRevision: bumped.Revision,
		}); err != nil {
			return apperr.Internal(err)
		}

		// 用户的补充说明本身也是一条文字输入。
		if _, err := q.CreateCapturePart(ctx, dbgen.CreateCapturePartParams{
			ID:        idgen.New(idgen.PrefixCapturePart),
			UserID:    userID,
			CaptureID: capture.ID,
			Revision:  bumped.Revision,
			Kind:      "text",
			Status:    "succeeded",
			Position:  1000,
			Text:      &answer,
		}); err != nil {
			return apperr.Internal(err)
		}

		if err := q.SupersedeCaptureQuestions(ctx, dbgen.SupersedeCaptureQuestionsParams{
			CaptureID: capture.ID, Revision: bumped.Revision,
		}); err != nil {
			return apperr.Internal(err)
		}

		op, err := q.CreateOperation(ctx, dbgen.CreateOperationParams{
			ID:     idgen.New(idgen.PrefixOperation),
			UserID: userID,
			Kind:   "capture.parse",
		})
		if err != nil {
			return apperr.Internal(err)
		}

		if err := s.jobs.EnqueueCaptureParse(ctx, q, CaptureParseArgs{
			SchemaVersion:  1,
			UserID:         userID,
			CaptureID:      capture.ID,
			Revision:       int(bumped.Revision),
			OperationID:    op.ID,
			IdempotencyKey: fmt.Sprintf("capture:%s:revision:%d:parse", capture.ID, bumped.Revision),
		}); err != nil {
			return err
		}

		out = AnswerResult{CaptureID: capture.ID, OperationID: op.ID}
		return nil
	})
	return out, err
}
