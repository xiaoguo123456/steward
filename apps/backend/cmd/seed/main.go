// Command seed 写入本地演示数据。
//
// 它只用于开发与验收：所有内容都通过与 API 相同的领域约束写入，
// 因此种子数据不会出现线上不可能存在的状态。
// 重复执行是安全的：已存在演示用户时先清空其业务数据再重建。
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// 演示账号。配合 STEWARD_DEV_SMS_CODE 即可直接登录。
const (
	demoPhone    = "13800138000"
	demoName     = "演示用户"
	demoTimezone = "Asia/Shanghai"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("写入演示数据失败：%v", err)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	userID, err := ensureUser(ctx, db)
	if err != nil {
		return err
	}
	log.Printf("演示用户：%s（手机号 %s，验证码 %s）", userID, demoPhone, orDefault(cfg.DevSMSCode, "见短信"))

	return db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if err := resetUserData(ctx, userID, db); err != nil {
			return err
		}
		return seedAll(ctx, q, userID)
	})
}

// ensureUser 创建或复用演示用户。登录前的路径必须走 SECURITY DEFINER 函数。
func ensureUser(ctx context.Context, db *database.DB) (string, error) {
	var userID string
	err := func() error {
		tx, err := db.Pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer func() { _ = tx.Rollback(ctx) }()

		err = tx.QueryRow(ctx,
			`SELECT id FROM auth_find_user_by_phone($1)`, demoPhone).Scan(&userID)
		if err != nil {
			if err != pgx.ErrNoRows {
				return err
			}
			if err := tx.QueryRow(ctx,
				`SELECT id FROM auth_create_user($1, $2, $3, $4)`,
				idgen.New(idgen.PrefixUser), demoPhone, demoName, demoTimezone,
			).Scan(&userID); err != nil {
				return err
			}
		}
		return tx.Commit(ctx)
	}()
	return userID, err
}

// resetUserData 清空演示用户的业务数据，保证重复执行结果一致。
func resetUserData(ctx context.Context, userID string, db *database.DB) error {
	return db.InTx(ctx, userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		// 顺序遵循外键依赖：先删引用方，再删被引用方。
		tables := []string{
			"activity_entries", "activity_batches",
			"capture_conflicts", "capture_questions", "capture_relation_candidates",
			"capture_candidates", "capture_parts", "captures",
			"records", "trackers",
			"relations", "notes", "events", "tasks", "task_lists", "projects",
			"async_operations", "processed_jobs", "idempotency_keys", "ai_actions",
		}
		for _, table := range tables {
			if _, err := tx.Exec(ctx, fmt.Sprintf("DELETE FROM %s", table)); err != nil {
				return fmt.Errorf("清空 %s 失败：%w", table, err)
			}
		}
		return nil
	})
}

