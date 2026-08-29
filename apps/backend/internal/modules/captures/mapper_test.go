package captures

import (
	"encoding/json"
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
	}, "", loc, nil, nil)
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
	}, "", loc, nil, nil)
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

func TestBuildPayloadKeepsTripReferenceAndTicketImage(t *testing.T) {
	loc := time.FixedZone("CST", 8*60*60)
	start := time.Date(2026, 8, 27, 8, 18, 0, 0, loc)
	end := time.Date(2026, 8, 27, 12, 32, 0, 0, loc)
	raw, missing, err := buildPayload(ai.CandidateDraft{
		Type:       "event",
		Action:     "create",
		Title:      "G1 北京南至上海虹桥",
		ProjectRef: "prj_trip",
		StartAt:    &start,
		EndAt:      &end,
		Location:   "北京南",
		Sources:    []ai.SourceSpan{{PartID: "part_ticket"}},
		ItineraryDetails: &ai.ItineraryDetailsDraft{
			Kind: "transport", TransportMode: "train", Origin: "北京南",
			Destination: "上海虹桥", ServiceNumber: "G1", BookingStatus: "ticketed",
		},
	}, "", loc, map[string]string{"part_ticket": "med_ticket"}, nil)
	if err != nil {
		t.Fatalf("映射失败：%v", err)
	}
	if len(missing) != 0 {
		t.Fatalf("完整票据候选不应缺字段：%v", missing)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	event := payload["event"].(map[string]any)
	if event["project_ref"] != "prj_trip" {
		t.Errorf("行程引用丢失：%v", event["project_ref"])
	}
	details := event["itinerary_details"].(map[string]any)
	attachments := details["attachment_media_ids"].([]any)
	if len(attachments) != 1 || attachments[0] != "med_ticket" {
		t.Errorf("票据图片引用不正确：%v", attachments)
	}
}

func TestBuildPayloadMarksMissingRequiredRecordFields(t *testing.T) {
	loc := time.FixedZone("CST", 8*60*60)
	amount := 28.5
	_, missing, err := buildPayload(ai.CandidateDraft{
		Type:      "record",
		Action:    "create",
		TrackerID: "trk_ledger",
		RecordValues: []ai.RecordValueDraft{
			{Key: "amount", Number: &amount},
		},
	}, "", loc, nil, []ai.TrackerRef{{
		ID: "trk_ledger",
		Fields: []ai.TrackerFieldRef{
			{Key: "amount", Type: "currency", Required: true},
			{Key: "direction", Type: "text", Required: true},
			{Key: "category", Type: "text", Required: true},
		},
	}})
	if err != nil {
		t.Fatalf("映射失败：%v", err)
	}
	want := map[string]bool{"direction": false, "category": false}
	for _, field := range missing {
		if _, ok := want[field]; ok {
			want[field] = true
		}
		if field == "amount" {
			t.Errorf("已有金额不应再标记缺失：%v", missing)
		}
	}
	for field, found := range want {
		if !found {
			t.Errorf("应标记缺少 %s，实际 %v", field, missing)
		}
	}
}
