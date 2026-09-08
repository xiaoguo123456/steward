package openai

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

func TestParseCaptureProviderFailureDoesNotReturnFakeResult(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":{"message":"可能包含用户原文","type":"unavailable"}}`))
	}))
	defer server.Close()

	provider, err := New(Config{
		BaseURL:         server.URL,
		APIKey:          "test-key",
		ParseModel:      "parse-model",
		Timeout:         time.Second,
		MaxOutputTokens: 256,
	})
	if err != nil {
		t.Fatalf("创建 Provider 失败：%v", err)
	}

	result, err := provider.ParseCapture(context.Background(), ai.CaptureParseRequest{
		Parts:    []ai.InputPart{{ID: "part_1", Kind: ai.PartText, Text: "明天交报告"}},
		Timezone: "Asia/Shanghai",
		Now:      time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC),
	})
	if !errors.Is(err, ai.ErrProviderUnavailable) {
		t.Fatalf("Provider 失败应返回正式不可用错误，实际为：%v", err)
	}
	if result.ProviderModel != "" || len(result.Candidates) != 0 {
		t.Fatalf("Provider 失败时不得返回 fake 候选：%+v", result)
	}
}

func TestParseCaptureSchemaFailureDoesNotReturnFakeResult(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{}"},"finish_reason":"stop"}]}`))
	}))
	defer server.Close()

	provider, err := New(Config{
		BaseURL:         server.URL,
		APIKey:          "test-key",
		ParseModel:      "parse-model",
		Timeout:         time.Second,
		MaxOutputTokens: 256,
	})
	if err != nil {
		t.Fatalf("创建 Provider 失败：%v", err)
	}

	result, err := provider.ParseCapture(context.Background(), ai.CaptureParseRequest{
		Parts:    []ai.InputPart{{ID: "part_1", Kind: ai.PartText, Text: "明天交报告"}},
		Timezone: "Asia/Shanghai",
		Now:      time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC),
	})
	if !errors.Is(err, ai.ErrSchemaInvalid) {
		t.Fatalf("两次 Schema 失败应返回正式校验错误，实际为：%v", err)
	}
	if calls.Load() != 2 {
		t.Fatalf("应完成首次请求和一次结构修复，实际请求 %d 次", calls.Load())
	}
	if result.ProviderModel != "" || len(result.Candidates) != 0 {
		t.Fatalf("Schema 失败时不得返回 fake 候选：%+v", result)
	}
}

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
			"target_date": "2026-08-31",
			"sources": [{"part_id": "part_1"}]
		}]
	}`, validator)
	if err != nil {
		t.Fatalf("解析 Schema 样例失败：%v", err)
	}

	result := mapToNeutral(parsed, ai.CaptureParseRequest{
		Parts:    []ai.InputPart{{ID: "part_1", Kind: ai.PartText, Text: "去北京"}},
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

func TestCaptureParseKeepsExplicitTaskListID(t *testing.T) {
	validator, err := captureParseSchema()
	if err != nil {
		t.Fatalf("加载 Schema 失败：%v", err)
	}
	parsed, err := decodeAndValidate(`{
		"candidates": [{
			"type": "task",
			"action": "create",
			"title": "提交季度报告",
			"list_id": "tls_work",
			"sources": [{"part_id": "part_1"}]
		}]
	}`, validator)
	if err != nil {
		t.Fatalf("带清单 ID 的任务候选不应被拒绝：%v", err)
	}
	result := mapToNeutral(parsed, ai.CaptureParseRequest{
		Parts: []ai.InputPart{{ID: "part_1", Kind: ai.PartText, Text: "归到工作清单"}},
	})
	if len(result.Candidates) != 1 || result.Candidates[0].ListID != "tls_work" {
		t.Fatalf("任务清单 ID 映射不完整：%+v", result.Candidates)
	}

	prompt := buildUserPrompt(ai.CaptureParseRequest{
		Lists: []ai.ListRef{{ID: "tls_work", Name: "工作", IsDefault: false}},
	})
	if !strings.Contains(prompt, "工作（ID：tls_work）") {
		t.Fatalf("已有清单上下文必须包含稳定 ID：%s", prompt)
	}
}

func TestBuildUserPromptKeepsClarificationPairsInChronologicalOrder(t *testing.T) {
	prompt := buildUserPrompt(ai.CaptureParseRequest{
		Parts: []ai.InputPart{
			{ID: "part_original", Kind: ai.PartText, Position: 0, Text: "帮我安排一次复诊"},
			// 故意把回答 Part 逆序传入，Prompt 仍必须服从 Clarifications 的时间顺序。
			{ID: "part_answer_2", Kind: ai.PartText, Position: 1002, Text: "上午十点"},
			{ID: "part_answer_1", Kind: ai.PartText, Position: 1001, Text: "下周三"},
		},
		Clarifications: []ai.CaptureClarification{
			{Question: "哪一天？", Answer: "下周三", AnswerPartID: "part_answer_1"},
			{Question: "几点？", Answer: "上午十点", AnswerPartID: "part_answer_2"},
		},
		Timezone: "Asia/Shanghai",
		Now:      time.Date(2026, 9, 3, 12, 0, 0, 0, time.UTC),
	})

	first := strings.Index(prompt, "<澄清 序号=\"1\">")
	second := strings.Index(prompt, "<澄清 序号=\"2\">")
	if first < 0 || second <= first {
		t.Fatalf("澄清问答没有按时间正序：%s", prompt)
	}
	if strings.Count(prompt, "下周三") != 1 || strings.Count(prompt, "上午十点") != 1 {
		t.Fatalf("回答不应再作为普通文字素材重复出现：%s", prompt)
	}
	if !strings.Contains(prompt, "回答来源素材ID：part_answer_1") ||
		!strings.Contains(prompt, "已经明确回答过的信息不得重复追问") {
		t.Fatalf("Prompt 缺少回答来源或防重复追问语义：%s", prompt)
	}
}

func TestMapToNeutralFallsBackToInputSources(t *testing.T) {
	validator, err := captureParseSchema()
	if err != nil {
		t.Fatalf("加载 Schema 失败：%v", err)
	}
	parsed, err := decodeAndValidate(`{
		"candidates": [{
			"type": "event",
			"action": "create",
			"title": "G1 北京南至上海虹桥",
			"sources": [{"part_id": "模型写错的来源"}]
		}]
	}`, validator)
	if err != nil {
		t.Fatalf("解析 Schema 样例失败：%v", err)
	}

	result := mapToNeutral(parsed, ai.CaptureParseRequest{
		Parts: []ai.InputPart{
			{ID: "part_ticket", Kind: ai.PartImage, Text: "G1 北京南 上海虹桥"},
			{ID: "part_empty", Kind: ai.PartImage},
		},
		Timezone: "Asia/Shanghai",
	})
	if len(result.Candidates) != 1 || len(result.Candidates[0].Sources) != 1 {
		t.Fatalf("来源回退结果不正确：%+v", result.Candidates)
	}
	if result.Candidates[0].Sources[0].PartID != "part_ticket" {
		t.Fatalf("应回退到有效票据素材，实际为 %+v", result.Candidates[0].Sources)
	}
}

func TestCaptureParseV5MapsUpdateTargetAndRelations(t *testing.T) {
	validator, err := captureParseSchema()
	if err != nil {
		t.Fatalf("加载 Schema 失败：%v", err)
	}
	parsed, err := decodeAndValidate(`{
		"candidates": [{
			"ref": "task_1",
			"type": "task",
			"action": "update",
			"target_id": "tsk_existing",
			"target_expected_version": 3,
			"title": "更新任务",
			"sources": [{"part_id": "part_1"}]
		}],
		"relations": [{"kind":"requires","from_ref":"task_1","to_ref":"nte_existing"}]
	}`, validator)
	if err != nil {
		t.Fatalf("v4 更新与关系样例不应被拒绝：%v", err)
	}
	result := mapToNeutral(parsed, ai.CaptureParseRequest{
		Parts: []ai.InputPart{{ID: "part_1", Kind: ai.PartText, Text: "更新任务"}},
	})
	if len(result.Candidates) != 1 || result.Candidates[0].Ref != "task_1" ||
		result.Candidates[0].TargetID != "tsk_existing" ||
		result.Candidates[0].TargetExpectedVersion == nil || *result.Candidates[0].TargetExpectedVersion != 3 {
		t.Fatalf("更新目标映射不完整：%+v", result.Candidates)
	}
	if len(result.Relations) != 1 || result.Relations[0].FromRef != "task_1" ||
		result.Relations[0].ToRef != "nte_existing" {
		t.Fatalf("关系候选映射不完整：%+v", result.Relations)
	}

	_, err = decodeAndValidate(`{
		"candidates": [{
			"type": "note", "action": "update", "title": "缺版本", "sources": []
		}]
	}`, validator)
	if err == nil {
		t.Fatal("action=update 缺 target_id/target_expected_version 时 Schema 应拒绝")
	}
}

// 嵌套候选的修复提示必须到达具体约束，且不能泄露实际值和未知属性名。
func TestSchemaRepairSummaryExplainsNestedConstraintWithoutInput(t *testing.T) {
	validator, err := captureParseSchema()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ name, raw, want string }{
		{"缺少类型", `{"candidates":[{"title":"敏感正文"}]}`, "缺少必填字段"},
		{"错误枚举", `{"candidates":[{"type":"敏感正文","title":"午餐"}]}`, "只能使用枚举值"},
		{"错误类型", `{"candidates":[{"type":"record","title":123}]}`, "类型必须为"},
		{"未知字段", `{"candidates":[{"type":"record","title":"午餐","敏感正文":"隐藏值"}]}`, "不允许未定义的字段"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := decodeAndValidate(tc.raw, validator)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("没有具体修复提示：%v", err)
			}
			if strings.Contains(err.Error(), "敏感正文") || strings.Contains(err.Error(), "隐藏值") || strings.Contains(err.Error(), "$ref") {
				t.Fatalf("提示包含正文或引用包装层：%v", err)
			}
		})
	}
}
