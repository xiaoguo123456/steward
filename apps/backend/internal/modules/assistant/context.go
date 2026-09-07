package assistant

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// Context Builder。
//
// 上下文优先级从高到低（后端指南 9.2）：
//  1. 本轮用户明确表达
//  2. 本轮选中的页面资源与待处理建议
//  3. 已确认业务事实
//  4. 用户显式设置
//  5. 用户确认过的长期记忆
//  6. 对话摘要与相关性检索结果
//
// 低优先级内容不能覆盖高优先级内容。这里只组装引用与少量事实，
// 具体数据一律由模型调用工具时再查，避免把整个数据库塞进 Prompt。

// 最近保留多少轮原始消息。更早的内容不做无上限追加。
const recentMessageLimit = 12

// MemoryFact 是一条可以进入 Prompt 的已确认记忆。
type MemoryFact struct {
	ID   string
	Text string
}

// contextSeed 是一次 Turn 的最小上下文。
type contextSeed struct {
	Timezone      string
	Now           time.Time
	UserText      string
	UserMessageID string
	History       []ai.Message
	// ContextBlocks 是已确认的事实与偏好，按优先级排好序。
	ContextBlocks     []string
	EntryResourceType string
	EntryResourceID   string
	// PendingProposals 是尚未处理的建议数。
	PendingProposals int
	// SuggestionsEnabled 与 MemoryLearningEnabled 来自用户的 AI 开关。
	SuggestionsEnabled    bool
	MemoryLearningEnabled bool
}

