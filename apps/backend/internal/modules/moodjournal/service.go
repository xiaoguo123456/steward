package moodjournal

import (
	"context"
	"hash/fnv"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/domain/notecontent"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

// UserProfile 是读取日期语义所需的最小用户能力。
type UserProfile interface {
	Timezone(ctx context.Context, q *dbgen.Queries, userID string) (string, error)
}

// ActivityRecorder 记录用户可见写入，不保存日记正文。
type ActivityRecorder interface {
	Record(ctx context.Context, q *dbgen.Queries, userID string,
		source activity.Source, sourceID *string, entries []activity.EntryInput) (string, error)
}

// Service 是心情日记应用服务。
type Service struct {
	db       *database.DB
	objects  *objects.Service
	users    UserProfile
	activity ActivityRecorder
}

// New 构造心情日记服务。
func New(db *database.DB, objectSvc *objects.Service, users UserProfile, act ActivityRecorder) *Service {
	return &Service{db: db, objects: objectSvc, users: users, activity: act}
}

// Entry 是 Note 与心情扩展合并后的领域读模型。
type Entry struct {
	ID                string
	Title             string
	Content           string
	ContentDocument   []byte
	OccurredAt        time.Time
	MoodLevel         *string
	EnergyLevel       *string
	EmotionWords      []string
	ContextWords      []string
	ExcludeFromAI     bool
	IncludeInMemories bool
	VisualSeed        int32
	CreatedAt         time.Time
	UpdatedAt         time.Time
	Version           int32
}

// Filter 是心情日记列表条件。ToAt 为开区间。
type Filter struct {
	FromAt           *time.Time
	ToAt             *time.Time
	Query            *string
	CursorOccurredAt *time.Time
	CursorID         *string
	Limit            int32
}

// CalendarDay 是有日记的用户本地日期及篇数。
type CalendarDay struct {
	Date  time.Time
	Count int32
}

// Statistics 是完全由 SQL 计算的阶段统计，不依赖 AI。
type Statistics struct {
	EntryCount       int32
	WritingDayCount  int32
	MoodDistribution map[string]int32
	EmotionWords     []WordCount
}

// WordCount 是感受词频率。
type WordCount struct {
	Word  string
	Count int32
}

// List 查询心情日记。
func (s *Service) List(ctx context.Context, userID string, filter Filter) ([]Entry, error) {
	var out []Entry
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListMoodJournalEntries(ctx, dbgen.ListMoodJournalEntriesParams{
			FromAt: filter.FromAt, ToAt: filter.ToAt, Query: trimmedOrNil(filter.Query),
			CursorOccurredAt: filter.CursorOccurredAt, CursorID: filter.CursorID,
			RowLimit: filter.Limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = make([]Entry, 0, len(rows))
		for _, row := range rows {
			out = append(out, entryFromList(row))
		}
		return nil
	})
	return out, err
}

// Get 读取单篇心情日记。
func (s *Service) Get(ctx context.Context, userID, entryID string) (Entry, error) {
	var out Entry
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetMoodJournalEntry(ctx, entryID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("心情日记")
			}
			return apperr.Internal(err)
		}
		out = entryFromGet(row)
		return nil
	})
	return out, err
}

// Calendar 返回指定闭开时间段内有日记的本地日期。
func (s *Service) Calendar(ctx context.Context, userID, timezone string, fromAt, toAt time.Time) ([]CalendarDay, error) {
	var out []CalendarDay
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListMoodJournalCalendar(ctx, dbgen.ListMoodJournalCalendarParams{
			Timezone: timezone, FromAt: fromAt, ToAt: toAt,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = make([]CalendarDay, 0, len(rows))
		for _, row := range rows {
			out = append(out, CalendarDay{Date: row.Date, Count: row.Count})
		}
		return nil
	})
	return out, err
}

