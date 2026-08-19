package trackers

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// 事务内的公开 Command，供 Capture 确认在同一事务中创建 Tracker 与 Record。

// CreateTrackerInTx 在调用方事务内创建 Tracker。
func (s *Service) CreateTrackerInTx(ctx context.Context, q *dbgen.Queries, userID string,
	name string, fields []httpapi.TrackerField, provenance []byte) (dbgen.Tracker, error) {

	name = strings.TrimSpace(name)
	if name == "" {
		return dbgen.Tracker{}, apperr.Validation(apperr.Field("name", "记录项名称不能为空。"))
	}
	if len(fields) == 0 {
		// AI 没有给出字段定义时提供一个可用的默认数值字段，用户可在确认页修改。
		fields = []httpapi.TrackerField{{
			Key: "value", Label: "数值", Type: httpapi.TrackerFieldTypeNumber, Required: true,
		}}
	}
	if err := validateFields(fields); err != nil {
		return dbgen.Tracker{}, err
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
		Status:         "active",
		CreatedBy:      "ai",
		ProvenanceRefs: provenance,
	})
	if err != nil {
		return dbgen.Tracker{}, apperr.Internal(err)
	}
	return row, nil
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
