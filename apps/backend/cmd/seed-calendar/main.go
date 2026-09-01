// Command seed-calendar 向指定测试账号补充月历验收数据。
//
// 它只允许连接 steward_test 数据库：普通事项按同名同日去重，
// 按年重复的重要日按名称去重。命令不删除或改写账号已有内容，
// 适合在真机验收前重复执行。
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

const seedTimezone = "Asia/Shanghai"

var emptyArray = []byte(`[]`)

type calendarEventSpec struct {
	day               int
	title             string
	eventKind         string
	hour              int
	location          string
	recurrence        string
	importantDateKind string
}

func scheduleEvent(day int, title string, hour int, location string) calendarEventSpec {
	return calendarEventSpec{
		day: day, title: title, eventKind: "schedule", hour: hour,
		location: location, recurrence: "none",
	}
}

func importantDateEvent(
	day int,
	title string,
	kind string,
	recurrence string,
) calendarEventSpec {
	return calendarEventSpec{
		day: day, title: title, eventKind: "important_date",
		recurrence: recurrence, importantDateKind: kind,
	}
}

func calendarEventSpecs() []calendarEventSpec {
	return []calendarEventSpec{
		scheduleEvent(2, "产品周报", 9, "线上会议"),
		scheduleEvent(3, "团队周会", 10, "一号会议室"),
		scheduleEvent(4, "设计评审", 14, "二号会议室"),
		scheduleEvent(5, "上海出差", 8, "虹桥站"),
		scheduleEvent(6, "客户回访", 15, "线上会议"),
		scheduleEvent(7, "健身课", 19, "社区健身房"),
		scheduleEvent(9, "朋友聚餐", 18, "静安寺"),
		scheduleEvent(10, "牙医复诊", 11, "口腔门诊"),
		scheduleEvent(12, "版本发布", 16, "线上"),
		scheduleEvent(13, "财务对账", 10, "办公室"),
		importantDateEvent(14, "结婚纪念日", "anniversary", "yearly"),
		scheduleEvent(15, "参观展览", 14, "美术馆"),
		scheduleEvent(17, "亲子活动", 10, "城市公园"),
		scheduleEvent(19, "读书会", 19, "图书馆"),
		importantDateEvent(21, "朋友生日", "birthday", "yearly"),
		scheduleEvent(22, "周末晚餐", 18, "滨寿司"),
		importantDateEvent(24, "房租到期", "expiry", "none"),
		scheduleEvent(25, "项目启动会", 9, "三号会议室"),
		scheduleEvent(27, "出差返程", 17, "虹桥站"),
		scheduleEvent(28, "家庭聚餐", 18, "家"),
		scheduleEvent(29, "周末露营", 9, "郊野公园"),
	}
}

func main() {
	if err := run(); err != nil {
		log.Fatalf("补充日历验收数据失败：%v", err)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if !strings.Contains(cfg.DatabaseURL, "/steward_test?") {
		return errors.New("seed-calendar 只允许连接 steward_test 数据库")
	}
	phone := strings.TrimSpace(os.Getenv("STEWARD_CALENDAR_SEED_PHONE"))
	if len(phone) != 11 {
		return errors.New("必须通过 STEWARD_CALENDAR_SEED_PHONE 指定已有测试账号")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	userID, err := findUser(ctx, db, phone)
	if err != nil {
		return err
	}

	var createdTasks, createdEvents int
	err = db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		listID, err := ensureDefaultList(ctx, q, userID)
		if err != nil {
			return err
		}
		createdTasks, createdEvents, err = seedMonth(ctx, q, userID, listID, time.Now())
		return err
	})
	if err != nil {
		return err
	}
	log.Printf("日历验收数据已补充：任务 %d 条，日程 %d 条", createdTasks, createdEvents)
	return nil
}

