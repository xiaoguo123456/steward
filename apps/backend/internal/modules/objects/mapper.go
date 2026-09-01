package objects

import (
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/domain/notecontent"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// MapTask 把存储行映射成契约 DTO。
func MapTask(row dbgen.Task) httpapi.Task {
	return httpapi.Task{
		Id:                row.ID,
		Type:              httpapi.TaskTypeTask,
		Title:             row.Title,
		Description:       row.Description,
		Status:            httpapi.TaskStatus(row.Status),
		Priority:          httpapi.TaskPriority(row.Priority),
		DueDate:           dateOrNil(row.DueDate),
		DueAt:             row.DueAt,
		DueTimezone:       row.DueTimezone,
		ScheduledStartAt:  row.ScheduledStartAt,
		ScheduledEndAt:    row.ScheduledEndAt,
		ScheduledTimezone: row.ScheduledTimezone,
		EstimatedMinutes:  intPtr(row.EstimatedMinutes),
		QuantityText:      row.QuantityText,
		ShoppingCategory:  shoppingCategoryPtr(row.ShoppingCategory),
		FocusDate:         dateOrNil(row.FocusDate),
		ListId:            row.ListID,
		ProjectId:         row.ProjectID,
		Reminders:         unmarshalReminders(row.Reminders),
		CompletedAt:       row.CompletedAt,
		CreatedBy:         httpapi.CreatedBy(row.CreatedBy),
		ProvenanceRefs:    unmarshalProvenance(row.ProvenanceRefs),
		CreatedAt:         row.CreatedAt,
		UpdatedAt:         row.UpdatedAt,
		DeletedAt:         row.DeletedAt,
		Version:           int(row.Version),
	}
}

// MapEvent 把存储行映射成契约 DTO。
func MapEvent(row dbgen.Event) httpapi.Event {
	return httpapi.Event{
		Id:                     row.ID,
		Type:                   httpapi.EventTypeEvent,
		Title:                  row.Title,
		EventKind:              httpapi.EventKind(row.EventKind),
		AllDay:                 row.AllDay,
		StartAt:                row.StartAt,
		EndAt:                  row.EndAt,
		StartDate:              dateOrNil(row.StartDate),
		EndDate:                dateOrNil(row.EndDate),
		Timezone:               row.Timezone,
		Location:               row.Location,
		ItineraryDetails:       unmarshalItineraryDetails(row.ItineraryDetails),
		Participants:           unmarshalStrings(row.Participants),
		ProjectId:              row.ProjectID,
		Note:                   row.Note,
		Reminders:              unmarshalReminders(row.Reminders),
		Recurrence:             httpapi.EventRecurrence(row.Recurrence),
		OriginalMonthDay:       row.OriginalMonthDay,
		ImportantDateKind:      importantDateKindPtr(row.ImportantDateKind),
		ImportantDateHandledAt: row.ImportantDateHandledAt,
		CreatedBy:              httpapi.CreatedBy(row.CreatedBy),
		ProvenanceRefs:         unmarshalProvenance(row.ProvenanceRefs),
		CreatedAt:              row.CreatedAt,
		UpdatedAt:              row.UpdatedAt,
		DeletedAt:              row.DeletedAt,
		Version:                int(row.Version),
	}
}

// MapProject 把存储行与进度统计映射成契约 DTO。
func MapProject(p ProjectWithProgress) httpapi.Project {
	total := int(p.Total)
	done := int(p.Done)
	out := httpapi.Project{
		Id:             p.Row.ID,
		Type:           httpapi.ProjectTypeProject,
		Title:          p.Row.Title,
		Description:    p.Row.Description,
		Status:         httpapi.ProjectStatus(p.Row.Status),
		ProjectKind:    projectKindPtr(p.Row.ProjectKind),
		StartDate:      dateOrNil(p.Row.StartDate),
		TargetDate:     dateOrNil(p.Row.TargetDate),
		Progress:       p.Progress(),
		TaskTotal:      &total,
		TaskDone:       &done,
		CreatedBy:      httpapi.CreatedBy(p.Row.CreatedBy),
		ProvenanceRefs: unmarshalProvenance(p.Row.ProvenanceRefs),
		CreatedAt:      p.Row.CreatedAt,
		UpdatedAt:      p.Row.UpdatedAt,
		DeletedAt:      p.Row.DeletedAt,
		Version:        int(p.Row.Version),
	}
	if p.Row.StatusBeforeArchived != nil {
		before := httpapi.ProjectStatus(*p.Row.StatusBeforeArchived)
		out.StatusBeforeArchived = &before
	}
	return out
}

// MapNote 把存储行映射成契约 DTO。
func MapNote(row dbgen.Note) (httpapi.Note, error) {
	tags := row.Tags
	if tags == nil {
		tags = []string{}
	}
	content, err := notecontent.Decode(row.ContentDocument)
	if err != nil {
		return httpapi.Note{}, err
	}
	plaintext := row.Content
	return httpapi.Note{
		Id:               row.ID,
		Type:             httpapi.NoteTypeNote,
		Title:            row.Title,
		Content:          content,
		ContentPlaintext: &plaintext,
		NoteKind:         httpapi.NoteKind(row.NoteKind),
		Attachments:      &[]httpapi.NoteAttachment{},
		Tags:             tags,
		PinnedAt:         row.PinnedAt,
		ProjectId:        row.ProjectID,
		CreatedBy:        httpapi.CreatedBy(row.CreatedBy),
		ProvenanceRefs:   unmarshalProvenance(row.ProvenanceRefs),
		CreatedAt:        row.CreatedAt,
		UpdatedAt:        row.UpdatedAt,
		DeletedAt:        row.DeletedAt,
		Version:          int(row.Version),
	}, nil
}

// ProjectYearlyEvents 把按年重复的重要日投影到查询范围内的具体日期。
//
// 数据库只保存一条原始定义；范围查询时按年份展开，
// 2 月 29 日在非闰年落到 2 月 28 日，但 original_month_day 仍保留原值。
func ProjectYearlyEvents(rows []dbgen.Event, from, to time.Time, tz string) []httpapi.Event {
	loc := timeutil.LoadLocation(tz)
	out := make([]httpapi.Event, 0, len(rows))

	for _, row := range rows {
		if row.Recurrence != "yearly" || row.StartDate == nil {
			out = append(out, MapEvent(row))
			continue
		}

		month, day := row.StartDate.Month(), row.StartDate.Day()
		if row.OriginalMonthDay != nil {
			if m, d, err := timeutil.ParseMonthDay(*row.OriginalMonthDay); err == nil {
				month, day = m, d
			}
		}

		for year := from.Year(); year <= to.Year(); year++ {
			occurrence := timeutil.ProjectYearly(month, day, year, loc)
			if occurrence.Before(from) || occurrence.After(to) {
				continue
			}
			projected := MapEvent(row)
			occ := occurrence
			projected.StartDate = dateOrNil(&occ)
			projected.EndDate = nil
			out = append(out, projected)
		}
	}
	return out
}

func intPtr(v *int32) *int {
	if v == nil {
		return nil
	}
	out := int(*v)
	return &out
}

// importantDateKindPtr 把存储值映射成契约枚举指针。
func importantDateKindPtr(raw *string) *httpapi.ImportantDateKind {
	if raw == nil || *raw == "" {
		return nil
	}
	kind := httpapi.ImportantDateKind(*raw)
	return &kind
}

// shoppingCategoryPtr 把存储值映射成契约枚举指针。
func shoppingCategoryPtr(raw *string) *httpapi.ShoppingCategory {
	if raw == nil || *raw == "" {
		return nil
	}
	category := httpapi.ShoppingCategory(*raw)
	return &category
}

// projectKindPtr 把存储值映射成契约枚举指针。
func projectKindPtr(raw string) *httpapi.ProjectKind {
	kind := httpapi.ProjectKind(raw)
	return &kind
}
