package assistant

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/assets"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

// messageInteraction 与消息一起持久化；选择引用不会暴露到客户端。
type messageInteraction struct {
	Outcome       string                  `json:"outcome,omitempty"`
	Clarification *ai.ClarificationError  `json:"clarification,omitempty"`
	Selection     *ai.ClarificationChoice `json:"selection,omitempty"`
}

func selectionForTurn(ctx context.Context, q *dbgen.Queries, thread dbgen.AssistantThread, body httpapi.CreateTurnRequest) (*ai.ClarificationChoice, error) {
	if (body.ChoiceId == nil) != (body.ClarificationMessageId == nil) {
		return nil, apperr.Validation(apperr.Field("choice_id", "请选择当前问题的一个选项。"))
	}
	rows, err := q.ListRecentMessages(ctx, dbgen.ListRecentMessagesParams{ThreadID: thread.ID, RowLimit: 1})
	if err != nil {
		return nil, apperr.Internal(err)
	}
	if len(rows) == 0 {
		if body.ChoiceId != nil {
			return nil, apperr.New(apperr.CodeVersionConflict)
		}
		return nil, nil
	}
	latest := rows[0]
	var state messageInteraction
	if latest.Role != "assistant" || json.Unmarshal(latest.Interaction, &state) != nil || state.Clarification == nil {
		if body.ChoiceId != nil {
			return nil, apperr.New(apperr.CodeVersionConflict)
		}
		return nil, nil
	}
	index := -1
	if body.ChoiceId != nil {
		if *body.ClarificationMessageId != latest.ID {
			return nil, apperr.New(apperr.CodeVersionConflict)
		}
		for i, choice := range state.Clarification.Choices {
			if choice.ID == *body.ChoiceId {
				index = i
			}
		}
		if index < 0 {
			return nil, apperr.Validation(apperr.Field("choice_id", "选项已经失效，请重新选择。"))
		}
	} else if n, err := strconv.Atoi(strings.TrimSpace(body.Text)); err == nil && n > 0 && n <= len(state.Clarification.Choices) {
		index = n - 1
	}
	if index >= 0 {
		return &state.Clarification.Choices[index], nil
	}
	return nil, nil
}

func dismissCapability() ai.Capability {
	return ai.Capability{
		Name: "assistant.dismiss_proposal", Version: "v1", Risk: ai.RiskProposal,
		Description:    "仅在用户明确取消、撤回当前待确认建议时调用。多个建议必须先确定目标。不会删除已保存的任务或偏好。",
		Parameters:     controlSchema(assets.DismissProposalSchemaV1),
		MaxResultBytes: 1024, Timeout: time.Second,
		Handler: func(_ context.Context, cc ai.CapabilityContext, args map[string]any) (ai.CapabilityResult, error) {
			if cc.EntryResourceType != "proposal" {
				cc.Pending = withdrawalScope(cc.Pending, currentUserText(cc))
			}
			id := text(args["proposal_id"])
			selected := cc.EntryResourceType == "proposal" && cc.EntryResourceID == id
			if !selected && !withdrawalRequested(currentUserText(cc)) {
				return ai.CapabilityResult{}, &ai.ClarificationError{Question: "你是想取消当前待确认建议，还是只讨论这件事？"}
			}
			if !selected && len(cc.Pending) > 1 {
				matches := 0
				matchedID := ""
				for _, pending := range cc.Pending {
					title := text(pending.Command["title"])
					if title != "" && strings.Contains(currentUserText(cc), title) {
						matches++
						matchedID = pending.ID
					}
				}
				if matches == 1 && matchedID != id {
					return ai.CapabilityResult{}, &ai.ToolInputError{Message: "取消目标与用户明确说出的建议不一致。"}
				}
				if matches != 1 {
					choices := []ai.ClarificationChoice{}
					for i, pending := range cc.Pending {
						if i == 10 {
							break
						}
						title := text(pending.Command["title"])
						if title == "" {
							title = "待确认内容建议"
							if pending.Type == "memory_upsert" {
								title = "长期偏好建议"
							}
						}
						choices = append(choices, ai.ClarificationChoice{ID: pending.ID, Label: fmt.Sprintf("%d. 取消：%s", i+1, title), ResourceType: "proposal", ResourceID: pending.ID, Version: pending.Version})
					}
					return ai.CapabilityResult{}, &ai.ClarificationError{Question: "你想取消哪条待确认建议？", Choices: choices}
				}
			}
			for _, pending := range cc.Pending {
				if pending.ID == id && (!selected || cc.SelectedVersion == pending.Version) {
					return ai.CapabilityResult{Content: "取消请求已登记，等待应用服务提交状态。", Resolutions: []ai.ProposalResolution{{ID: id, Version: pending.Version}}}, nil
				}
			}
			return ai.CapabilityResult{}, &ai.ToolInputError{Message: "这个建议不在当前对话的待确认集合中，请重新确认目标。"}
		},
	}
}

