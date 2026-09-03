package captures

import (
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
)

func TestBuildCaptureClarificationsRestoresQuestionOrderFromLegacyParts(t *testing.T) {
	firstAnswer := "下周三上午"
	secondAnswer := "十点开始"
	parts := []dbgen.CapturePart{
		{ID: "latest-first", Kind: "text", Position: 1000, Text: &secondAnswer},
		{ID: "earliest-last", Kind: "text", Position: 1000, Text: &firstAnswer},
	}
	questions := []dbgen.CaptureQuestion{
		{Revision: 1, Question: "哪一天？", AnswerText: &firstAnswer},
		{Revision: 2, Question: "几点开始？", AnswerText: &secondAnswer},
	}

	got := buildCaptureClarifications(parts, questions)
	if len(got) != 2 {
		t.Fatalf("期望恢复 2 轮澄清，实际 %d", len(got))
	}
	if got[0].Question != "哪一天？" || got[0].Answer != firstAnswer ||
		got[0].AnswerPartID != "earliest-last" {
		t.Fatalf("第一轮澄清顺序或来源错误：%+v", got[0])
	}
	if got[1].Question != "几点开始？" || got[1].Answer != secondAnswer ||
		got[1].AnswerPartID != "latest-first" {
		t.Fatalf("第二轮澄清顺序或来源错误：%+v", got[1])
	}
}

func TestBuildCaptureClarificationsUsesDistinctPartsForRepeatedAnswers(t *testing.T) {
	answer := "取消"
	parts := []dbgen.CapturePart{
		{ID: "answer-one", Kind: "text", Position: 1000, Text: &answer},
		{ID: "answer-two", Kind: "text", Position: 1000, Text: &answer},
	}
	questions := []dbgen.CaptureQuestion{
		{Revision: 7, Question: "第一个问题", AnswerText: &answer},
		{Revision: 8, Question: "第二个问题", AnswerText: &answer},
	}

	got := buildCaptureClarifications(parts, questions)
	if len(got) != 2 || got[0].AnswerPartID == "" || got[1].AnswerPartID == "" {
		t.Fatalf("重复回答也必须恢复来源：%+v", got)
	}
	if got[0].AnswerPartID == got[1].AnswerPartID {
		t.Fatalf("两轮回答不能绑定同一个 Part：%+v", got)
	}
}

func TestClarificationPartPositionFollowsQuestionRevision(t *testing.T) {
	if got := clarificationPartPosition(1); got != 1001 {
		t.Fatalf("第一轮回答位置错误：%d", got)
	}
	if got := clarificationPartPosition(9); got != 1009 {
		t.Fatalf("第九轮回答位置错误：%d", got)
	}
}
