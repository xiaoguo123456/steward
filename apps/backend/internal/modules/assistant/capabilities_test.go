package assistant

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

type taskQueriesStub struct {
	filter objects.TaskFilter
	task   dbgen.Task
}

func (s *taskQueriesStub) ListTasks(_ context.Context, _ string,
	filter objects.TaskFilter) ([]dbgen.Task, error) {
	s.filter = filter
	return []dbgen.Task{s.task}, nil
}

func (s *taskQueriesStub) GetTask(_ context.Context, _, _ string) (dbgen.Task, error) {
	return s.task, nil
}

func (*taskQueriesStub) GetEvent(context.Context, string, string) (dbgen.Event, error) {
	return dbgen.Event{}, nil
}

func (*taskQueriesStub) GetNote(context.Context, string, string) (dbgen.Note, error) {
	return dbgen.Note{}, nil
}

// 「没检索到」有两种，只有一种算失败。
//
// 这个区分决定了 CLAUDE.md 里那条「失败率超过一成就上向量检索」的门槛
// 是否可信：把「用户本来就没有记忆」算成失败，一批新用户就能把指标顶满，
// 于是永远看起来该上向量检索。
func TestMemoryRetrievalMissedOnlyCountsRealFailures(t *testing.T) {
	cases := []struct {
		name  string
		stats MemoryRetrievalStats
		want  bool
	}{
		{"没有任何记忆", MemoryRetrievalStats{Hits: 0, Available: 0}, false},
		{"有记忆但没命中", MemoryRetrievalStats{Hits: 0, Available: 5}, true},
		{"命中了", MemoryRetrievalStats{Hits: 2, Available: 5}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.stats.Missed(); got != tc.want {
				t.Errorf("期望 Missed()=%v，实际 %v", tc.want, got)
			}
		})
	}
}

func TestSearchTasksPassesUnscheduledFilter(t *testing.T) {
	stub := &taskQueriesStub{task: dbgen.Task{
		ID: "tsk_anytime", Title: "整理旧照片", Status: "todo", Priority: "normal",
	}}
	deps := CapabilityDeps{Tasks: stub}

	result, err := deps.searchTasks(context.Background(), ai.CapabilityContext{
		UserID: "usr_me", Timezone: "Asia/Shanghai",
	}, map[string]any{"unscheduled": true})
	if err != nil {
		t.Fatalf("查询随时可做任务失败：%v", err)
	}
	if !stub.filter.Unscheduled {
		t.Fatal("tasks.search 没有把 unscheduled=true 传给 Task 查询")
	}
	if !strings.Contains(result.Content, "整理旧照片") {
		t.Fatalf("工具结果没有包含任务标题：%s", result.Content)
	}
}

func TestProposeTaskUpdateSupportsFocusDate(t *testing.T) {
	stub := &taskQueriesStub{task: dbgen.Task{
		ID: "tsk_anytime", Title: "整理旧照片", Status: "todo", Priority: "normal", Version: 3,
	}}
	deps := CapabilityDeps{Tasks: stub}

	result, err := deps.proposeTaskUpdate(context.Background(), ai.CapabilityContext{
		UserID: "usr_me", Timezone: "Asia/Shanghai",
	}, map[string]any{
		"task_id": "tsk_anytime", "expected_version": float64(3),
		"focus_date": "2026-08-28", "reason": "用户希望今天处理",
		"source_refs": []any{"task:tsk_anytime"},
	})
	if err != nil {
		t.Fatalf("生成加入今天建议失败：%v", err)
	}
	if len(result.Proposals) != 1 || result.Proposals[0].Command["focus_date"] != "2026-08-28" {
		t.Fatalf("建议没有保留 focus_date：%+v", result.Proposals)
	}
}

func TestBuildTaskUpdateBodyMapsDateFields(t *testing.T) {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	body, err := buildTaskUpdateBody(map[string]any{
		"due_date": "2026-09-01", "focus_date": "2026-08-28",
	}, loc, "Asia/Shanghai")
	if err != nil {
		t.Fatalf("映射日期字段失败：%v", err)
	}
	if body.DueDate == nil || body.DueDate.Time.Format("2006-01-02") != "2026-09-01" {
		t.Fatalf("due_date 映射错误：%+v", body.DueDate)
	}
	if body.FocusDate == nil || body.FocusDate.Time.Format("2006-01-02") != "2026-08-28" {
		t.Fatalf("focus_date 映射错误：%+v", body.FocusDate)
	}
	if body.DueTimezone == nil || *body.DueTimezone != "Asia/Shanghai" {
		t.Fatalf("due_timezone 映射错误：%v", body.DueTimezone)
	}
}
