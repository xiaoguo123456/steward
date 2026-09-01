package objects

import (
	"context"
	"strings"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// EventFilter 是 Event 列表查询条件。
type EventFilter struct {
	Kind       *string
	ProjectID  *string
	FromDate   *time.Time
	ToDate     *time.Time
	CursorTime *time.Time
	CursorID   *string
	Limit      int32
}

// ListEvents 按条件查询 Event。
func (s *Service) ListEvents(ctx context.Context, userID string, f EventFilter) ([]dbgen.Event, string, error) {
	var out []dbgen.Event
	var tz string
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		zone, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		tz = zone
		loc := timeutil.LoadLocation(zone)

		params := dbgen.ListEventsParams{
			EventKind:       f.Kind,
			ProjectID:       f.ProjectID,
			CursorCreatedAt: f.CursorTime,
			CursorID:        f.CursorID,
			RowLimit:        f.Limit,
		}
		if f.FromDate != nil && f.ToDate != nil {
			from := timeutil.DayOf(*f.FromDate, loc).Start
			to := timeutil.DayOf(*f.ToDate, loc).End
			params.FromAt = &from
			params.ToAt = to
			params.FromDate = *f.FromDate
			params.ToDate = *f.ToDate
		} else {
			// 未给范围时用零值占位，SQL 中的 from_at IS NULL 分支会放行全部。
			params.ToAt = time.Time{}
			params.FromDate = time.Time{}
			params.ToDate = time.Time{}
		}

		rows, err := q.ListEvents(ctx, params)
		if err != nil {
			return apperr.Internal(err)
		}
		out = rows
		return nil
	})
	return out, tz, err
}

// GetEvent 读取单个 Event。
func (s *Service) GetEvent(ctx context.Context, userID, eventID string) (dbgen.Event, error) {
	var out dbgen.Event
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetEvent(ctx, eventID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("日程")
			}
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// CreateEvent 新建 Event。
func (s *Service) CreateEvent(ctx context.Context, userID string, body httpapi.CreateEventRequest) (dbgen.Event, error) {
	var out dbgen.Event
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		created, err := s.CreateUserEventInTx(ctx, q, userID, body)
		if err != nil {
			return err
		}

		if _, err := s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action:       "created",
				ResourceType: "event",
				ResourceID:   created.ID,
				Title:        created.Title,
				Summary:      "创建了日程",
			}}); err != nil {
			return err
		}
		out = created
		return nil
	})
	return out, err
}

// CreateUserEventInTx 供其他领域在同一事务内创建由用户表单提交的 Event。
// 关联关系必须由调用方在本事务中写入，避免出现事件已创建但人物关联失败的半状态。
func (s *Service) CreateUserEventInTx(
	ctx context.Context,
	q *dbgen.Queries,
	userID string,
	body httpapi.CreateEventRequest,
) (dbgen.Event, error) {
	title := strings.TrimSpace(body.Title)
	if title == "" {
		return dbgen.Event{}, apperr.Validation(apperr.Field("title", "标题不能为空。"))
	}
	if err := validateEventTiming(body.AllDay, body.StartAt, body.EndAt,
		timePtrOfDate(body.StartDate), timePtrOfDate(body.EndDate)); err != nil {
		return dbgen.Event{}, err
	}

	kind := "schedule"
	if body.EventKind != nil {
		kind = string(*body.EventKind)
	}
	recurrence := "none"
	if body.Recurrence != nil {
		recurrence = string(*body.Recurrence)
	}
	if recurrence == "yearly" && kind != "important_date" {
		return dbgen.Event{}, apperr.New(apperr.CodeEventRecurrenceDenied)
	}
	if recurrence == "yearly" && !body.AllDay {
		return dbgen.Event{}, apperr.Newf(apperr.CodeEventRecurrenceDenied,
			"按年重复的重要日必须是全天事件。")
	}

	tz, err := s.users.Timezone(ctx, q, userID)
	if err != nil {
		return dbgen.Event{}, err
	}
	if body.Timezone != nil && strings.TrimSpace(*body.Timezone) != "" {
		tz = *body.Timezone
	}
	if err := timeutil.ValidateLocation(tz); err != nil {
		return dbgen.Event{}, apperr.Validation(apperr.Field("timezone", "时区名称不合法。"))
	}
	if body.ProjectId != nil {
		if err := s.assertProjectExists(ctx, q, *body.ProjectId); err != nil {
			return dbgen.Event{}, err
		}
	}

	reminders, err := buildReminders(body.Reminders, !body.AllDay)
	if err != nil {
		return dbgen.Event{}, err
	}
	remindersJSON, err := marshalJSON(reminders)
	if err != nil {
		return dbgen.Event{}, err
	}
	participantsJSON, err := marshalJSON(body.Participants)
	if err != nil {
		return dbgen.Event{}, err
	}
	itineraryJSON, err := s.normalizeItineraryDetails(ctx, q, userID, body.ItineraryDetails, itineraryState{
		ProjectID: body.ProjectId,
		AllDay:    body.AllDay,
		StartAt:   body.StartAt,
		EndAt:     body.EndAt,
		Location:  body.Location,
	})
	if err != nil {
		return dbgen.Event{}, err
	}

	var originalMonthDay *string
	if recurrence == "yearly" && body.StartDate != nil {
		md := timeutil.MonthDay(body.StartDate.Time)
		originalMonthDay = &md
	}
	created, err := q.CreateEvent(ctx, dbgen.CreateEventParams{
		ID: idgen.New(idgen.PrefixEvent), UserID: userID, Title: title,
		EventKind: kind, AllDay: body.AllDay, StartAt: body.StartAt, EndAt: body.EndAt,
		StartDate: timePtrOfDate(body.StartDate), EndDate: timePtrOfDate(body.EndDate),
		Timezone: tz, Location: body.Location, ItineraryDetails: itineraryJSON,
		Participants: participantsJSON, ProjectID: body.ProjectId, Note: body.Note,
		Reminders: remindersJSON, Recurrence: recurrence, OriginalMonthDay: originalMonthDay,
		ImportantDateKind: importantDateKindOf(body.EventKind, body.ImportantDateKind),
		CreatedBy:         "user", ProvenanceRefs: emptyJSONArray,
	})
	if err != nil {
		return dbgen.Event{}, apperr.Internal(err)
	}
	return created, nil
}

