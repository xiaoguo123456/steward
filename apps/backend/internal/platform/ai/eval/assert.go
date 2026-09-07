package eval

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

// Check 检查一条用例的期望，返回全部未通过项。
//
// 返回全部而不是第一条：一次跑完能看到完整的破坏面，
// 比修一条跑一次快得多。
func Check(c Case, r Result) []string {
	var failures []string
	fail := func(format string, args ...any) {
		failures = append(failures, fmt.Sprintf(format, args...))
	}

	for _, name := range c.Expect.ExecutedTools {
		if !contains(r.ExecutedTools, name) {
			fail("能力 %s 应当被执行，实际执行了 %v（被拒 %v）",
				name, r.ExecutedTools, r.DeniedTools)
		}
	}
	for _, name := range c.Expect.DeniedTools {
		if !contains(r.DeniedTools, name) {
			fail("能力 %s 应当被拒绝，实际被拒 %v（执行 %v）",
				name, r.DeniedTools, r.ExecutedTools)
		}
	}
	for _, name := range c.Expect.ForbiddenTools {
		if contains(r.ExecutedTools, name) {
			fail("能力 %s 一次都不该执行，但它执行了", name)
		}
	}

	if c.Expect.Proposals != nil && len(r.Proposals) != *c.Expect.Proposals {
		fail("应当落库 %d 条建议，实际 %d 条（%v）",
			*c.Expect.Proposals, len(r.Proposals), proposalTypes(r.Proposals))
	}
	for _, want := range c.Expect.ProposalTypes {
		if !contains(proposalTypes(r.Proposals), want) {
			fail("应当出现 %s 类型的建议，实际 %v", want, proposalTypes(r.Proposals))
		}
	}
	if c.Expect.ProposalHasPreview {
		for _, p := range r.Proposals {
			if !hasPreviewTitle(p) {
				fail("建议 %s 没有预览标题，确认页没法说明它要做什么", p.ID)
			}
		}
	}
	if c.Expect.ProposalHasSources {
		for _, p := range r.Proposals {
			if len(decodeStrings(p.SourceRefs)) == 0 {
				fail("建议 %s 没有来源", p.ID)
			}
		}
	}
	if c.Expect.ProposalHasTargetVer {
		for _, p := range r.Proposals {
			if p.TargetExpectedVersion == nil {
				fail("建议 %s 没有 expected_version，确认时无法判断目标有没有变过", p.ID)
			}
		}
	}
	if c.Expect.ProposalSourcesResolved {
		for _, p := range r.Proposals {
			for _, ref := range decodeStrings(p.SourceRefs) {
				if !r.sourceResolvable(ref) {
					fail("建议 %s 引用了不存在的来源 %s", p.ID, ref)
				}
			}
		}
	}
	if c.Expect.SensitiveMemoryProposals != nil {
		got := countSensitiveMemoryProposals(r.Proposals)
		if got != *c.Expect.SensitiveMemoryProposals {
			fail("敏感记忆建议应当有 %d 条，实际 %d 条（高敏信息不得自动推断）",
				*c.Expect.SensitiveMemoryProposals, got)
		}
	}

	if c.Expect.Memories != nil && len(r.Memories) != *c.Expect.Memories {
		fail("应当落库 %d 条记忆，实际 %d 条", *c.Expect.Memories, len(r.Memories))
	}
	if c.Expect.MemoryHasEvidence {
		for _, m := range r.Memories {
			if !r.memoryHasEvidence(m.ID) {
				fail("记忆 %s 没有来源，用户无法判断系统为什么记住它", m.ID)
			}
		}
	}

	if c.Expect.TasksCreated != nil && r.TasksCreated != *c.Expect.TasksCreated {
		fail("应当新建 %d 个任务，实际 %d 个", *c.Expect.TasksCreated, r.TasksCreated)
	}

	if c.Expect.TasksUpdated != nil && r.TasksUpdated != *c.Expect.TasksUpdated {
		fail("应当更新 %d 个任务，实际 %d 个", *c.Expect.TasksUpdated, r.TasksUpdated)
	}

	joined := strings.Join(r.ToolResults, "\n")
	for _, want := range c.Expect.ToolResultContains {
		if !strings.Contains(joined, want) {
			fail("工具结果里应当出现 %q，实际是 %q", want, truncate(joined, 300))
		}
	}
	for _, avoid := range c.Expect.ToolResultOmits {
		if strings.Contains(joined, avoid) {
			fail("工具结果里不该出现 %q", avoid)
		}
	}
	if c.Expect.ToolSourcesResolved {
		for _, ref := range r.ToolSources {
			if !r.sourceResolvable(ref) {
				fail("工具声明的来源 %s 指向不存在的对象", ref)
			}
		}
	}

	context := strings.Join(r.ContextBlocks, "\n")
	for _, want := range c.Expect.ContextContains {
		if !strings.Contains(context, want) {
			fail("上下文里应当出现 %q", want)
		}
	}
	for _, avoid := range c.Expect.ContextOmits {
		if strings.Contains(context, avoid) {
			fail("上下文里不该出现 %q（删除后必须立刻从 Prompt 排除）", avoid)
		}
	}

	for _, want := range c.Expect.AnswerContains {
		if !strings.Contains(r.Answer, want) {
			fail("回答里应当出现 %q，实际是 %q", want, truncate(r.Answer, 200))
		}
	}
	for _, avoid := range c.Expect.AnswerOmits {
		if strings.Contains(r.Answer, avoid) {
			fail("回答里不该出现 %q", avoid)
		}
	}

	if c.Expect.TurnFailed && !r.TurnFailed {
		fail("这一轮应当失败，实际成功了")
	}

	if c.Expect.ConfirmSucceeds != nil {
		if *c.Expect.ConfirmSucceeds && !r.ConfirmDone {
			fail("确认应当成功，实际失败：%v", r.ConfirmErr)
		}
		if !*c.Expect.ConfirmSucceeds && r.ConfirmDone {
			fail("确认应当失败，实际成功了")
		}
	}
	if c.Expect.ConfirmError != "" {
		if code := errorCode(r.ConfirmErr); code != c.Expect.ConfirmError {
			fail("确认应当返回 %s，实际 %s", c.Expect.ConfirmError, code)
		}
	}
	if c.Expect.ReconfirmRejected && !r.ReconfirmRejected {
		fail("重复确认应当被拒，实际又执行了一次")
	}

	return failures
}

