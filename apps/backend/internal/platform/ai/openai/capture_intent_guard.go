package openai

import (
	"regexp"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

var bareCaptureNumber = regexp.MustCompile(`^(今天|今日|现在|刚刚)?[[:space:]]*[:：]?[[:space:]]*[+-]?[0-9]+([.][0-9]+)?[。.!！]?$`)

// 这是缺少记录语义时的保守确认门禁，不补全数值含义，也不绕过 Provider 失败。
func guardAmbiguousNumericInput(req ai.CaptureParseRequest, result ai.CaptureParseResult) ai.CaptureParseResult {
	if len(req.Clarifications) > 0 || strings.TrimSpace(req.InstructionNote) != "" || len(req.Parts) != 1 {
		return result
	}
	part := req.Parts[0]
	if part.Kind != ai.PartText || !bareCaptureNumber.MatchString(strings.TrimSpace(part.Text)) {
		return result
	}
	result.Candidates = nil
	result.Relations = nil
	result.Conflicts = nil
	result.Questions = []ai.QuestionDraft{{Question: "这个数值要记录什么？请补充名称和单位，例如“体重68.5公斤”。", Blocking: true}}
	return result
}