// EventUpdate 是 Event 的修改意图。
type EventUpdate struct {
	Body            httpapi.UpdateEventRequest
	ExpectedVersion *int32
}

// UpdateEvent 修改 Event。
func (s *Service) UpdateEvent(ctx context.Context, userID, eventID string, in EventUpdate) (dbgen.Event, error) {
	var out dbgen.Event
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		updated, _, err := s.UpdateEventInTx(ctx, q, userID, eventID, in,
			activity.SourceUserForm, nil)
		out = updated
		return err
	})
	return out, err
}

// UpdateEventInTx 在调用方事务内修改 Event，并复用同一套时间、版本和处理状态校验。
func (s *Service) UpdateEventInTx(ctx context.Context, q *dbgen.Queries, userID, eventID string,
	in EventUpdate, source activity.Source, sourceID *string) (dbgen.Event, string, error) {

	current, err := q.GetEvent(ctx, eventID)
	if err != nil {
		if database.IsNoRows(err) {
			return dbgen.Event{}, "", apperr.NotFound("日程")
		}
		return dbgen.Event{}, "", apperr.Internal(err)
	}
	if in.ExpectedVersion != nil && *in.ExpectedVersion != current.Version {
		return dbgen.Event{}, "", apperr.New(apperr.CodeVersionConflict)
	}

	body := in.Body
	clear := eventClearFlagsOf(body.Clear)

	// 用修改后的完整状态重新校验时间组合，避免出现两组字段同时存在。
	allDay := current.AllDay
	if body.AllDay != nil {
		allDay = *body.AllDay
	}
	startAt := pickTime(body.StartAt, current.StartAt, clear.StartAt)
	endAt := pickTime(body.EndAt, current.EndAt, clear.EndAt)
	startDate := pickDate(body.StartDate, current.StartDate, clear.StartDate)
	endDate := pickDate(body.EndDate, current.EndDate, clear.EndDate)
	if err := validateEventTiming(allDay, startAt, endAt, startDate, endDate); err != nil {
		return dbgen.Event{}, "", err
	}

	kind := current.EventKind
	if body.EventKind != nil {
		kind = string(*body.EventKind)
	}
	recurrence := current.Recurrence
	if body.Recurrence != nil {
		recurrence = string(*body.Recurrence)
	}
	if recurrence == "yearly" && kind != "important_date" {
		return dbgen.Event{}, "", apperr.New(apperr.CodeEventRecurrenceDenied)
	}

	setHandledAt, handledAt, err := resolveImportantDateHandledAt(importantDateHandlingInput{
		Current:    current.ImportantDateHandledAt,
		Kind:       kind,
		Recurrence: recurrence,
		Explicit:   body.ImportantDateHandled,
		Reset:      importantDateIdentityChanged(current, body.StartDate, clear.StartDate, kind, recurrence),
		Now:        time.Now().UTC(),
	})
	if err != nil {
		return dbgen.Event{}, "", err
	}

	projectID := pickString(body.ProjectId, current.ProjectID, clear.ProjectID)
	if projectID != nil {
		if err := s.assertProjectExists(ctx, q, *projectID); err != nil {
			return dbgen.Event{}, "", err
		}
	}
	location := pickString(body.Location, current.Location, clear.Location)
	itineraryDetails := unmarshalItineraryDetails(current.ItineraryDetails)
	if clear.ItineraryDetails {
		itineraryDetails = nil
	} else if body.ItineraryDetails != nil {
		itineraryDetails = body.ItineraryDetails
	}
	itineraryJSON, err := s.normalizeItineraryDetails(ctx, q, userID, itineraryDetails, itineraryState{
		ProjectID: projectID,
		AllDay:    allDay,
		StartAt:   startAt,
		EndAt:     endAt,
		Location:  location,
	})
	if err != nil {
		return dbgen.Event{}, "", err
	}

	var remindersJSON []byte
	if body.Reminders != nil {
		reminders, err := buildReminders(body.Reminders, !allDay)
		if err != nil {
			return dbgen.Event{}, "", err
		}
		remindersJSON, err = marshalJSON(reminders)
		if err != nil {
			return dbgen.Event{}, "", err
		}
	}
	var participantsJSON []byte
	if body.Participants != nil {
		participantsJSON, err = marshalJSON(body.Participants)
		if err != nil {
			return dbgen.Event{}, "", err
		}
	}

	var originalMonthDay *string
	if recurrence == "yearly" && startDate != nil {
		md := timeutil.MonthDay(*startDate)
		originalMonthDay = &md
	}

	updated, err := q.UpdateEvent(ctx, dbgen.UpdateEventParams{
		ID:                        eventID,
		Title:                     trimmedOrNil(body.Title),
		EventKind:                 optionalString(body.EventKind != nil, kind),
		AllDay:                    body.AllDay,
		StartAt:                   body.StartAt,
		ClearStartAt:              clear.StartAt,
		EndAt:                     body.EndAt,
		ClearEndAt:                clear.EndAt,
		StartDate:                 timePtrOfDate(body.StartDate),
		ClearStartDate:            clear.StartDate,
		EndDate:                   timePtrOfDate(body.EndDate),
		ClearEndDate:              clear.EndDate,
		Timezone:                  body.Timezone,
		Location:                  body.Location,
		ClearLocation:             clear.Location,
		ItineraryDetails:          itineraryJSON,
		ClearItineraryDetails:     clear.ItineraryDetails,
		Participants:              participantsJSON,
		ClearParticipants:         clear.Participants,
		ProjectID:                 body.ProjectId,
		ClearProjectID:            clear.ProjectID,
		Note:                      body.Note,
		ClearNote:                 clear.Note,
		Reminders:                 remindersJSON,
		ClearReminders:            clear.Reminders,
		Recurrence:                optionalString(body.Recurrence != nil, recurrence),
		OriginalMonthDay:          originalMonthDay,
		ImportantDateKind:         importantDateKindOf(body.EventKind, body.ImportantDateKind),
		SetImportantDateHandledAt: setHandledAt,
		ImportantDateHandledAt:    handledAt,
	})
	if err != nil {
		return dbgen.Event{}, "", apperr.Internal(err)
	}

	batchID, err := s.activity.Record(ctx, q, userID, source, sourceID,
		[]activity.EntryInput{{
			Action:       "updated",
			ResourceType: "event",
			ResourceID:   updated.ID,
			Title:        updated.Title,
			Summary:      eventUpdateSummary(body),
			BeforeState:  eventUndoState(current),
			AfterState:   eventUndoState(updated),
		}})
	if err != nil {
		return dbgen.Event{}, "", err
	}
	return updated, batchID, nil
}

