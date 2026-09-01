package moodjournal

import (
	"context"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/domain/notecontent"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// API 把生成的 strict server 接口映射到心情日记服务。
type API struct{ svc *Service }

// NewAPI 构造心情日记 API。
func NewAPI(svc *Service) *API { return &API{svc: svc} }

// ListMoodJournalEntries 查询心情日记。
func (h *API) ListMoodJournalEntries(ctx context.Context, req httpapi.ListMoodJournalEntriesRequestObject) (httpapi.ListMoodJournalEntriesResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	timezone, err := h.svc.Timezone(ctx, userID)
	if err != nil {
		return nil, err
	}
	loc := timeutil.LoadLocation(timezone)
	filter := Filter{Query: req.Params.Q, Limit: httpx.PageLimit(req.Params.Limit) + 1}
	if req.Params.From != nil {
		start := timeutil.DayOf(req.Params.From.Time, loc).Start
		filter.FromAt = &start
	}
	if req.Params.To != nil {
		end := timeutil.DayOf(req.Params.To.Time, loc).End
		filter.ToAt = &end
	}
	if req.Params.Cursor != nil {
		cursor, err := httpx.DecodeCursor(req.Params.Cursor)
		if err != nil {
			return nil, err
		}
		if cursor != nil {
			filter.CursorOccurredAt, filter.CursorID = &cursor.Time, &cursor.ID
		}
	}
	rows, err := h.svc.List(ctx, userID, filter)
	if err != nil {
		return nil, err
	}
	limit := httpx.PageLimit(req.Params.Limit)
	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	data := make([]httpapi.MoodJournalEntry, 0, len(rows))
	for _, row := range rows {
		mapped, err := mapEntry(row)
		if err != nil {
			return nil, err
		}
		data = append(data, mapped)
	}
	next := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		next = httpx.EncodeCursor(last.OccurredAt, last.ID)
	}
	return httpapi.ListMoodJournalEntries200JSONResponse{
		Data: data, Page: httpx.PageOf(hasMore, next), Meta: httpx.Meta(ctx),
	}, nil
}

// CreateMoodJournalEntry 新建心情日记。
func (h *API) CreateMoodJournalEntry(ctx context.Context, req httpapi.CreateMoodJournalEntryRequestObject) (httpapi.CreateMoodJournalEntryResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	created, err := h.svc.Create(ctx, userID, *req.Body)
	if err != nil {
		return nil, err
	}
	mapped, err := mapEntry(created)
	if err != nil {
		return nil, err
	}
	return httpapi.CreateMoodJournalEntry201JSONResponse{Data: mapped, Meta: httpx.Meta(ctx)}, nil
}

// GetMoodJournalEntry 读取心情日记。
func (h *API) GetMoodJournalEntry(ctx context.Context, req httpapi.GetMoodJournalEntryRequestObject) (httpapi.GetMoodJournalEntryResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	entry, err := h.svc.Get(ctx, userID, req.EntryId)
	if err != nil {
		return nil, err
	}
	mapped, err := mapEntry(entry)
	if err != nil {
		return nil, err
	}
	return httpapi.GetMoodJournalEntry200JSONResponse{Data: mapped, Meta: httpx.Meta(ctx)}, nil
}

// UpdateMoodJournalEntry 修改心情日记。
func (h *API) UpdateMoodJournalEntry(ctx context.Context, req httpapi.UpdateMoodJournalEntryRequestObject) (httpapi.UpdateMoodJournalEntryResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	entry, err := h.svc.Update(ctx, userID, req.EntryId, *req.Body, httpx.ParseIfMatch(req.Params.IfMatch))
	if err != nil {
		return nil, err
	}
	mapped, err := mapEntry(entry)
	if err != nil {
		return nil, err
	}
	return httpapi.UpdateMoodJournalEntry200JSONResponse{Data: mapped, Meta: httpx.Meta(ctx)}, nil
}

// DeleteMoodJournalEntry 删除心情日记。
func (h *API) DeleteMoodJournalEntry(ctx context.Context, req httpapi.DeleteMoodJournalEntryRequestObject) (httpapi.DeleteMoodJournalEntryResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	batchID, err := h.svc.Delete(ctx, userID, req.EntryId)
	if err != nil {
		return nil, err
	}
	return httpapi.DeleteMoodJournalEntry200JSONResponse(httpx.Mutation(ctx, batchID,
		httpx.Resource(httpapi.AffectedResourceTypeNote, req.EntryId),
		httpx.Resource(httpapi.AffectedResourceTypeActivity, ""),
	)), nil
}

