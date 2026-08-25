// Package trackers 拥有 Tracker 与 Record。
//
// Tracker 是可复用的字段定义，Record 是某次实际记录。
// Record 的 values 必须满足所属 Tracker 的字段定义，这条校验只在服务端执行；
// 单位换算同样由服务端完成，客户端不得自行折算后写入。
package trackers

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

var emptyJSONArray = []byte("[]")

// UserProfile 是 users 模块公开的最小能力。
type UserProfile interface {
	Timezone(ctx context.Context, q *dbgen.Queries, userID string) (string, error)
}

// ActivityRecorder 是 activity 模块公开的写入能力。
type ActivityRecorder interface {
	Record(ctx context.Context, q *dbgen.Queries, userID string,
		source activity.Source, sourceID *string, entries []activity.EntryInput) (string, error)
}

// Service 是 Tracker 与 Record 的应用服务。
type Service struct {
	db       *database.DB
	users    UserProfile
	activity ActivityRecorder
}

// New 构造 Service。
func New(db *database.DB, users UserProfile, act ActivityRecorder) *Service {
	return &Service{db: db, users: users, activity: act}
}

// TrackerStats 是单个 Tracker 的记录统计。
type TrackerStats struct {
	RecordCount   int32
	LastRecordAt  *time.Time
	RecordedToday bool
}

// TrackerWithStats 是 Tracker 与其统计的组合。
type TrackerWithStats struct {
	Row      dbgen.Tracker
	Stats    TrackerStats
	DueToday bool
}

// ListTrackers 读取全部 Tracker 及其统计。
func (s *Service) ListTrackers(ctx context.Context, userID string, status *string) ([]TrackerWithStats, error) {
	var out []TrackerWithStats
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		tz, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		now := time.Now()
		loc := timeutil.LoadLocation(tz)
		rows, err := q.ListTrackers(ctx, dbgen.ListTrackersParams{Status: status})
		if err != nil {
			return apperr.Internal(err)
		}
		stats, err := loadStats(ctx, q, timeutil.DayOf(now, loc))
		if err != nil {
			return err
		}
		for _, row := range rows {
			rowStats := stats[row.ID]
			out = append(out, TrackerWithStats{
				Row: row, Stats: rowStats,
				DueToday: trackerDueToday(row, rowStats, now, loc),
			})
		}
		return nil
	})
	return out, err
}

// loadStats 一次读出全部 Tracker 的统计，避免逐个查询。
func loadStats(ctx context.Context, q *dbgen.Queries, day timeutil.Day) (map[string]TrackerStats, error) {
	rows, err := q.ListTrackerStats(ctx, dbgen.ListTrackerStatsParams{
		DayStart: day.Start, NextDayStart: day.Start.AddDate(0, 0, 1),
	})
	if err != nil {
		return nil, apperr.Internal(err)
	}
	out := make(map[string]TrackerStats, len(rows))
	for _, r := range rows {
		last := r.LastRecordAt
		out[r.TrackerID] = TrackerStats{
			RecordCount: r.RecordCount, LastRecordAt: &last, RecordedToday: r.RecordedToday,
		}
	}
	return out, nil
}

// GetTracker 读取单个 Tracker 及其统计。
func (s *Service) GetTracker(ctx context.Context, userID, trackerID string) (TrackerWithStats, error) {
	var out TrackerWithStats
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		tz, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		now := time.Now()
		loc := timeutil.LoadLocation(tz)
		row, err := q.GetTracker(ctx, trackerID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("记录项")
			}
			return apperr.Internal(err)
		}
		stats, err := loadStats(ctx, q, timeutil.DayOf(now, loc))
		if err != nil {
			return err
		}
		rowStats := stats[row.ID]
		out = TrackerWithStats{
			Row: row, Stats: rowStats,
			DueToday: trackerDueToday(row, rowStats, now, loc),
		}
		return nil
	})
	return out, err
}

