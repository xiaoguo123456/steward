package trackers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// 事务内的公开 Command，供 Capture 确认在同一事务中创建 Tracker 与 Record。

// CreateTrackerInTx 在调用方事务内创建 Tracker。
func (s *Service) CreateTrackerInTx(ctx context.Context, q *dbgen.Queries, userID string,
	name string, fields []httpapi.TrackerField, schedule *httpapi.TrackerSchedule, provenance []byte) (dbgen.Tracker, error) {

	name = strings.TrimSpace(name)
	if name == "" {
		return dbgen.Tracker{}, apperr.Validation(apperr.Field("name", "记录项名称不能为空。"))
	}
	if err := validateFields(fields); err != nil {
		return dbgen.Tracker{}, err
	}
	if err := validateSchedule(schedule); err != nil {
		return dbgen.Tracker{}, err
	}
	scheduleJSON, err := encodeSchedule(schedule)
	if err != nil {
		return dbgen.Tracker{}, apperr.Internal(err)
	}
	fieldsJSON, err := json.Marshal(fields)
	if err != nil {
		return dbgen.Tracker{}, apperr.Internal(err)
	}
	if len(provenance) == 0 {
		provenance = emptyJSONArray
	}

	row, err := q.CreateTracker(ctx, dbgen.CreateTrackerParams{
		ID:             idgen.New(idgen.PrefixTracker),
		UserID:         userID,
		Name:           name,
		Fields:         fieldsJSON,
		Schedule:       scheduleJSON,
		Status:         "active",
		CreatedBy:      "ai",
		ProvenanceRefs: provenance,
	})
	if err != nil {
		return dbgen.Tracker{}, apperr.Internal(err)
	}
	return row, nil
}

// UpdateTrackerCommandInTx 在 Capture 确认事务内更新 Tracker。
// expectedVersion 必须由候选快照携带；调用方统一记录整次确认的 Activity。
func (s *Service) UpdateTrackerCommandInTx(ctx context.Context, q *dbgen.Queries,
	userID, trackerID string, body httpapi.UpdateTrackerRequest, expectedVersion int32) (dbgen.Tracker, error) {
	if body.Fields != nil {
		if err := validateFields(*body.Fields); err != nil {
			return dbgen.Tracker{}, err
		}
	}
	if err := validateSchedule(body.Schedule); err != nil {
		return dbgen.Tracker{}, err
	}
	current, err := q.GetTracker(ctx, trackerID)
	if err != nil {
		if database.IsNoRows(err) {
			return dbgen.Tracker{}, apperr.NotFound("记录项")
		}
		return dbgen.Tracker{}, apperr.Internal(err)
	}
	if current.Version != expectedVersion {
		return dbgen.Tracker{}, apperr.New(apperr.CodeVersionConflict)
	}
	clear := trackerClearFlagsOf(body.Clear)
	if current.BuiltinKey != nil && body.Fields != nil {
		return dbgen.Tracker{}, apperr.Validation(apperr.Field("fields",
			"内置打卡项的字段是固定的，改了它之前记下的数据就读不出来了。"))
	}
	if current.BuiltinKey != nil && (body.Schedule != nil || clear.Schedule) {
		return dbgen.Tracker{}, apperr.Validation(apperr.Field("schedule",
			"内置记录项由对应功能管理，不设置打卡频率。"))
	}
	var fieldsJSON []byte
	if body.Fields != nil {
		fieldsJSON, err = json.Marshal(*body.Fields)
		if err != nil {
			return dbgen.Tracker{}, apperr.Internal(err)
		}
	}
	scheduleJSON, err := encodeSchedule(body.Schedule)
	if err != nil {
		return dbgen.Tracker{}, err
	}
	var status *string
	if body.Status != nil {
		v := string(*body.Status)
		status = &v
	}
	updated, err := q.UpdateTracker(ctx, dbgen.UpdateTrackerParams{
		ID: trackerID, Name: trimmedOrNil(body.Name), Description: body.Description,
		ClearDescription: clear.Description, Fields: fieldsJSON, Schedule: scheduleJSON,
		ClearSchedule: clear.Schedule, Status: status, Color: colorString(body.Color),
		ClearColor: clear.Color, Icon: body.Icon, ClearIcon: clear.Icon,
	})
	if err != nil {
		return dbgen.Tracker{}, apperr.Internal(err)
	}
	if current.BuiltinKey == nil && current.Status != "archived" && updated.Status == "archived" {
		if updated.ArchivedAt == nil {
			return dbgen.Tracker{}, apperr.Internal(fmt.Errorf("归档打卡项缺少 archived_at"))
		}
		if s.jobs == nil {
			return dbgen.Tracker{}, apperr.Internal(fmt.Errorf("归档清理队列尚未初始化"))
		}
		if err := s.jobs.EnqueueTrackerArchiveCleanup(ctx, q, ArchiveCleanupArgs{
			UserID: userID, TrackerID: trackerID, ArchivedBefore: *updated.ArchivedAt,
			RunAt: updated.ArchivedAt.AddDate(0, 0, 30),
		}); err != nil {
			return dbgen.Tracker{}, err
		}
	}
	return updated, nil
}

