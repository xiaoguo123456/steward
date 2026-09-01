package objects

import (
	"context"
	"testing"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

func TestImportantDateHandlingPersistsAndFiltersActiveReads(t *testing.T) {
	db := shoppingTestDB(t)
	userID := seedShoppingTestUser(t, db)
	service := &Service{db: db, activity: activity.New(db)}
	ctx := context.Background()
	startDate := time.Date(2026, 8, 24, 0, 0, 0, 0, time.UTC)
	kindValue := "expiry"

	var created dbgen.Event
	err := db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		var err error
		created, err = q.CreateEvent(ctx, dbgen.CreateEventParams{
			ID: idgen.New(idgen.PrefixEvent), UserID: userID, Title: "房租到期",
			EventKind: "important_date", AllDay: true, StartDate: &startDate,
			Timezone: "Asia/Shanghai", ItineraryDetails: []byte("{}"),
			Participants: []byte("[]"),
			Reminders:    []byte(`[{"kind":"absolute_local","local_time":"09:00","days_before":0}]`),
			Recurrence:   "none", ImportantDateKind: &kindValue,
			CreatedBy: "user", ProvenanceRefs: []byte("[]"),
		})
		return err
	})
	if err != nil {
		t.Fatalf("预置重要日失败：%v", err)
	}

	handled := true
	version := created.Version
	updated, err := service.UpdateEvent(ctx, userID, created.ID, EventUpdate{
		Body:            httpapi.UpdateEventRequest{ImportantDateHandled: &handled},
		ExpectedVersion: &version,
	})
	if err != nil {
		t.Fatalf("标记重要日已处理失败：%v", err)
	}
	if updated.ImportantDateHandledAt == nil {
		t.Fatal("显式处理状态没有持久化")
	}

	err = db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		kind := "important_date"
		active, err := q.ListEvents(ctx, dbgen.ListEventsParams{
			EventKind: &kind, ExcludeHandled: true, RowLimit: 200,
		})
		if err != nil {
			return err
		}
		if len(active) != 0 {
			t.Fatalf("已处理重要日仍出现在活动查询中：%+v", active)
		}
		history, err := q.ListEvents(ctx, dbgen.ListEventsParams{
			EventKind: &kind, RowLimit: 200,
		})
		if err != nil {
			return err
		}
		if len(history) != 1 || history[0].ID != created.ID {
			t.Fatalf("日历历史查询应保留已处理重要日：%+v", history)
		}
		reminders, err := q.ListEventsWithReminders(ctx, 200)
		if err != nil {
			return err
		}
		if len(reminders) != 0 {
			t.Fatalf("已处理重要日仍进入提醒扫描：%+v", reminders)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	apiDate := openapi_types.Date{Time: startDate}
	apiKind := httpapi.EventKindImportantDate
	recurrence := httpapi.None
	version = updated.Version
	unchanged, err := service.UpdateEvent(ctx, userID, created.ID, EventUpdate{
		Body: httpapi.UpdateEventRequest{
			EventKind: &apiKind, StartDate: &apiDate, Recurrence: &recurrence,
		},
		ExpectedVersion: &version,
	})
	if err != nil {
		t.Fatalf("携带相同完整字段更新失败：%v", err)
	}
	if unchanged.ImportantDateHandledAt == nil {
		t.Fatal("相同日期和语义的完整更新不应清除处理状态")
	}

	newDate := openapi_types.Date{Time: startDate.AddDate(1, 0, 0)}
	version = unchanged.Version
	renewed, err := service.UpdateEvent(ctx, userID, created.ID, EventUpdate{
		Body:            httpapi.UpdateEventRequest{StartDate: &newDate},
		ExpectedVersion: &version,
	})
	if err != nil {
		t.Fatalf("更新重要日日期失败：%v", err)
	}
	if renewed.ImportantDateHandledAt != nil {
		t.Fatal("更新为新日期后应恢复为未处理")
	}
}

func TestUpdateEventClearsImportantDateOnlyFields(t *testing.T) {
	db := shoppingTestDB(t)
	userID := seedShoppingTestUser(t, db)
	service := &Service{db: db, activity: activity.New(db)}
	ctx := context.Background()
	startDate := time.Date(2024, 2, 29, 0, 0, 0, 0, time.UTC)
	kindValue := "birthday"
	originalMonthDay := "02-29"

	var created dbgen.Event
	err := db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		var err error
		created, err = q.CreateEvent(ctx, dbgen.CreateEventParams{
			ID: idgen.New(idgen.PrefixEvent), UserID: userID, Title: "生日",
			EventKind: "important_date", AllDay: true, StartDate: &startDate,
			Timezone: "Asia/Shanghai", ItineraryDetails: []byte("{}"),
			Participants: []byte("[]"), Reminders: []byte("[]"),
			Recurrence: "yearly", OriginalMonthDay: &originalMonthDay,
			ImportantDateKind: &kindValue, CreatedBy: "user", ProvenanceRefs: []byte("[]"),
		})
		return err
	})
	if err != nil {
		t.Fatalf("预置年度重要日失败：%v", err)
	}

	none := httpapi.None
	version := created.Version
	nonRecurring, err := service.UpdateEvent(ctx, userID, created.ID, EventUpdate{
		Body: httpapi.UpdateEventRequest{Recurrence: &none}, ExpectedVersion: &version,
	})
	if err != nil {
		t.Fatalf("取消年度重复失败：%v", err)
	}
	if nonRecurring.OriginalMonthDay != nil {
		t.Fatalf("取消年度重复后仍残留 original_month_day：%q", *nonRecurring.OriginalMonthDay)
	}

	schedule := httpapi.EventKindSchedule
	allDay := false
	startAt := time.Date(2026, 9, 2, 9, 0, 0, 0, time.UTC)
	version = nonRecurring.Version
	converted, err := service.UpdateEvent(ctx, userID, created.ID, EventUpdate{
		Body: httpapi.UpdateEventRequest{
			EventKind: &schedule, AllDay: &allDay, StartAt: &startAt,
			Clear: &[]httpapi.UpdateEventRequestClear{httpapi.UpdateEventRequestClearStartDate},
		},
		ExpectedVersion: &version,
	})
	if err != nil {
		t.Fatalf("重要日转换为普通日程失败：%v", err)
	}
	if converted.ImportantDateKind != nil {
		t.Fatalf("普通日程仍残留 important_date_kind：%q", *converted.ImportantDateKind)
	}
}