// CreateTracker 新建 Tracker。
func (s *Service) CreateTracker(ctx context.Context, userID string, body httpapi.CreateTrackerRequest) (dbgen.Tracker, error) {
	name := strings.TrimSpace(body.Name)
	if name == "" {
		return dbgen.Tracker{}, apperr.Validation(apperr.Field("name", "名称不能为空。"))
	}
	if err := validateFields(body.Fields); err != nil {
		return dbgen.Tracker{}, err
	}
	if err := validateSchedule(body.Schedule); err != nil {
		return dbgen.Tracker{}, err
	}
	fieldsJSON, err := json.Marshal(body.Fields)
	if err != nil {
		return dbgen.Tracker{}, apperr.Internal(err)
	}
	scheduleJSON, err := encodeSchedule(body.Schedule)
	if err != nil {
		return dbgen.Tracker{}, err
	}

	var out dbgen.Tracker
	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		created, err := q.CreateTracker(ctx, dbgen.CreateTrackerParams{
			ID:             idgen.New(idgen.PrefixTracker),
			UserID:         userID,
			Name:           name,
			Description:    body.Description,
			Fields:         fieldsJSON,
			Schedule:       scheduleJSON,
			Status:         "active",
			Color:          colorString(body.Color),
			Icon:           body.Icon,
			CreatedBy:      "user",
			ProvenanceRefs: emptyJSONArray,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		if _, err := s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action:       "created",
				ResourceType: "tracker",
				ResourceID:   created.ID,
				Title:        created.Name,
				Summary:      "创建了记录项",
			}}); err != nil {
			return err
		}
		out = created
		return nil
	})
	return out, err
}

// UpdateTracker 修改 Tracker。
func (s *Service) UpdateTracker(ctx context.Context, userID, trackerID string,
	body httpapi.UpdateTrackerRequest, expectedVersion *int32) (TrackerWithStats, error) {

	if body.Fields != nil {
		if err := validateFields(*body.Fields); err != nil {
			return TrackerWithStats{}, err
		}
	}
	if err := validateSchedule(body.Schedule); err != nil {
		return TrackerWithStats{}, err
	}

	var out TrackerWithStats
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetTracker(ctx, trackerID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("记录项")
			}
			return apperr.Internal(err)
		}
		if expectedVersion != nil && *expectedVersion != current.Version {
			return apperr.New(apperr.CodeVersionConflict)
		}
		clear := trackerClearFlagsOf(body.Clear)

		// 内置记录项的字段定义不接受修改。
		//
		// 写入这三个记录项的是 Capture 与 AI 编排里按 key 写死的代码
		// （记账的 amount / direction / category 等）。字段被改掉之后
		// EnsureBuiltin 不会把它修回来——它只在不存在时创建——
		// 于是之后每一次自动记账都以 RECORD_VALUES_INVALID 失败，
		// 而用户完全看不出这和他改过字段有什么关系。
		//
		// 改名、换颜色、归档都放行：那些不影响按 key 读写。
		if current.BuiltinKey != nil && body.Fields != nil {
			return apperr.Validation(apperr.Field("fields",
				"内置打卡项的字段是固定的，改了它之前记下的数据就读不出来了。"))
		}
		if current.BuiltinKey != nil && (body.Schedule != nil || clear.Schedule) {
			return apperr.Validation(apperr.Field("schedule",
				"内置记录项由对应功能管理，不设置打卡频率。"))
		}

		var fieldsJSON []byte
		if body.Fields != nil {
			fieldsJSON, err = json.Marshal(*body.Fields)
			if err != nil {
				return apperr.Internal(err)
			}
		}
		scheduleJSON, err := encodeSchedule(body.Schedule)
		if err != nil {
			return err
		}

		var status *string
		if body.Status != nil {
			v := string(*body.Status)
			status = &v
		}

		if _, err := q.UpdateTracker(ctx, dbgen.UpdateTrackerParams{
			ID:               trackerID,
			Name:             trimmedOrNil(body.Name),
			Description:      body.Description,
			ClearDescription: clear.Description,
			Fields:           fieldsJSON,
			Schedule:         scheduleJSON,
			ClearSchedule:    clear.Schedule,
			Status:           status,
			Color:            colorString(body.Color),
			ClearColor:       clear.Color,
			Icon:             body.Icon,
			ClearIcon:        clear.Icon,
		}); err != nil {
			return apperr.Internal(err)
		}

		refreshed, err := q.GetTracker(ctx, trackerID)
		if err != nil {
			return apperr.Internal(err)
		}
		tz, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		now := time.Now()
		loc := timeutil.LoadLocation(tz)
		stats, err := loadStats(ctx, q, timeutil.DayOf(now, loc))
		if err != nil {
			return err
		}
		rowStats := stats[refreshed.ID]
		out = TrackerWithStats{
			Row: refreshed, Stats: rowStats,
			DueToday: trackerDueToday(refreshed, rowStats, now, loc),
		}
		return nil
	})
	return out, err
}

