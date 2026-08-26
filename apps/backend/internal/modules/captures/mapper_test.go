package captures

import (
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

func TestBuildPayloadMapsTripFields(t *testing.T) {
	loc := time.FixedZone("CST", 8*60*60)
	start := time.Date(2026, 8, 29, 0, 0, 0, 0, loc)
	end := time.Date(2026, 8, 31, 0, 0, 0, 0, loc)

	raw, missing, err := buildPayload(ai.CandidateDraft{
		Type:        "project",
		Action:      "create",
		Title:       "北京行程",
		ProjectKind: "trip",
		Destination: "北京",
		Description: "和爸妈一起，记得带身份证",
		StartDate:   &start,
		TargetDate:  &end,
	}, "", loc)
	if err != nil {
		t.Fatalf("映射失败：%v", err)
	}
	if len(missing) != 0 {
		t.Fatalf("完整行程不应缺少字段：%v", missing)
	}

	payload := decodePayload(raw)
	if payload.Project == nil {
		t.Fatal("应生成项目候选")
	}
	project := payload.Project
	if project.ProjectKind == nil || string(*project.ProjectKind) != "trip" {
		t.Errorf("项目用途不正确：%v", project.ProjectKind)
	}
	if project.Destination == nil || *project.Destination != "北京" {
		t.Errorf("目的地不正确：%v", project.Destination)
	}
	if project.StartDate == nil || project.StartDate.Time.Format("2006-01-02") != "2026-08-29" {
		t.Errorf("开始日期不正确：%v", project.StartDate)
	}
	if project.TargetDate == nil || project.TargetDate.Time.Format("2006-01-02") != "2026-08-31" {
		t.Errorf("结束日期不正确：%v", project.TargetDate)
	}
}

func TestBuildPayloadRejectsIncompleteTrip(t *testing.T) {
	loc := time.FixedZone("CST", 8*60*60)
	raw, missing, err := buildPayload(ai.CandidateDraft{
		Type:        "project",
		Action:      "create",
		Title:       "未完整行程",
		ProjectKind: "trip",
	}, "", loc)
	if err != nil {
		t.Fatalf("映射失败：%v", err)
	}
	if len(raw) == 0 {
		t.Fatal("不完整候选仍应保留供确认页展示")
	}
	want := map[string]bool{"destination": false, "start_date": false, "target_date": false}
	for _, field := range missing {
		if _, ok := want[field]; ok {
			want[field] = true
		}
	}
	for field, found := range want {
		if !found {
			t.Errorf("应标记缺少 %s，实际 %v", field, missing)
		}
	}
}