// loadSeed 在一个短事务内把 Turn 标记为运行中并读出最小上下文。
//
// 返回 skip=true 表示这一轮不需要执行：重复投递、已取消或已被顶替。
func (s *Service) loadSeed(ctx context.Context, args RespondArgs) (contextSeed, bool, error) {
	var (
		seed contextSeed
		skip bool
	)
	err := s.db.InTx(ctx, args.UserID, func(ctx context.Context, q *dbgen.Queries) error {
		if done, err := q.GetProcessedJob(ctx, args.IdempotencyKey); err == nil && done.IdempotencyKey != "" {
			// 同一 Turn 已经回复过，迟到重试不产生第二条消息。
			skip = true
			return nil
		} else if err != nil && !database.IsNoRows(err) {
			return apperr.Internal(err)
		}

		turn, err := q.StartTurn(ctx, args.TurnID)
		if err != nil {
			// 不在 queued 状态：已取消、已顶替或已经跑过。
			if database.IsNoRows(err) {
				skip = true
				return nil
			}
			return apperr.Internal(err)
		}
		if err := q.SetTurnEngine(ctx, dbgen.SetTurnEngineParams{
			EngineType: s.engineType(), EngineVersion: s.engineVersion(), ID: turn.ID,
		}); err != nil {
			return apperr.Internal(err)
		}

		tz, err := s.users.Timezone(ctx, q, args.UserID)
		if err != nil {
			return err
		}
		// AI 开关决定本轮能拿到哪些能力，必须在组装上下文时就读出来。
		settings, err := s.users.AiSettingsInTx(ctx, q, args.UserID)
		if err != nil {
			return err
		}
		seed.SuggestionsEnabled = settings.SuggestionEnabled
		seed.MemoryLearningEnabled = settings.MemoryLearningEnabled
		loc := timeutil.LoadLocation(tz)
		seed.Timezone = tz
		seed.Now = time.Now().In(loc)

		// 页面上下文只用于消歧，这里不做任何权限推断。
		if len(turn.ProviderState) > 0 {
			var entry httpapi.EntryContext
			if err := json.Unmarshal(turn.ProviderState, &entry); err == nil {
				seed.EntryResourceType, seed.EntryResourceID = entryResource(entry)
			}
		}

		messages, err := q.ListRecentMessages(ctx, dbgen.ListRecentMessagesParams{
			ThreadID: args.ThreadID, RowLimit: recentMessageLimit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		seed.UserText, seed.History = splitHistory(messages, turn.UserMessageID)
		if turn.UserMessageID != nil {
			seed.UserMessageID = *turn.UserMessageID
		}

		// 待处理建议数：让模型知道有东西悬而未决，别重复生成同一条建议。
		pending, err := q.CountPendingProposals(ctx)
		if err != nil {
			return apperr.Internal(err)
		}
		seed.PendingProposals = int(pending)
		return nil
	})
	if err != nil || skip {
		return seed, skip, err
	}

	seed.ContextBlocks = s.buildContextBlocks(ctx, args, seed)
	return seed, false, nil
}

// buildContextBlocks 按优先级组装已确认事实与偏好。
//
// 在事务外执行：记忆检索会走自己的短事务，嵌在上层事务里只会白占连接。
func (s *Service) buildContextBlocks(ctx context.Context,
	args RespondArgs, seed contextSeed) []string {

	var blocks []string

	// 优先级 2：本轮选中的页面资源。只给引用，具体内容由模型自己查。
	if seed.EntryResourceID != "" {
		blocks = append(blocks, fmt.Sprintf(
			"用户当前正在查看一条%s，ID 是 %s。他说的「这个」「它」大概率指它；"+
				"要用到具体内容时请调用工具查询确认。",
			resourceLabel(seed.EntryResourceType), seed.EntryResourceID))
	}

	// 优先级 2：待用户处理的建议。避免模型重复生成同一条建议。
	if seed.PendingProposals > 0 {
		blocks = append(blocks, fmt.Sprintf(
			"用户还有 %d 条待确认的建议尚未处理。如果他这次说的是同一件事，"+
				"先提醒他去确认，不要重复生成一条一样的建议。", seed.PendingProposals))
	}

	// 优先级 5：用户确认过的长期记忆。
	if s.memory != nil {
		facts, stats, err := s.memory.SearchWithStats(ctx, args.UserID, seed.UserText, 8)
		if err != nil {
			// 记忆检索失败不该让整轮对话失败，降级成"没有记忆"继续。
			s.logger.Warn("记忆检索失败，本轮不带记忆",
				"turn_id", args.TurnID, "error", err)
		} else if stats.Missed() {
			// 有记忆却一条都没匹配上。这是「该不该上向量检索」的判断信号：
			// CLAUDE.md 定的门槛是这类失败超过一成。
			//
			// 只记形状不记内容——查询与记忆正文都是用户资料。
			s.logger.Info("记忆检索没有命中",
				"turn_id", args.TurnID,
				"keyword_filter", stats.Keyword,
				"query_runes", len([]rune(seed.UserText)),
				"available", stats.Available)
		}
		if err == nil && len(facts) > 0 {
			var b strings.Builder
			b.WriteString("用户此前确认过的长期偏好：\n")
			for _, f := range facts {
				b.WriteString("- " + f.Text + "\n")
			}
			b.WriteString("\n如果用户这次的说法和上面冲突，以他这次说的为准。")
			blocks = append(blocks, b.String())
		}
	}
	return blocks
}

// splitHistory 把最近消息拆成"本轮用户输入"与"更早的历史"。
//
// ListRecentMessages 按序号倒序返回，这里翻正后再交给模型。
func splitHistory(messages []dbgen.AssistantMessage, userMessageID *string) (string, []ai.Message) {
	ordered := make([]dbgen.AssistantMessage, 0, len(messages))
	for i := len(messages) - 1; i >= 0; i-- {
		ordered = append(ordered, messages[i])
	}

	userText := ""
	history := make([]ai.Message, 0, len(ordered))
	for _, m := range ordered {
		if userMessageID != nil && m.ID == *userMessageID {
			userText = m.Content
			// 本轮输入单独作为最后一条 user 消息发送，不重复进历史。
			continue
		}
		role := ai.RoleUser
		if m.Role == "assistant" {
			role = ai.RoleAssistant
		}
		history = append(history, ai.Message{Role: role, Content: m.Content})
	}
	return userText, history
}

// entryResource 从页面上下文中取出资源引用。
//
// 客户端只能给出"用户在看哪个东西"，不能给出任何权限结论；
// 归属与版本一律由服务端在真正用到时重新校验。
func entryResource(entry httpapi.EntryContext) (string, string) {
	if entry.ResourceId == nil || entry.ResourceType == nil {
		return "", ""
	}
	return *entry.ResourceType, *entry.ResourceId
}

func resourceLabel(kind string) string {
	switch kind {
	case "task":
		return "任务"
	case "event":
		return "日程"
	case "note":
		return "笔记"
	case "project":
		return "项目"
	case "record":
		return "记录"
	case "tracker":
		return "记录项"
	default:
		return "内容"
	}
}

// engineVersion 返回编排引擎版本，写入 Turn 审计。
func (s *Service) engineVersion() string {
	return ai.EngineVersion(s.engine)
}

// engineType 返回当前实际编排实现，创建 Turn 与运行审计都使用同一来源。
func (s *Service) engineType() string {
	return ai.EngineType(s.engine)
}
