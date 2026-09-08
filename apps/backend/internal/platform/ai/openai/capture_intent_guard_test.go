package openai

import (
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"testing"
)

func TestBareNumericCaptureCannotGuessRecordMeaning(t *testing.T) {
	result := ai.CaptureParseResult{Candidates: []ai.CandidateDraft{{Type: "record"}}}
	for _, text := range []string{"今天68.5", "68.5", "今日：68.5。"} {
		req := ai.CaptureParseRequest{Parts: []ai.InputPart{{Kind: ai.PartText, Text: text}}}
		got := guardAmbiguousNumericInput(req, result)
		if len(got.Candidates) != 0 || len(got.Questions) != 1 || !got.Questions[0].Blocking {
			t.Fatal("裸数字必须阻塞澄清")
		}
	}
	for _, req := range []ai.CaptureParseRequest{
		{Parts: []ai.InputPart{{Kind: ai.PartText, Text: "今天体重68.5公斤"}}},
		{Parts: []ai.InputPart{{Kind: ai.PartText, Text: "68.5"}}, Clarifications: []ai.CaptureClarification{{Question: "体重是多少公斤？", Answer: "68.5"}}},
		{Parts: []ai.InputPart{{Kind: ai.PartImage, Text: "68.5"}}},
	} {
		if len(guardAmbiguousNumericInput(req, result).Candidates) != 1 {
			t.Fatal("明确语义、澄清上下文或图片不能被裸数字门禁替换")
		}
	}
}