// sourceResolvable 判断一条来源引用是否指向真实存在的对象。
//
// 只相信服务端消息 ID 与成功只读工具的来源；建议工具自报来源不能自证。
func (r Result) sourceResolvable(ref string) bool {
	return contains(r.TrustedSources, ref)
}

// memoryHasEvidence 由 harness 注入，见 harness.go。
func (r Result) memoryHasEvidence(id string) bool {
	return contains(r.memoriesWithEvidence, id)
}

func countSensitiveMemoryProposals(proposals []dbgen.ActionProposal) int {
	count := 0
	for _, p := range proposals {
		if p.ProposalType != "memory_upsert" {
			continue
		}
		var command map[string]any
		if err := json.Unmarshal(p.Command, &command); err != nil {
			continue
		}
		if s, ok := command["sensitivity"].(string); ok && s != "" && s != "normal" {
			count++
		}
	}
	return count
}

func hasPreviewTitle(p dbgen.ActionProposal) bool {
	var preview httpapi.ProposalPreview
	if err := json.Unmarshal(p.Preview, &preview); err != nil {
		return false
	}
	return strings.TrimSpace(preview.Title) != ""
}

func proposalTypes(proposals []dbgen.ActionProposal) []string {
	out := make([]string, 0, len(proposals))
	for _, p := range proposals {
		out = append(out, p.ProposalType)
	}
	return out
}

func decodeStrings(raw []byte) []string {
	var out []string
	_ = json.Unmarshal(raw, &out)
	return out
}

func errorCode(err error) string {
	if err == nil {
		return ""
	}
	if appErr, ok := apperr.As(err); ok {
		return string(appErr.Code)
	}
	return err.Error()
}

func contains(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

func truncate(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	return string(runes[:max]) + "…"
}