// DeleteTracker 软删除 Tracker，并连带软删除其 Record。
func (s *Service) DeleteTracker(ctx context.Context, userID, trackerID string) (string, error) {
	var batchID string
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetTracker(ctx, trackerID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("记录项")
			}
			return apperr.Internal(err)
		}
		// 内置记录项不删。删了它连同全部历史记录一起消失，
		// 而下一次自动记账又会把它重新建出来——用户看到的是
		// 一个空壳回来了，数据却没回来。不想记就归档。
		if current.BuiltinKey != nil {
			return apperr.Validation(apperr.Field("tracker_id",
				"内置打卡项不能删除。不想记了可以归档。"))
		}
		if err := q.SoftDeleteRecordsByTracker(ctx, trackerID); err != nil {
			return apperr.Internal(err)
		}
		if _, err := q.SoftDeleteTracker(ctx, trackerID); err != nil {
			return apperr.Internal(err)
		}
		batchID, err = s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action:       "deleted",
				ResourceType: "tracker",
				ResourceID:   trackerID,
				Title:        current.Name,
				Summary:      "删除了记录项及其全部记录",
			}})
		return err
	})
	return batchID, err
}

// RecordFilter 是 Record 列表查询条件。
type RecordFilter struct {
	TrackerID  *string
	From       *time.Time
	To         *time.Time
	CursorTime *time.Time
	CursorID   *string
	Limit      int32
}

// FieldAggregate 是某个记录项字段在一段时间内的统计结果。
type FieldAggregate struct {
	TrackerName string
	RecordCount int32
	// ValueCount 是真正取到数值的条数。为 0 时其余统计值没有意义。
	ValueCount int32
	Total      float64
	Average    float64
	Minimum    float64
	Maximum    float64
}

// AggregateField 由 SQL 统计某个字段，不把逐条明细取回内存。
//
// 这是 records.aggregate 能力的实现：问「这个月花了多少」时，
// 把上千条记录发给模型让它自己加既慢又容易算错。
func (s *Service) AggregateField(ctx context.Context, userID, trackerID, fieldKey string,
	from, to *time.Time) (FieldAggregate, error) {

	var out FieldAggregate
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		// RLS 已经拦住跨用户读取；这里再确认一次是为了区分
		// 「记录项不存在」和「有记录项但这段时间没数据」。
		tracker, err := q.GetTracker(ctx, trackerID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("记录项")
			}
			return apperr.Internal(err)
		}
		row, err := q.AggregateRecordField(ctx, dbgen.AggregateRecordFieldParams{
			FieldKey:  fieldKey,
			TrackerID: trackerID,
			FromAt:    from,
			ToAt:      to,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = FieldAggregate{
			TrackerName: tracker.Name,
			RecordCount: row.RecordCount,
			ValueCount:  row.ValueCount,
			Total:       row.Total,
			Average:     row.Average,
			Minimum:     row.Minimum,
			Maximum:     row.Maximum,
		}
		return nil
	})
	return out, err
}

// ListRecords 查询 Record。
func (s *Service) ListRecords(ctx context.Context, userID string, f RecordFilter) ([]dbgen.ListRecordsRow, error) {
	var out []dbgen.ListRecordsRow
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListRecords(ctx, dbgen.ListRecordsParams{
			TrackerID:       f.TrackerID,
			FromAt:          f.From,
			ToAt:            f.To,
			CursorTimestamp: f.CursorTime,
			CursorID:        f.CursorID,
			RowLimit:        f.Limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = rows
		return nil
	})
	return out, err
}