// DeleteEvent 软删除 Event。
func (s *Service) DeleteEvent(ctx context.Context, userID, eventID string) (string, error) {
	var batchID string
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetEvent(ctx, eventID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("日程")
			}
			return apperr.Internal(err)
		}
		if _, err := q.SoftDeleteEvent(ctx, eventID); err != nil {
			return apperr.Internal(err)
		}
		batchID, err = s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action:       "deleted",
				ResourceType: "event",
				ResourceID:   eventID,
				Title:        current.Title,
				Summary:      "删除了日程",
				BeforeState:  eventUndoState(current),
			}})
		return err
	})
	return batchID, err
}

type eventClearFlags struct {
	StartAt          bool
	EndAt            bool
	StartDate        bool
	EndDate          bool
	Location         bool
	Participants     bool
	ProjectID        bool
	Note             bool
	Reminders        bool
	ItineraryDetails bool
}

type importantDateHandlingInput struct {
	Current    *time.Time
	Kind       string
	Recurrence string
	Explicit   *bool
	Reset      bool
	Now        time.Time
}

func importantDateIdentityChanged(current dbgen.Event, startDate *openapi_types.Date,
	clearStartDate bool, kind, recurrence string) bool {

	if clearStartDate && current.StartDate != nil {
		return true
	}
	if startDate != nil && (current.StartDate == nil ||
		timeutil.FormatDate(startDate.Time) != timeutil.FormatDate(*current.StartDate)) {
		return true
	}
	return kind != current.EventKind || recurrence != current.Recurrence
}