func resolvePending(ctx context.Context, q *dbgen.Queries, args RespondArgs, resolutions []ai.ProposalResolution) (int, error) {
	count := 0
	seen := map[string]bool{}
	for _, resolution := range resolutions {
		if seen[resolution.ID] {
			continue
		}
		seen[resolution.ID] = true
		row, err := q.LockProposal(ctx, resolution.ID)
		if err != nil {
			return 0, apperr.Internal(err)
		}
		if row.ThreadID == nil || *row.ThreadID != args.ThreadID || row.UserID != args.UserID || row.Status != "pending" || int(row.Version) != resolution.Version || row.ExpiresAt.Before(time.Now()) {
			continue
		}
		if _, err := q.MarkProposalResolved(ctx, dbgen.MarkProposalResolvedParams{ID: row.ID, Status: "rejected"}); err != nil {
			return 0, apperr.Internal(err)
		}
		count++
	}
	return count, nil
}

// clarificationCapability 记录正在补充的字段，避免下一轮只得到一段无状态的提问。
func clarificationCapability() ai.Capability {
	return ai.Capability{
		Name: "assistant.ask_clarification", Version: "v1", Risk: ai.RiskReadOnly,
		Description: "缺少关键字段时提出一个问题，并保存当前意图。仅询问阻塞字段；可选日期、地点、备注不阻塞。",
		Parameters:  controlSchema(assets.AskClarificationSchemaV1),
		Handler: func(_ context.Context, _ ai.CapabilityContext, args map[string]any) (ai.CapabilityResult, error) {
			return ai.CapabilityResult{}, &ai.ClarificationError{Question: text(args["question"]), Intent: text(args["intent"]), MissingField: text(args["missing_field"])}
		},
	}
}

// 撤回只识别用户本轮直接表达；引用中的取消指令需要另行澄清。
func withdrawalRequested(value string) bool {
	if strings.ContainsAny(value, "“”\"「」") {
		return false
	}
	for _, word := range []string{"取消", "撤回", "算了", "不要了", "不记了", "别记了", "不要记", "别记", "不用记", "不要保存", "不用保存", "不保存了"} {
		if strings.Contains(value, word) {
			return true
		}
	}
	return false
}

func controlSchema(raw []byte) map[string]any {
	var schema map[string]any
	if err := json.Unmarshal(raw, &schema); err != nil {
		panic("助理控制 Schema 无效")
	}
	return schema
}

// 明确不记录且没有查询或另一项动作时直接结束；复合请求仍交给模型逐项理解。
func declinesRecording(value string) bool {
	if strings.ContainsAny(value, "“”\"「」?？") {
		return false
	}
	for _, word := range []string{"查询", "查一下", "查下", "看看", "搜索", "找一下", "怎么", "如何", "为什么", "但是", "不过", "而是", "改为", "记成笔记", "保存为", "创建", "新建"} {
		if strings.Contains(value, word) {
			return false
		}
	}
	for _, word := range []string{"不要记录", "不需要记录", "不用记录", "不要保存", "不用保存", "不需要保存", "不要记成偏好", "不要记成长期偏好", "不要记长期偏好", "别记成偏好", "别记成长期偏好"} {
		if strings.Contains(value, word) {
			return true
		}
	}
	return false
}

// 撤回长期偏好不能顺便关闭用户仍待确认的任务。
func withdrawalScope(pending []ai.PendingProposal, value string) []ai.PendingProposal {
	if !strings.Contains(value, "偏好") && !strings.Contains(value, "记忆") {
		return pending
	}
	out := []ai.PendingProposal{}
	for _, p := range pending {
		if p.Type == "memory_upsert" {
			out = append(out, p)
		}
	}
	return out
}