// Statistics 返回篇数、书写天数、五级心情分布和常用感受词。
func (s *Service) Statistics(ctx context.Context, userID, timezone string, fromAt, toAt time.Time) (Statistics, error) {
	out := Statistics{MoodDistribution: map[string]int32{}}
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		counts, err := q.CountMoodJournalEntries(ctx, dbgen.CountMoodJournalEntriesParams{
			Timezone: timezone, FromAt: fromAt, ToAt: toAt,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out.EntryCount = counts.EntryCount
		out.WritingDayCount = counts.WritingDayCount

		moods, err := q.CountMoodJournalMoods(ctx, dbgen.CountMoodJournalMoodsParams{
			FromAt: fromAt, ToAt: toAt,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		for _, row := range moods {
			if row.MoodLevel != nil {
				out.MoodDistribution[*row.MoodLevel] = row.Count
			}
		}

		words, err := q.CountMoodJournalEmotionWords(ctx, dbgen.CountMoodJournalEmotionWordsParams{
			FromAt: fromAt, ToAt: toAt,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out.EmotionWords = make([]WordCount, 0, len(words))
		for _, row := range words {
			out.EmotionWords = append(out.EmotionWords, WordCount{Word: row.Word, Count: row.Count})
		}
		return nil
	})
	return out, err
}

// Create 新建心情日记；Note 与扩展行在同一事务内提交。
func (s *Service) Create(ctx context.Context, userID string, body httpapi.CreateMoodJournalEntryRequest) (Entry, error) {
	emotionWords, err := normalizeWords(body.EmotionWords, 3, "emotion_words")
	if err != nil {
		return Entry{}, err
	}
	contextWords, err := normalizeWords(body.ContextWords, 5, "context_words")
	if err != nil {
		return Entry{}, err
	}
	if err := validateMood(body.MoodLevel, body.EnergyLevel); err != nil {
		return Entry{}, err
	}
	excludeFromAI := body.ExcludeFromAi != nil && *body.ExcludeFromAi
	includeInMemories := body.IncludeInMemories == nil || *body.IncludeInMemories

	var out Entry
	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		note, err := s.objects.CreateMoodNoteInTx(ctx, q, userID, objects.CreateMoodNoteCommand{
			Title: body.Title, Content: body.Content,
		})
		if err != nil {
			return err
		}
		seed := visualSeed(note.ID)
		if _, err := q.CreateMoodJournalExtension(ctx, dbgen.CreateMoodJournalExtensionParams{
			NoteID: note.ID, UserID: userID, OccurredAt: body.OccurredAt,
			MoodLevel: moodString(body.MoodLevel), EnergyLevel: energyString(body.EnergyLevel),
			EmotionWords: emotionWords, ContextWords: contextWords,
			ExcludeFromAi: excludeFromAI, IncludeInMemories: includeInMemories, VisualSeed: seed,
		}); err != nil {
			return apperr.Internal(err)
		}
		if _, err := s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action: "created", ResourceType: "note", ResourceID: note.ID,
				Title: note.Title, Summary: "写下了心情日记",
			}}); err != nil {
			return err
		}
		row, err := q.GetMoodJournalEntry(ctx, note.ID)
		if err != nil {
			return apperr.Internal(err)
		}
		out = entryFromGet(row)
		return nil
	})
	return out, err
}

// Update 修改心情日记，并执行乐观并发检查。
func (s *Service) Update(ctx context.Context, userID, entryID string,
	body httpapi.UpdateMoodJournalEntryRequest, expectedVersion *int32) (Entry, error) {
	if err := validateMood(body.MoodLevel, body.EnergyLevel); err != nil {
		return Entry{}, err
	}
	var emotionWords, contextWords []string
	var err error
	if body.EmotionWords != nil {
		emotionWords, err = normalizeWords(body.EmotionWords, 3, "emotion_words")
		if err != nil {
			return Entry{}, err
		}
	}
	if body.ContextWords != nil {
		contextWords, err = normalizeWords(body.ContextWords, 5, "context_words")
		if err != nil {
			return Entry{}, err
		}
	}

	clearTitle, clearMood, clearEnergy := clearFlags(body.Clear)
	var out Entry
	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetMoodJournalEntry(ctx, entryID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("心情日记")
			}
			return apperr.Internal(err)
		}
		if expectedVersion != nil && current.Version != *expectedVersion {
			return apperr.New(apperr.CodeVersionConflict)
		}

		var document []byte
		var plaintext *string
		if body.Content != nil {
			doc, text, err := notecontent.EncodeBlocksV1(*body.Content)
			if err != nil {
				return err
			}
			document = doc
			plaintext = &text
		}
		if _, err := q.UpdateMoodJournalNote(ctx, dbgen.UpdateMoodJournalNoteParams{
			ClearTitle: clearTitle, Title: trimmedOrNil(body.Title), Content: plaintext,
			ContentDocument: document, NoteID: entryID,
		}); err != nil {
			return apperr.Internal(err)
		}
		if _, err := q.UpdateMoodJournalExtension(ctx, dbgen.UpdateMoodJournalExtensionParams{
			OccurredAt: body.OccurredAt, ClearMoodLevel: clearMood, MoodLevel: moodString(body.MoodLevel),
			ClearEnergyLevel: clearEnergy, EnergyLevel: energyString(body.EnergyLevel),
			EmotionWords: emotionWords, ContextWords: contextWords,
			ExcludeFromAi: body.ExcludeFromAi, IncludeInMemories: body.IncludeInMemories,
			NoteID: entryID,
		}); err != nil {
			return apperr.Internal(err)
		}
		if _, err := s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action: "updated", ResourceType: "note", ResourceID: entryID,
				Title: current.Title, Summary: "修改了心情日记",
			}}); err != nil {
			return err
		}
		updated, err := q.GetMoodJournalEntry(ctx, entryID)
		if err != nil {
			return apperr.Internal(err)
		}
		out = entryFromGet(updated)
		return nil
	})
	return out, err
}

