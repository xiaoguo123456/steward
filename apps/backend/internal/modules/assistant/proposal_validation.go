package assistant

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

// validateDraftEvidence 从权威 Turn 和只读工具审计重建证据，不相信引擎自报来源。
func validateDraftEvidence(ctx context.Context, q *dbgen.Queries, threadID, turnID string, draft ai.ProposalDraft) error {
	turn, err := q.GetTurn(ctx, turnID)
	if err != nil {
		if database.IsNoRows(err) {
			return apperr.New(apperr.CodeAISourceInvalid)
		}
		return apperr.Internal(err)
	}
	if turn.ThreadID != threadID {
		return apperr.New(apperr.CodeAISourceInvalid)
	}
	trusted := map[string]bool{}
	if turn.UserMessageID != nil {
		trusted["message:"+*turn.UserMessageID] = true
	}
	calls, err := q.ListToolCalls(ctx, turnID)
	if err != nil {
		return apperr.Internal(err)
	}
	for _, call := range calls {
		if call.Risk != string(ai.RiskReadOnly) || call.Status != "succeeded" {
			continue
		}
		var refs []string
		if err := json.Unmarshal(call.SourceRefs, &refs); err != nil {
			return apperr.Internal(err)
		}
		for _, ref := range refs {
			trusted[ref] = true
		}
	}
	if !ai.ProposalSourcesValid(draft, trusted) {
		return apperr.New(apperr.CodeAISourceInvalid)
	}
	return nil
}

// validateProposalTimes 将未填写与无效输入分开，确认编辑后也必须调用。
func validateProposalTimes(command map[string]any) error {
	for _, field := range []string{"due_date", "focus_date", "start_date", "end_date", "due_at", "start_at", "end_at", "scheduled_start_at", "scheduled_end_at"} {
		value, exists := command[field]
		if !exists {
			continue
		}
		raw, ok := value.(string)
		layout := time.RFC3339
		if strings.HasSuffix(field, "_date") {
			layout = "2006-01-02"
		}
		if !ok {
			return apperr.Validation(apperr.Field(field, "时间必须是有效的日期或带时区时刻。"))
		}
		if _, err := time.Parse(layout, strings.TrimSpace(raw)); err != nil {
			return apperr.Validation(apperr.Field(field, "时间格式无效，请修改后再确认。"))
		}
	}
	return nil
}