func findUser(ctx context.Context, db *database.DB, phone string) (string, error) {
	var userID string
	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := tx.QueryRow(ctx, `SELECT id FROM auth_find_user_by_phone($1)`, phone).Scan(&userID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", errors.New("指定测试账号不存在，请先登录一次")
		}
		return "", err
	}
	return userID, tx.Commit(ctx)
}

func ensureDefaultList(ctx context.Context, q *dbgen.Queries, userID string) (string, error) {
	list, err := q.GetDefaultTaskList(ctx)
	if err == nil {
		return list.ID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	count, err := q.CountTaskLists(ctx)
	if err != nil {
		return "", err
	}
	color := "green"
	created, err := q.CreateTaskList(ctx, dbgen.CreateTaskListParams{
		ID: idgen.New(idgen.PrefixTaskList), UserID: userID,
		Name: "默认清单", Color: &color, Position: count, IsDefault: true, ListKind: "tasks",
	})
	if err != nil {
		return "", err
	}
	return created.ID, nil
}

func seedMonth(
	ctx context.Context,
	q *dbgen.Queries,
	userID string,
	listID string,
	now time.Time,
) (int, int, error) {
	loc, err := time.LoadLocation(seedTimezone)
	if err != nil {
		return 0, 0, err
	}
	anchor := now.In(loc)
	monthStart := time.Date(anchor.Year(), anchor.Month(), 1, 0, 0, 0, 0, loc)
	monthEnd := monthStart.AddDate(0, 1, 0).Add(-time.Nanosecond)

	existingTasks, err := q.ListTasksInRange(ctx, dbgen.ListTasksInRangeParams{
		FromDate: monthStart, ToDate: monthEnd, FromAt: monthStart, ToAt: monthEnd,
	})
	if err != nil {
		return 0, 0, err
	}
	existingTaskKeys := make(map[string]struct{}, len(existingTasks))
	for _, task := range existingTasks {
		if task.DueDate != nil {
			existingTaskKeys[calendarKey(task.Title, task.DueDate.In(loc))] = struct{}{}
		}
	}

	tasks := []struct {
		day      int
		title    string
		priority string
	}{
		{3, "洗衣服", "normal"},
		{4, "准备评审材料", "high"},
		{7, "整理差旅报销", "normal"},
		{9, "采购旅行用品", "normal"},
		{11, "更新产品文档", "high"},
		{14, "预约年度体检", "normal"},
		{18, "阅读计划", "normal"},
		{20, "归还图书", "normal"},
		{23, "周末大扫除", "normal"},
		{26, "打包出差行李", "high"},
		{28, "整理旅行照片", "low"},
		{30, "完成月度复盘", "normal"},
	}
	createdTasks := 0
	for _, spec := range tasks {
		date := time.Date(anchor.Year(), anchor.Month(), spec.day, 0, 0, 0, 0, loc)
		if _, exists := existingTaskKeys[calendarKey(spec.title, date)]; exists {
			continue
		}
		tz := seedTimezone
		if _, err := q.CreateTask(ctx, dbgen.CreateTaskParams{
			ID: idgen.New(idgen.PrefixTask), UserID: userID,
			Title: spec.title, Status: "todo", Priority: spec.priority,
			DueDate: &date, DueTimezone: &tz, ListID: listID,
			Reminders: emptyArray, CreatedBy: "user", ProvenanceRefs: emptyArray,
		}); err != nil {
			return createdTasks, 0, fmt.Errorf("创建任务 %s 失败：%w", spec.title, err)
		}
		createdTasks++
	}

	listKind := "tasks"
	existingUnscheduled, err := q.ListTasks(ctx, dbgen.ListTasksParams{
		Statuses: []string{"todo"}, ListKind: &listKind, Unscheduled: true, RowLimit: 100,
	})
	if err != nil {
		return createdTasks, 0, err
	}
	existingUnscheduledTitles := make(map[string]struct{}, len(existingUnscheduled))
	for _, task := range existingUnscheduled {
		existingUnscheduledTitles[task.Title] = struct{}{}
	}
	unscheduledTasks := []struct {
		title    string
		priority string
	}{
		{"整理旧照片", "normal"},
		{"读完收藏文章", "low"},
		{"更新家庭物品清单", "high"},
	}
	for _, spec := range unscheduledTasks {
		if _, exists := existingUnscheduledTitles[spec.title]; exists {
			continue
		}
		if _, err := q.CreateTask(ctx, dbgen.CreateTaskParams{
			ID: idgen.New(idgen.PrefixTask), UserID: userID,
			Title: spec.title, Status: "todo", Priority: spec.priority,
			ListID: listID, Reminders: emptyArray, CreatedBy: "user", ProvenanceRefs: emptyArray,
		}); err != nil {
			return createdTasks, 0, fmt.Errorf("创建随时可做任务 %s 失败：%w", spec.title, err)
		}
		createdTasks++
	}

	existingEvents, err := q.ListEventsInRange(ctx, dbgen.ListEventsInRangeParams{
		FromAt: monthStart, ToAt: monthEnd, FromDate: monthStart, ToDate: monthEnd,
	})
	if err != nil {
		return createdTasks, 0, err
	}
	existingEventKeys := make(map[string]struct{}, len(existingEvents))
	existingYearlyImportantTitles := make(map[string]struct{})
	for _, event := range existingEvents {
		date := event.StartDate
		if date == nil {
			date = event.StartAt
		}
		if date != nil {
			existingEventKeys[calendarKey(event.Title, date.In(loc))] = struct{}{}
		}
		if event.EventKind == "important_date" && event.Recurrence == "yearly" {
			existingYearlyImportantTitles[event.Title] = struct{}{}
		}
	}

	createdEvents := 0
	for _, spec := range calendarEventSpecs() {
		date := time.Date(anchor.Year(), anchor.Month(), spec.day, 0, 0, 0, 0, loc)
		if spec.recurrence == "yearly" {
			if _, exists := existingYearlyImportantTitles[spec.title]; exists {
				continue
			}
		}
		if _, exists := existingEventKeys[calendarKey(spec.title, date)]; exists {
			continue
		}
		params := newSeedEventParams(spec, date, userID)
		if _, err := q.CreateEvent(ctx, params); err != nil {
			return createdTasks, createdEvents, fmt.Errorf("创建日程 %s 失败：%w", spec.title, err)
		}
		if spec.recurrence == "yearly" {
			existingYearlyImportantTitles[spec.title] = struct{}{}
		}
		createdEvents++
	}
	return createdTasks, createdEvents, nil
}

func newSeedEventParams(
	spec calendarEventSpec,
	date time.Time,
	userID string,
) dbgen.CreateEventParams {
	params := dbgen.CreateEventParams{
		ID: idgen.New(idgen.PrefixEvent), UserID: userID,
		Title: spec.title, EventKind: spec.eventKind, Timezone: seedTimezone,
		Participants: emptyArray, Reminders: emptyArray, Recurrence: spec.recurrence,
		CreatedBy: "user", ProvenanceRefs: emptyArray,
	}
	if spec.eventKind == "important_date" {
		params.AllDay = true
		params.StartDate = &date
		params.ImportantDateKind = &spec.importantDateKind
		if spec.recurrence == "yearly" {
			monthDay := timeutil.MonthDay(date)
			params.OriginalMonthDay = &monthDay
		}
		return params
	}

	start := time.Date(date.Year(), date.Month(), date.Day(), spec.hour, 0, 0, 0, date.Location())
	end := start.Add(time.Hour)
	params.StartAt = &start
	params.EndAt = &end
	if spec.location != "" {
		params.Location = &spec.location
	}
	return params
}

func calendarKey(title string, date time.Time) string {
	return fmt.Sprintf("%s|%04d-%02d-%02d", title, date.Year(), date.Month(), date.Day())
}