// resolveImportantDateHandledAt 把“已处理”限定为显式命令；日期过期不会调用它写入状态。
func resolveImportantDateHandledAt(in importantDateHandlingInput) (bool, *time.Time, error) {
	if in.Explicit != nil {
		if in.Kind != "important_date" {
			return false, nil, apperr.Validation(apperr.Field(
				"important_date_handled", "只有重要日可以标记已处理。"))
		}
		if *in.Explicit && in.Recurrence != "none" {
			return false, nil, apperr.Validation(apperr.Field(
				"important_date_handled", "每年重复的重要日不能永久标记为已处理。"))
		}
		if !*in.Explicit {
			return true, nil, nil
		}
		handledAt := in.Now
		return true, &handledAt, nil
	}

	// 新日期是一条新的待关注事实；切换类型或重复规则也不能继承旧处理状态。
	if in.Reset && in.Current != nil {
		return true, nil, nil
	}
	return false, nil, nil
}

func eventUpdateSummary(body httpapi.UpdateEventRequest) string {
	if body.ImportantDateHandled != nil {
		if *body.ImportantDateHandled {
			return "标记重要日已处理"
		}
		return "恢复了重要日"
	}
	return "修改了日程"
}

func eventClearFlagsOf(clear *[]httpapi.UpdateEventRequestClear) eventClearFlags {
	var f eventClearFlags
	if clear == nil {
		return f
	}
	for _, item := range *clear {
		switch item {
		case httpapi.UpdateEventRequestClearStartAt:
			f.StartAt = true
		case httpapi.UpdateEventRequestClearEndAt:
			f.EndAt = true
		case httpapi.UpdateEventRequestClearStartDate:
			f.StartDate = true
		case httpapi.UpdateEventRequestClearEndDate:
			f.EndDate = true
		case httpapi.UpdateEventRequestClearLocation:
			f.Location = true
		case httpapi.UpdateEventRequestClearParticipants:
			f.Participants = true
		case httpapi.UpdateEventRequestClearProjectId:
			f.ProjectID = true
		case httpapi.UpdateEventRequestClearNote:
			f.Note = true
		case httpapi.UpdateEventRequestClearReminders:
			f.Reminders = true
		case httpapi.UpdateEventRequestClearItineraryDetails:
			f.ItineraryDetails = true
		}
	}
	return f
}

// pickTime 计算修改后的时刻字段：清除优先，其次是新值，最后保持原值。
func pickTime(next *time.Time, current *time.Time, cleared bool) *time.Time {
	if cleared {
		return nil
	}
	if next != nil {
		return next
	}
	return current
}

func pickDate(next *openapi_types.Date, current *time.Time, cleared bool) *time.Time {
	if cleared {
		return nil
	}
	if next != nil {
		t := next.Time
		return &t
	}
	return current
}

func pickString(next *string, current *string, cleared bool) *string {
	if cleared {
		return nil
	}
	if next != nil {
		return next
	}
	return current
}

func optionalString(present bool, value string) *string {
	if !present {
		return nil
	}
	return &value
}

func eventUndoState(e dbgen.Event) map[string]any {
	return map[string]any{
		"title":                     e.Title,
		"all_day":                   e.AllDay,
		"start_at":                  e.StartAt,
		"start_date":                e.StartDate,
		"important_date_handled_at": e.ImportantDateHandledAt,
		"itinerary_details":         unmarshalItineraryDetails(e.ItineraryDetails),
		"deleted":                   e.DeletedAt != nil,
		"version":                   e.Version,
	}
}

// importantDateKindOf 把重要日预设收敛成可以直接写库的值。
//
// 数据库上有一条约束：只有 event_kind=important_date 才允许带预设。
// 这里提前挡掉，让用户看到校验错误而不是一条数据库约束报错。
func importantDateKindOf(kind *httpapi.EventKind, preset *httpapi.ImportantDateKind) *string {
	if preset == nil {
		return nil
	}
	if kind == nil || *kind != httpapi.EventKindImportantDate {
		return nil
	}
	v := string(*preset)
	return &v
}