// GetRecord 读取单个 Record。
func (s *Service) GetRecord(ctx context.Context, userID, recordID string) (dbgen.GetRecordRow, error) {
	var out dbgen.GetRecordRow
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetRecord(ctx, recordID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("记录")
			}
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// CreateRecord 新建 Record。
func (s *Service) CreateRecord(ctx context.Context, userID string, body httpapi.CreateRecordRequest) (dbgen.GetRecordRow, error) {
	var out dbgen.GetRecordRow
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		tracker, err := q.GetTracker(ctx, body.TrackerId)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("记录项")
			}
			return apperr.Internal(err)
		}

		fields, err := decodeFields(tracker.Fields)
		if err != nil {
			return err
		}
		if err := validateValues(fields, body.Values); err != nil {
			return err
		}

		tz, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		valuesJSON, err := json.Marshal(body.Values)
		if err != nil {
			return apperr.Internal(err)
		}

		created, err := q.CreateRecord(ctx, dbgen.CreateRecordParams{
			ID:             idgen.New(idgen.PrefixRecord),
			UserID:         userID,
			Title:          BuildRecordTitle(tracker.Name, fields, body.Values, body.Timestamp, tz),
			TrackerID:      body.TrackerId,
			Timestamp:      body.Timestamp,
			Values:         valuesJSON,
			Note:           body.Note,
			ProjectID:      body.ProjectId,
			CreatedBy:      "user",
			ProvenanceRefs: emptyJSONArray,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		if _, err := s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action:       "created",
				ResourceType: "record",
				ResourceID:   created.ID,
				Title:        created.Title,
				Summary:      "新增了一条记录",
			}}); err != nil {
			return err
		}

		out = dbgen.GetRecordRow{
			ID: created.ID, UserID: created.UserID, Title: created.Title,
			TrackerID: created.TrackerID, Timestamp: created.Timestamp,
			Values: created.Values, Note: created.Note, ProjectID: created.ProjectID,
			CreatedBy: created.CreatedBy, ProvenanceRefs: created.ProvenanceRefs,
			CreatedAt: created.CreatedAt, UpdatedAt: created.UpdatedAt,
			DeletedAt: created.DeletedAt, Version: created.Version,
			TrackerName: tracker.Name,
		}
		return nil
	})
	return out, err
}

// UpdateRecord 修改 Record。
func (s *Service) UpdateRecord(ctx context.Context, userID, recordID string,
	body httpapi.UpdateRecordRequest, expectedVersion *int32) (dbgen.GetRecordRow, error) {

	var out dbgen.GetRecordRow
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetRecord(ctx, recordID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("记录")
			}
			return apperr.Internal(err)
		}
		if expectedVersion != nil && *expectedVersion != current.Version {
			return apperr.New(apperr.CodeVersionConflict)
		}

		tracker, err := q.GetTracker(ctx, current.TrackerID)
		if err != nil {
			return apperr.Internal(err)
		}
		fields, err := decodeFields(tracker.Fields)
		if err != nil {
			return err
		}

		var valuesJSON []byte
		var title *string
		if body.Values != nil {
			if err := validateValues(fields, *body.Values); err != nil {
				return err
			}
			valuesJSON, err = json.Marshal(*body.Values)
			if err != nil {
				return apperr.Internal(err)
			}
			tz, err := s.users.Timezone(ctx, q, userID)
			if err != nil {
				return err
			}
			ts := current.Timestamp
			if body.Timestamp != nil {
				ts = *body.Timestamp
			}
			t := BuildRecordTitle(tracker.Name, fields, *body.Values, ts, tz)
			title = &t
		}

		clear := recordClearFlagsOf(body.Clear)
		if _, err := q.UpdateRecord(ctx, dbgen.UpdateRecordParams{
			ID:             recordID,
			Title:          title,
			Timestamp:      body.Timestamp,
			Values:         valuesJSON,
			Note:           body.Note,
			ClearNote:      clear.Note,
			ProjectID:      body.ProjectId,
			ClearProjectID: clear.ProjectID,
		}); err != nil {
			return apperr.Internal(err)
		}

		refreshed, err := q.GetRecord(ctx, recordID)
		if err != nil {
			return apperr.Internal(err)
		}
		out = refreshed
		return nil
	})
	return out, err
}

// DeleteRecord 软删除 Record。
func (s *Service) DeleteRecord(ctx context.Context, userID, recordID string) (string, error) {
	var batchID string
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetRecord(ctx, recordID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("记录")
			}
			return apperr.Internal(err)
		}
		if _, err := q.SoftDeleteRecord(ctx, recordID); err != nil {
			return apperr.Internal(err)
		}
		batchID, err = s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action:       "deleted",
				ResourceType: "record",
				ResourceID:   recordID,
				Title:        current.Title,
				Summary:      "删除了一条记录",
			}})
		return err
	})
	return batchID, err
}