// PolishMoodJournalDraft 返回待用户检查的一次性排版润色候选，不写入日记。
func (h *API) PolishMoodJournalDraft(ctx context.Context, req httpapi.PolishMoodJournalDraftRequestObject) (httpapi.PolishMoodJournalDraftResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	result, err := h.svc.PolishDraft(ctx, userID, *req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.PolishMoodJournalDraft200JSONResponse{
		Data: result,
		Meta: httpx.Meta(ctx),
	}, nil
}

// GetMoodJournalCalendar 查询日历标记。
func (h *API) GetMoodJournalCalendar(ctx context.Context, req httpapi.GetMoodJournalCalendarRequestObject) (httpapi.GetMoodJournalCalendarResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	timezone, fromAt, toAt, err := h.rangeForDates(ctx, userID, req.Params.From.Time, req.Params.To.Time)
	if err != nil {
		return nil, err
	}
	rows, err := h.svc.Calendar(ctx, userID, timezone, fromAt, toAt)
	if err != nil {
		return nil, err
	}
	data := make([]httpapi.MoodJournalCalendarDay, 0, len(rows))
	for _, row := range rows {
		data = append(data, httpapi.MoodJournalCalendarDay{
			Date: openapi_types.Date{Time: row.Date}, Count: int(row.Count),
		})
	}
	return httpapi.GetMoodJournalCalendar200JSONResponse{Data: data, Meta: httpx.Meta(ctx)}, nil
}

// GetMoodJournalStatistics 查询确定性统计。
func (h *API) GetMoodJournalStatistics(ctx context.Context, req httpapi.GetMoodJournalStatisticsRequestObject) (httpapi.GetMoodJournalStatisticsResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	timezone, fromAt, toAt, err := h.rangeForDates(ctx, userID, req.Params.From.Time, req.Params.To.Time)
	if err != nil {
		return nil, err
	}
	statistics, err := h.svc.Statistics(ctx, userID, timezone, fromAt, toAt)
	if err != nil {
		return nil, err
	}
	moods := []httpapi.MoodLevel{httpapi.MoodLevelVeryLow, httpapi.MoodLevelLow,
		httpapi.MoodLevelNeutral, httpapi.MoodLevelGood, httpapi.MoodLevelVeryGood}
	distribution := make([]httpapi.MoodCount, 0, len(moods))
	for _, mood := range moods {
		distribution = append(distribution, httpapi.MoodCount{
			MoodLevel: mood, Count: int(statistics.MoodDistribution[string(mood)]),
		})
	}
	words := make([]httpapi.EmotionWordCount, 0, len(statistics.EmotionWords))
	for _, word := range statistics.EmotionWords {
		words = append(words, httpapi.EmotionWordCount{Word: word.Word, Count: int(word.Count)})
	}
	return httpapi.GetMoodJournalStatistics200JSONResponse{
		Data: httpapi.MoodJournalStatistics{
			PeriodStart: openapi_types.Date{Time: req.Params.From.Time},
			PeriodEnd:   openapi_types.Date{Time: req.Params.To.Time},
			EntryCount:  int(statistics.EntryCount), WritingDayCount: int(statistics.WritingDayCount),
			MoodDistribution: distribution, EmotionWords: words,
		},
		Meta: httpx.Meta(ctx),
	}, nil
}

func (h *API) rangeForDates(ctx context.Context, userID string, from, to time.Time) (string, time.Time, time.Time, error) {
	timezone, err := h.svc.Timezone(ctx, userID)
	if err != nil {
		return "", time.Time{}, time.Time{}, err
	}
	loc := timeutil.LoadLocation(timezone)
	start := timeutil.DayOf(from, loc).Start
	end := timeutil.DayOf(to, loc).End
	return timezone, start, end, nil
}

func mapEntry(entry Entry) (httpapi.MoodJournalEntry, error) {
	content, err := notecontent.DecodeBlocksV1(entry.ContentDocument)
	if err != nil {
		return httpapi.MoodJournalEntry{}, err
	}
	plaintext := entry.Content
	out := httpapi.MoodJournalEntry{
		Id: entry.ID, Title: entry.Title, Content: content, ContentPlaintext: &plaintext,
		OccurredAt: entry.OccurredAt, EmotionWords: nonNil(entry.EmotionWords),
		ContextWords: nonNil(entry.ContextWords), ExcludeFromAi: entry.ExcludeFromAI,
		IncludeInMemories: entry.IncludeInMemories, VisualSeed: int(entry.VisualSeed),
		CreatedAt: entry.CreatedAt, UpdatedAt: entry.UpdatedAt, Version: int(entry.Version),
	}
	if entry.MoodLevel != nil {
		value := httpapi.MoodLevel(*entry.MoodLevel)
		out.MoodLevel = &value
	}
	if entry.EnergyLevel != nil {
		value := httpapi.EnergyLevel(*entry.EnergyLevel)
		out.EnergyLevel = &value
	}
	return out, nil
}

func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}
