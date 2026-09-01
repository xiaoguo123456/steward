package moodjournal

import (
	"errors"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

func TestMoodJournalFollowUpSchemaRejectsExtraFields(t *testing.T) {
	var result followUpOutput
	if err := decodeMoodAI(`{"question":"这件事里，你最想记住哪个细节？"}`, &result, compiledFollowUpSchema); err != nil {
		t.Fatalf("合法追问不应被拒绝：%v", err)
	}
	if err := decodeMoodAI(`{"question":"继续想想？","diagnosis":"焦虑"}`, &result, compiledFollowUpSchema); !errors.Is(err, ai.ErrSchemaInvalid) {
		t.Fatalf("Schema 外诊断字段必须被拒绝，实际：%v", err)
	}
}

func TestMoodJournalReflectionRejectsUnselectedSources(t *testing.T) {
	result := reflectionOutput{Observations: []httpapi.MoodJournalReflectionObservation{{
		Text: "有一个反复出现的主题", SourceEntryIds: []string{"note_other"},
	}}}
	err := validateReflectionSources(result, map[string]struct{}{"note_selected": {}})
	if !errors.Is(err, ai.ErrSchemaInvalid) {
		t.Fatalf("未选择的来源必须被拒绝，实际：%v", err)
	}
}