// validateFields 校验 Tracker 字段定义。
func validateFields(fields []httpapi.TrackerField) error {
	if len(fields) == 0 {
		return apperr.Newf(apperr.CodeTrackerSchemaInvalid, "至少需要一个字段。")
	}
	seen := make(map[string]struct{}, len(fields))
	for _, f := range fields {
		if strings.TrimSpace(f.Key) == "" {
			return apperr.Newf(apperr.CodeTrackerSchemaInvalid, "字段标识不能为空。")
		}
		if _, dup := seen[f.Key]; dup {
			return apperr.Newf(apperr.CodeTrackerSchemaInvalid, "字段标识 %s 重复。", f.Key)
		}
		seen[f.Key] = struct{}{}
		if strings.TrimSpace(f.Label) == "" {
			return apperr.Newf(apperr.CodeTrackerSchemaInvalid, "字段 %s 缺少显示名称。", f.Key)
		}
		switch f.Type {
		case httpapi.TrackerFieldTypeNumber, httpapi.TrackerFieldTypeCurrency, httpapi.TrackerFieldTypePercentage, httpapi.TrackerFieldTypeDuration, httpapi.TrackerFieldTypeText:
		default:
			return apperr.Newf(apperr.CodeTrackerSchemaInvalid, "字段 %s 的类型不受支持。", f.Key)
		}
	}
	return nil
}

// validateValues 校验 Record 的值是否满足字段定义。
func validateValues(fields []httpapi.TrackerField, values []httpapi.RecordValue) error {
	byKey := make(map[string]httpapi.TrackerField, len(fields))
	for _, f := range fields {
		byKey[f.Key] = f
	}
	provided := make(map[string]struct{}, len(values))

	for _, v := range values {
		field, ok := byKey[v.Key]
		if !ok {
			return apperr.Newf(apperr.CodeRecordValuesInvalid, "记录项没有名为 %s 的字段。", v.Key)
		}
		provided[v.Key] = struct{}{}
		if field.Type == httpapi.TrackerFieldTypeText {
			if v.TextValue == nil || strings.TrimSpace(*v.TextValue) == "" {
				if field.Required {
					return apperr.Newf(apperr.CodeRecordValuesInvalid, "字段“%s”需要填写内容。", field.Label)
				}
			}
			continue
		}
		if v.NumberValue == nil {
			if field.Required {
				return apperr.Newf(apperr.CodeRecordValuesInvalid, "字段“%s”需要填写数值。", field.Label)
			}
			continue
		}
		if field.Type == httpapi.TrackerFieldTypePercentage && (*v.NumberValue < 0 || *v.NumberValue > 100) {
			return apperr.Newf(apperr.CodeRecordValuesInvalid, "字段“%s”应在 0 到 100 之间。", field.Label)
		}
		if field.Type == httpapi.TrackerFieldTypeDuration && *v.NumberValue < 0 {
			return apperr.Newf(apperr.CodeRecordValuesInvalid, "字段“%s”不能为负。", field.Label)
		}
	}

	for _, f := range fields {
		if !f.Required {
			continue
		}
		if _, ok := provided[f.Key]; !ok {
			return apperr.Newf(apperr.CodeRecordValuesInvalid, "字段“%s”是必填项。", f.Label)
		}
	}
	return nil
}

// BuildRecordTitle 生成 Record 标题，例如“2026-08-12 · 体重 72.3 kg”。
// 标题由服务端生成，客户端不参与，保证列表展示一致。
func BuildRecordTitle(trackerName string, fields []httpapi.TrackerField,
	values []httpapi.RecordValue, ts time.Time, tz string) string {

	loc := timeutil.LoadLocation(tz)
	datePart := timeutil.FormatDate(ts.In(loc))

	// 取第一个有值的字段作为标题主体。
	for _, f := range fields {
		for _, v := range values {
			if v.Key != f.Key {
				continue
			}
			if f.Type == httpapi.TrackerFieldTypeText && v.TextValue != nil && strings.TrimSpace(*v.TextValue) != "" {
				return fmt.Sprintf("%s · %s %s", datePart, f.Label, strings.TrimSpace(*v.TextValue))
			}
			if v.NumberValue != nil {
				num := strconv.FormatFloat(*v.NumberValue, 'f', -1, 64)
				if f.Unit != nil && *f.Unit != "" {
					return fmt.Sprintf("%s · %s %s %s", datePart, f.Label, num, *f.Unit)
				}
				return fmt.Sprintf("%s · %s %s", datePart, f.Label, num)
			}
		}
	}
	return fmt.Sprintf("%s · %s", datePart, trackerName)
}

// DecodeFields 解析 Tracker 的字段定义列。
func DecodeFields(raw []byte) ([]httpapi.TrackerField, error) {
	return decodeFields(raw)
}

func decodeFields(raw []byte) ([]httpapi.TrackerField, error) {
	var fields []httpapi.TrackerField
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, apperr.Internal(err)
	}
	return fields, nil
}

