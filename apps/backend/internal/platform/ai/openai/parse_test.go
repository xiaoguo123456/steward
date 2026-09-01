package openai

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
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

func TestCaptureParseV4MapsUpdateTargetAndRelations(t *testing.T) {
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