// CreateRecordInTx 在调用方事务内创建 Record。
func (s *Service) CreateRecordInTx(ctx context.Context, q *dbgen.Queries, userID, trackerID string,
	ts time.Time, values []httpapi.RecordValue, note *string, provenance []byte) (dbgen.Record, error) {

	tracker, err := q.GetTracker(ctx, trackerID)
	if err != nil {
		return dbgen.Record{}, apperr.NotFound("记录项")
	}
	fields, err := decodeFields(tracker.Fields)
	if err != nil {
		return dbgen.Record{}, err
	}
	values, err = normalizeBuiltinValues(tracker.BuiltinKey, values)
	if err != nil {
		return dbgen.Record{}, err
	}
	if err := validateValues(fields, values); err != nil {
		return dbgen.Record{}, err
	}

	tz, err := s.users.Timezone(ctx, q, userID)
	if err != nil {
		return dbgen.Record{}, err
	}
	valuesJSON, err := json.Marshal(values)
	if err != nil {
		return dbgen.Record{}, apperr.Internal(err)
	}
	if len(provenance) == 0 {
		provenance = emptyJSONArray
	}
	if ts.IsZero() {
		ts = time.Now()
	}
	_ = timeutil.LoadLocation(tz)

	row, err := q.CreateRecord(ctx, dbgen.CreateRecordParams{
		ID:             idgen.New(idgen.PrefixRecord),
		UserID:         userID,
		Title:          BuildRecordTitle(tracker.Name, fields, values, ts, tz),
		TrackerID:      trackerID,
		Timestamp:      ts,
		Values:         valuesJSON,
		Note:           note,
		CreatedBy:      "ai",
		ProvenanceRefs: provenance,
	})
	if err != nil {
		return dbgen.Record{}, apperr.Internal(err)
	}
	return row, nil
}

// UpdateRecordCommandInTx 在 Capture 确认事务内更新 Record。
func (s *Service) UpdateRecordCommandInTx(ctx context.Context, q *dbgen.Queries,
	userID, recordID string, body httpapi.UpdateRecordRequest, expectedVersion int32) (dbgen.GetRecordRow, error) {
	current, err := q.GetRecord(ctx, recordID)
	if err != nil {
		if database.IsNoRows(err) {
			return dbgen.GetRecordRow{}, apperr.NotFound("记录")
		}
		return dbgen.GetRecordRow{}, apperr.Internal(err)
	}
	if current.Version != expectedVersion {
		return dbgen.GetRecordRow{}, apperr.New(apperr.CodeVersionConflict)
	}
	tracker, err := q.GetTracker(ctx, current.TrackerID)
	if err != nil {
		return dbgen.GetRecordRow{}, apperr.Internal(err)
	}
	fields, err := decodeFields(tracker.Fields)
	if err != nil {
		return dbgen.GetRecordRow{}, err
	}
	var valuesJSON []byte
	var title *string
	if body.Values != nil {
		normalized, err := normalizeBuiltinValues(tracker.BuiltinKey, *body.Values)
		if err != nil {
			return dbgen.GetRecordRow{}, err
		}
		body.Values = &normalized
		if err := validateValues(fields, *body.Values); err != nil {
			return dbgen.GetRecordRow{}, err
		}
		valuesJSON, err = json.Marshal(*body.Values)
		if err != nil {
			return dbgen.GetRecordRow{}, apperr.Internal(err)
		}
		tz, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return dbgen.GetRecordRow{}, err
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
		ID: recordID, Title: title, Timestamp: body.Timestamp, Values: valuesJSON,
		Note: body.Note, ClearNote: clear.Note, ProjectID: body.ProjectId,
		ClearProjectID: clear.ProjectID,
	}); err != nil {
		return dbgen.GetRecordRow{}, apperr.Internal(err)
	}
	refreshed, err := q.GetRecord(ctx, recordID)
	if err != nil {
		return dbgen.GetRecordRow{}, apperr.Internal(err)
	}
	return refreshed, nil
}

// UndoEntry 还原一条 Tracker/Record 变更，实现 activity.Undoer。
func (s *Service) UndoEntry(ctx context.Context, q *dbgen.Queries, userID string, entry dbgen.ActivityEntry) error {
	switch entry.ResourceType {
	case "tracker":
		switch entry.Action {
		case "created":
			if err := q.SoftDeleteRecordsByTracker(ctx, entry.ResourceID); err != nil {
				return apperr.Internal(err)
			}
			if _, err := q.SoftDeleteTracker(ctx, entry.ResourceID); err != nil {
				return apperr.Internal(err)
			}
		}
	case "record":
		switch entry.Action {
		case "created":
			if _, err := q.SoftDeleteRecord(ctx, entry.ResourceID); err != nil {
				return apperr.Internal(err)
			}
		case "deleted":
			if _, err := q.RestoreRecord(ctx, entry.ResourceID); err != nil {
				return apperr.Internal(err)
			}
		}
	}
	return nil
}

// Handles 报告本模块负责哪些资源类型的撤销。
func (s *Service) Handles(resourceType string) bool {
	return resourceType == "tracker" || resourceType == "record"
}