func validateSchedule(schedule *httpapi.TrackerSchedule) error {
	if schedule == nil {
		return nil
	}
	switch schedule.Frequency {
	case httpapi.Daily:
		if schedule.Weekdays != nil && len(*schedule.Weekdays) > 0 {
			return apperr.Validation(apperr.Field("schedule.weekdays",
				"每天打卡不需要选择星期。"))
		}
	case httpapi.Weekly:
		if schedule.Weekdays == nil || len(*schedule.Weekdays) == 0 {
			return apperr.Validation(apperr.Field("schedule.weekdays",
				"每周打卡至少选择一天。"))
		}
		seen := make(map[int]struct{}, len(*schedule.Weekdays))
		for _, weekday := range *schedule.Weekdays {
			if weekday < 1 || weekday > 7 {
				return apperr.Validation(apperr.Field("schedule.weekdays",
					"星期必须在周一到周日之间。"))
			}
			if _, exists := seen[weekday]; exists {
				return apperr.Validation(apperr.Field("schedule.weekdays",
					"不能重复选择同一天。"))
			}
			seen[weekday] = struct{}{}
		}
	default:
		return apperr.Validation(apperr.Field("schedule.frequency", "不支持这个打卡频率。"))
	}
	return nil
}

func encodeSchedule(schedule *httpapi.TrackerSchedule) ([]byte, error) {
	if schedule == nil {
		return nil, nil
	}
	raw, err := json.Marshal(schedule)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return raw, nil
}

func decodeSchedule(raw []byte) *httpapi.TrackerSchedule {
	if len(raw) == 0 {
		return nil
	}
	var schedule httpapi.TrackerSchedule
	if err := json.Unmarshal(raw, &schedule); err != nil {
		return nil
	}
	return &schedule
}

// trackerDueToday 只计算自定义且处于启用状态的打卡项。
// 专注、运动与记账虽然复用 Tracker / Record 存储，但由各自场景负责展示与录入。
func trackerDueToday(row dbgen.Tracker, stats TrackerStats, now time.Time, loc *time.Location) bool {
	return scheduleDueToday(decodeSchedule(row.Schedule), row.BuiltinKey != nil,
		row.Status, stats.RecordedToday, now, loc)
}

func scheduleDueToday(schedule *httpapi.TrackerSchedule, builtin bool, status string,
	recordedToday bool, now time.Time, loc *time.Location) bool {

	if schedule == nil || builtin || status != "active" || recordedToday {
		return false
	}
	switch schedule.Frequency {
	case httpapi.Daily:
		return true
	case httpapi.Weekly:
		if schedule.Weekdays == nil {
			return false
		}
		weekday := int(now.In(loc).Weekday())
		if weekday == 0 {
			weekday = 7
		}
		for _, candidate := range *schedule.Weekdays {
			if candidate == weekday {
				return true
			}
		}
	}
	return false
}

type trackerClearFlags struct {
	Description bool
	Color       bool
	Icon        bool
	Schedule    bool
}

func trackerClearFlagsOf(clear *[]httpapi.UpdateTrackerRequestClear) trackerClearFlags {
	var f trackerClearFlags
	if clear == nil {
		return f
	}
	for _, item := range *clear {
		switch item {
		case httpapi.UpdateTrackerRequestClearDescription:
			f.Description = true
		case httpapi.UpdateTrackerRequestClearColor:
			f.Color = true
		case httpapi.UpdateTrackerRequestClearIcon:
			f.Icon = true
		case httpapi.UpdateTrackerRequestClearSchedule:
			f.Schedule = true
		}
	}
	return f
}

type recordClearFlags struct {
	Note      bool
	ProjectID bool
}

func recordClearFlagsOf(clear *[]httpapi.UpdateRecordRequestClear) recordClearFlags {
	var f recordClearFlags
	if clear == nil {
		return f
	}
	for _, item := range *clear {
		switch item {
		case httpapi.UpdateRecordRequestClearNote:
			f.Note = true
		case httpapi.UpdateRecordRequestClearProjectId:
			f.ProjectID = true
		}
	}
	return f
}

func trimmedOrNil(v *string) *string {
	if v == nil {
		return nil
	}
	t := strings.TrimSpace(*v)
	if t == "" {
		return nil
	}
	return &t
}

func colorString[T ~string](v *T) *string {
	if v == nil {
		return nil
	}
	s := string(*v)
	return &s
}
