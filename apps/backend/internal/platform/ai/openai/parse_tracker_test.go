package openai

import (
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

func TestCaptureTrackerSchemaAndNeutralMapping(t *testing.T) {
	validator, err := captureParseSchema()
	if err != nil {
		t.Fatal(err)
	}
	raw := `{"candidates":[{"ref":"weight","type":"tracker","action":"create","title":"体重","sources":[{"part_id":"part"}],"tracker_fields":[{"key":"weight_kg","label":"体重","type":"number","unit":"kg","required":true}]},{"ref":"measurement","type":"record","action":"create","title":"体重记录","sources":[{"part_id":"part"}],"tracker_ref":"weight","record_values":[{"key":"weight_kg","number":68.5}]}]}`
	parsed, err := decodeAndValidate(raw, validator)
	if err != nil {
		t.Fatal(err)
	}
	result := mapToNeutral(parsed, ai.CaptureParseRequest{Now: time.Now(), Timezone: "Asia/Shanghai", Parts: []ai.InputPart{{ID: "part", Text: "今天体重68.5公斤"}}})
	if len(result.Candidates[0].TrackerFields) != 1 || result.Candidates[1].TrackerRef != "weight" {
		t.Fatal("新记录项字段或同批引用在 Provider 映射中丢失")
	}
	for _, invalid := range []string{
		`{"candidates":[{"ref":"weight","type":"tracker","action":"create","title":"体重","sources":[]}]}`,
		`{"candidates":[{"ref":"weight","type":"tracker","action":"create","title":"体重","sources":[],"tracker_fields":[]}]}`,
		`{"candidates":[{"type":"record","action":"create","title":"体重","sources":[],"tracker_id":"existing","tracker_ref":"new"}]}`,
	} {
		if _, err := decodeAndValidate(invalid, validator); err == nil {
			t.Fatal("不完整字段或双重引用必须触发结构校验错误")
		}
	}
}
