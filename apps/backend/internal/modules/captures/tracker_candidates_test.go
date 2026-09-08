package captures

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

func weightTrackerCandidate() ai.CandidateDraft {
	return ai.CandidateDraft{Ref: "weight", Type: "tracker", Title: "体重", TrackerFields: []ai.TrackerFieldRef{{Key: "weight_kg", Label: "体重", Type: "number", Unit: "kg", Required: true}}}
}

func TestTrackerCandidateMapsFields(t *testing.T) {
	raw, missing, err := buildPayload(weightTrackerCandidate(), "", time.UTC, nil, nil)
	if err != nil || len(missing) != 0 {
		t.Fatalf("完整记录项应可以确认：%v %v", err, missing)
	}
	draft := decodePayload(raw).Tracker
	if draft == nil || len(draft.Fields) != 1 || draft.Fields[0].Key != "weight_kg" || draft.Fields[0].Unit == nil || *draft.Fields[0].Unit != "kg" {
		t.Fatalf("字段映射丢失：%s", raw)
	}
	_, _, err = buildPayload(ai.CandidateDraft{Type: "tracker", Title: "体重"}, "", time.UTC, nil, nil)
	if err == nil {
		t.Fatal("不完整记录项不能落库为成功候选")
	}
}

func TestTrackerCandidatesRejectBrokenReferencesAndFields(t *testing.T) {
	tracker := weightTrackerCandidate()
	n := 68.5
	record := ai.CandidateDraft{Type: "record", TrackerRef: "weight", RecordValues: []ai.RecordValueDraft{{Key: "weight_kg", Number: &n}}}
	if err := validateTrackerCandidates([]ai.CandidateDraft{record, tracker}, nil); err != nil {
		t.Fatalf("同批记录项允许前向引用：%v", err)
	}
	cases := map[string][]ai.CandidateDraft{}
	bad := tracker
	bad.TrackerFields = nil
	cases["缺少字段"] = []ai.CandidateDraft{bad}
	bad = tracker
	bad.TrackerFields = append(append([]ai.TrackerFieldRef{}, tracker.TrackerFields...), tracker.TrackerFields[0])
	cases["重复字段"] = []ai.CandidateDraft{bad}
	cases["重复引用"] = []ai.CandidateDraft{tracker, tracker}
	bad = record
	bad.TrackerRef = "missing"
	cases["悬空引用"] = []ai.CandidateDraft{tracker, bad}
	bad = record
	bad.TrackerID = "existing"
	cases["双重引用"] = []ai.CandidateDraft{tracker, bad}
	bad = record
	bad.RecordValues = []ai.RecordValueDraft{{Key: "duration_min", Number: &n}}
	cases["跨字段错配"] = []ai.CandidateDraft{tracker, bad}
	bad = record
	bad.TrackerRef = ""
	bad.TrackerID = "unknown"
	cases["不存在的记录项"] = []ai.CandidateDraft{bad}
	for name, candidates := range cases {
		t.Run(name, func(t *testing.T) {
			if validateTrackerCandidates(candidates, nil) == nil {
				t.Fatal("非法候选应被拒绝")
			}
		})
	}
}

func TestMapCaptureExposesLegacyBrokenTrackerAsRecoverableFailure(t *testing.T) {
	raw := []byte(`{"tracker":{"name":"体重","fields":null}}`)
	result := MapCapture(Detail{Capture: dbgen.Capture{Status: "needs_confirmation"}, Candidates: []dbgen.CaptureCandidate{{CandidateType: "tracker", Payload: raw}}})
	if result.Status != "failed" || result.Error == nil || !result.Error.Retryable || len(result.Candidates) != 0 {
		t.Fatal("旧损坏快照必须可读取并明确失败，不能继续向客户端返回非法字段")
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["candidates"] == nil {
		t.Fatal("候选列表必须为空数组，不能为 null")
	}
}

func TestLegacyBrokenTrackerDoesNotReopenTerminalCapture(t *testing.T) {
	for _, status := range []string{"confirmed", "discarded", "expired"} {
		result := MapCapture(Detail{Capture: dbgen.Capture{Status: status}, Candidates: []dbgen.CaptureCandidate{{CandidateType: "tracker", Payload: []byte(`{"tracker":{"name":"历史记录","fields":null}}`)}}})
		if string(result.Status) != status || len(result.Candidates) != 0 {
			t.Fatal("已结束的 Capture 状态不得因旧快照而倒退")
		}
	}
}