// Delete 删除心情日记并立即让全部投影视图不可见。
func (s *Service) Delete(ctx context.Context, userID, entryID string) (string, error) {
	var batchID string
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetMoodJournalEntry(ctx, entryID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("心情日记")
			}
			return apperr.Internal(err)
		}
		if _, err := q.SoftDeleteMoodJournalNote(ctx, entryID); err != nil {
			return apperr.Internal(err)
		}
		batchID, err = s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action: "deleted", ResourceType: "note", ResourceID: entryID,
				Title: current.Title, Summary: "删除了心情日记",
			}})
		return err
	})
	return batchID, err
}

// Timezone 返回当前用户时区。
func (s *Service) Timezone(ctx context.Context, userID string) (string, error) {
	var timezone string
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		value, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		timezone = value
		return nil
	})
	return timezone, err
}

func entryFromList(row dbgen.ListMoodJournalEntriesRow) Entry {
	return Entry{ID: row.ID, Title: row.Title, Content: row.Content,
		ContentDocument: row.ContentDocument, OccurredAt: row.OccurredAt,
		MoodLevel: row.MoodLevel, EnergyLevel: row.EnergyLevel,
		EmotionWords: row.EmotionWords, ContextWords: row.ContextWords,
		ExcludeFromAI: row.ExcludeFromAi, IncludeInMemories: row.IncludeInMemories,
		VisualSeed: row.VisualSeed, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		Version: row.Version}
}

func entryFromGet(row dbgen.GetMoodJournalEntryRow) Entry {
	return Entry{ID: row.ID, Title: row.Title, Content: row.Content,
		ContentDocument: row.ContentDocument, OccurredAt: row.OccurredAt,
		MoodLevel: row.MoodLevel, EnergyLevel: row.EnergyLevel,
		EmotionWords: row.EmotionWords, ContextWords: row.ContextWords,
		ExcludeFromAI: row.ExcludeFromAi, IncludeInMemories: row.IncludeInMemories,
		VisualSeed: row.VisualSeed, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		Version: row.Version}
}

func visualSeed(id string) int32 {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte("mood-garden:v1:" + id))
	return int32(hash.Sum32() & 0x7fffffff)
}

func normalizeWords(words *[]string, limit int, field string) ([]string, error) {
	if words == nil {
		return []string{}, nil
	}
	seen := make(map[string]struct{}, len(*words))
	out := make([]string, 0, len(*words))
	for _, item := range *words {
		word := strings.TrimSpace(item)
		if word == "" {
			continue
		}
		if len([]rune(word)) > 20 {
			return nil, apperr.Validation(apperr.Field(field, "每个词最多 20 个字。"))
		}
		if _, exists := seen[word]; exists {
			continue
		}
		seen[word] = struct{}{}
		out = append(out, word)
	}
	if len(out) > limit {
		return nil, apperr.Validation(apperr.Field(field, "选择数量超过上限。"))
	}
	return out, nil
}

func validateMood(mood *httpapi.MoodLevel, energy *httpapi.EnergyLevel) error {
	if mood != nil && !mood.Valid() {
		return apperr.Validation(apperr.Field("mood_level", "心情取值不受支持。"))
	}
	if energy != nil && !energy.Valid() {
		return apperr.Validation(apperr.Field("energy_level", "精力取值不受支持。"))
	}
	return nil
}

func moodString(value *httpapi.MoodLevel) *string {
	if value == nil {
		return nil
	}
	out := string(*value)
	return &out
}

func energyString(value *httpapi.EnergyLevel) *string {
	if value == nil {
		return nil
	}
	out := string(*value)
	return &out
}

func trimmedOrNil(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	return &trimmed
}

func clearFlags(values *[]httpapi.UpdateMoodJournalEntryRequestClear) (bool, bool, bool) {
	if values == nil {
		return false, false, false
	}
	var title, mood, energy bool
	for _, value := range *values {
		switch value {
		case httpapi.UpdateMoodJournalEntryClearTitle:
			title = true
		case httpapi.UpdateMoodJournalEntryClearMoodLevel:
			mood = true
		case httpapi.UpdateMoodJournalEntryClearEnergyLevel:
			energy = true
		}
	}
	return title, mood, energy
}
