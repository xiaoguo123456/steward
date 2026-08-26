package openai

import (
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

func TestMapToNeutralKeepsTripFields(t *testing.T) {
	validator, err := captureParseSchema()
	if err != nil {
		t.Fatalf("加载 Schema 失败：%v", err)
	}
	parsed, err := decodeAndValidate(`{
		"candidates": [{
			"type": "project",
			"action": "create",
			"title": "北京行程",
			"project_kind": "trip",
			"destination": "北京",
			"description": "带身份证",
			"start_date": "2026-08-29",
			"target_date": "2026-08-31"
		}]
	}`, validator)
	if err != nil {
		t.Fatalf("解析 Schema 样例失败：%v", err)
	}

	result := mapToNeutral(parsed, ai.CaptureParseRequest{
		Timezone: "Asia/Shanghai",
		Now:      time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC),
	})
	if len(result.Candidates) != 1 {
		t.Fatalf("期望 1 个候选，实际 %d", len(result.Candidates))
	}
	candidate := result.Candidates[0]
	if candidate.ProjectKind != "trip" || candidate.Destination != "北京" || candidate.Description != "带身份证" {
		t.Errorf("行程文本字段丢失：%+v", candidate)
	}
	if candidate.StartDate == nil || candidate.TargetDate == nil {
		t.Fatalf("行程日期丢失：start=%v target=%v", candidate.StartDate, candidate.TargetDate)
	}
}