func seedAll(ctx context.Context, q *dbgen.Queries, userID string) error {
	loc := timeutil.LoadLocation(demoTimezone)
	now := time.Now().In(loc)
	today := timeutil.DayOf(now, loc)

	if _, err := q.EnsureUserPreferences(ctx, userID); err != nil {
		return err
	}
	if _, err := q.EnsureAiSettings(ctx, userID); err != nil {
		return err
	}

	// ---- 清单 ----
	lists := map[string]string{}
	for i, spec := range []struct {
		name      string
		color     string
		isDefault bool
	}{
		{"默认清单", "green", true},
		{"工作", "blue", false},
		{"生活", "orange", false},
		{"学习", "purple", false},
	} {
		color := spec.color
		row, err := q.CreateTaskList(ctx, dbgen.CreateTaskListParams{
			ID: idgen.New(idgen.PrefixTaskList), UserID: userID,
			Name: spec.name, Color: &color, Position: int32(i), IsDefault: spec.isDefault,
		})
		if err != nil {
			return fmt.Errorf("创建清单 %s 失败：%w", spec.name, err)
		}
		lists[spec.name] = row.ID
	}

	// ---- 项目 ----
	projectID := idgen.New(idgen.PrefixProject)
	targetDate := today.Date.AddDate(0, 1, 0)
	if _, err := q.CreateProject(ctx, dbgen.CreateProjectParams{
		ID: projectID, UserID: userID,
		Title:       "首页改版",
		Description: strPtr("把首页的任务流与 AI 整理入口重新梳理一遍。"),
		Status:      "active",
		StartDate:   &today.Date,
		TargetDate:  &targetDate,
		CreatedBy:   "user", ProvenanceRefs: emptyArray,
	}); err != nil {
		return fmt.Errorf("创建项目失败：%w", err)
	}

	// ---- 任务 ----
	tz := demoTimezone
	yesterday := today.Date.AddDate(0, 0, -1)
	tomorrow := today.Date.AddDate(0, 0, 1)
	morning := time.Date(today.Date.Year(), today.Date.Month(), today.Date.Day(), 10, 0, 0, 0, loc)

	taskSpecs := []struct {
		title     string
		list      string
		priority  string
		dueDate   *time.Time
		dueAt     *time.Time
		focusDate *time.Time
		status    string
		project   bool
	}{
		{title: "完成产品需求评审文档", list: "工作", priority: "high", dueAt: &morning, project: true},
		{title: "回复客户邮件", list: "工作", priority: "normal", dueDate: &today.Date},
		{title: "提交上周的周报", list: "工作", priority: "high", dueDate: &yesterday},
		{title: "健身 30 分钟", list: "生活", priority: "normal", focusDate: &today.Date},
		{title: "购买下周出差机票", list: "生活", priority: "low", dueDate: &tomorrow},
		{title: "阅读《设计心理学》30 分钟", list: "学习", priority: "normal"},
		{title: "整理季度复盘材料", list: "工作", priority: "normal", status: "done", project: true},
	}

	for _, spec := range taskSpecs {
		status := spec.status
		if status == "" {
			status = "todo"
		}
		var completedAt *time.Time
		if status == "done" {
			t := now.Add(-3 * time.Hour)
			completedAt = &t
		}
		var dueTZ *string
		if spec.dueDate != nil || spec.dueAt != nil {
			dueTZ = &tz
		}
		var project *string
		if spec.project {
			project = &projectID
		}

		if _, err := q.CreateTask(ctx, dbgen.CreateTaskParams{
			ID: idgen.New(idgen.PrefixTask), UserID: userID,
			Title: spec.title, Status: status, Priority: spec.priority,
			DueDate: spec.dueDate, DueAt: spec.dueAt, DueTimezone: dueTZ,
			FocusDate: spec.focusDate,
			ListID:    lists[spec.list], ProjectID: project,
			Reminders: emptyArray, CompletedAt: completedAt,
			CreatedBy: "user", ProvenanceRefs: emptyArray,
		}); err != nil {
			return fmt.Errorf("创建任务 %s 失败：%w", spec.title, err)
		}
	}

	// ---- 日程与重要日 ----
	meetingStart := time.Date(today.Date.Year(), today.Date.Month(), today.Date.Day(), 15, 0, 0, 0, loc)
	meetingEnd := meetingStart.Add(time.Hour)
	if _, err := q.CreateEvent(ctx, dbgen.CreateEventParams{
		ID: idgen.New(idgen.PrefixEvent), UserID: userID,
		Title: "需求评审会", EventKind: "schedule", AllDay: false,
		StartAt: &meetingStart, EndAt: &meetingEnd, Timezone: tz,
		Location: strPtr("三楼会议室"), Participants: emptyArray,
		ProjectID: &projectID, Reminders: emptyArray, Recurrence: "none",
		CreatedBy: "user", ProvenanceRefs: emptyArray,
	}); err != nil {
		return fmt.Errorf("创建日程失败：%w", err)
	}

	// 重要日按年重复，2 月 29 日在非闰年由服务端投影到 2 月 28 日。
	birthday := time.Date(today.Date.Year(), 8, 24, 0, 0, 0, 0, loc)
	monthDay := timeutil.MonthDay(birthday)
	if _, err := q.CreateEvent(ctx, dbgen.CreateEventParams{
		ID: idgen.New(idgen.PrefixEvent), UserID: userID,
		Title: "妈妈生日", EventKind: "important_date", AllDay: true,
		StartDate: &birthday, Timezone: tz, Participants: emptyArray,
		Reminders: emptyArray, Recurrence: "yearly", OriginalMonthDay: &monthDay,
		CreatedBy: "user", ProvenanceRefs: emptyArray,
	}); err != nil {
		return fmt.Errorf("创建重要日失败：%w", err)
	}

	// ---- 笔记 ----
	noteSpecs := []struct {
		title   string
		content string
		tags    []string
	}{
		{
			title:   "首页改版评审结论",
			content: "优先做任务流优化，减少点击层级。AI 悬浮入口保持可拖动，日历与清单的数据打通放到下一迭代。",
			tags:    []string{"工作", "会议"},
		},
		{
			title:   "定价思路",
			content: "按用量分档比按人头更贴合当前客户结构，需要先补一版成本模型。",
			tags:    []string{"工作", "灵感"},
		},
		{
			title:   "周末想去的地方",
			content: "植物园的温室最近换了展，天气好的话周六上午去。",
			tags:    []string{"生活"},
		},
	}
	for _, spec := range noteSpecs {
		if _, err := q.CreateNote(ctx, dbgen.CreateNoteParams{
			ID: idgen.New(idgen.PrefixNote), UserID: userID,
			Title: spec.title, Content: spec.content,
			Attachments: emptyArray, Tags: spec.tags,
			CreatedBy: "user", ProvenanceRefs: emptyArray,
		}); err != nil {
			return fmt.Errorf("创建笔记 %s 失败：%w", spec.title, err)
		}
	}

	// ---- 打卡项与记录 ----
	trackerSpecs := []struct {
		name   string
		fields []httpapi.TrackerField
		values []float64
	}{
		{
			name: "体重",
			fields: []httpapi.TrackerField{
				{Key: "weight", Label: "体重", Type: httpapi.TrackerFieldTypeNumber, Required: true, Unit: strPtr("kg")},
			},
			values: []float64{68.4, 68.2, 68.5},
		},
		{
			name: "睡眠",
			fields: []httpapi.TrackerField{
				{Key: "duration", Label: "时长", Type: httpapi.TrackerFieldTypeDuration, Required: true, Unit: strPtr("小时")},
			},
			values: []float64{7.3, 6.8, 7.5},
		},
		{
			name: "饮水",
			fields: []httpapi.TrackerField{
				{Key: "volume", Label: "饮水量", Type: httpapi.TrackerFieldTypeNumber, Required: true, Unit: strPtr("ml")},
			},
			values: []float64{1800, 2000},
		},
	}

	for _, spec := range trackerSpecs {
		fieldsJSON, err := json.Marshal(spec.fields)
		if err != nil {
			return err
		}
		tracker, err := q.CreateTracker(ctx, dbgen.CreateTrackerParams{
			ID: idgen.New(idgen.PrefixTracker), UserID: userID,
			Name: spec.name, Fields: fieldsJSON, Status: "active",
			CreatedBy: "user", ProvenanceRefs: emptyArray,
		})
		if err != nil {
			return fmt.Errorf("创建打卡项 %s 失败：%w", spec.name, err)
		}

		field := spec.fields[0]
		for i, value := range spec.values {
			// 最近一条记录放在昨天，让「今日待打卡」有内容可展示。
			ts := now.AddDate(0, 0, -(i + 1))
			v := value
			valuesJSON, err := json.Marshal([]httpapi.RecordValue{{Key: field.Key, NumberValue: &v}})
			if err != nil {
				return err
			}
			title := fmt.Sprintf("%s · %s %g %s",
				timeutil.FormatDate(ts), field.Label, value, derefOr(field.Unit, ""))
			if _, err := q.CreateRecord(ctx, dbgen.CreateRecordParams{
				ID: idgen.New(idgen.PrefixRecord), UserID: userID,
				Title: title, TrackerID: tracker.ID, Timestamp: ts,
				Values: valuesJSON, CreatedBy: "user", ProvenanceRefs: emptyArray,
			}); err != nil {
				return fmt.Errorf("创建记录失败：%w", err)
			}
		}
	}

	log.Printf("已写入：%d 个清单、%d 个任务、2 个日程、%d 篇笔记、%d 个打卡项",
		len(lists), len(taskSpecs), len(noteSpecs), len(trackerSpecs))
	return nil
}

var emptyArray = []byte("[]")

func strPtr(v string) *string { return &v }

func derefOr(v *string, fallback string) string {
	if v == nil {
		return fallback
	}
	return *v
}

func orDefault(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
}
