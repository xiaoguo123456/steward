// Package activity 拥有变更历史与撤销。
//
// 每一次用户可见的写入都会产生一个 Activity 批次；批次内保存撤销所需的
// 最小前后快照。撤销只在目标自本批次之后没有再次变化时可用，
// 否则会覆盖用户后来的修改。
package activity

import (
	"context"
	"encoding/json"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// UndoWindow 是允许撤销的时间窗口。超过后批次仍可查看但不能撤销。
const UndoWindow = 10 * time.Minute

// Source 是触发批次的来源。
type Source string

// 批次来源取值，与契约 ActivityBatch.source 保持一致。
const (
	SourceUserForm       Source = "user_form"
	SourceCaptureConfirm Source = "capture_confirm"
	SourceProposal       Source = "assistant_proposal"
	SourceSystem         Source = "system"
)

// EntryInput 描述批次内的一条变更。
type EntryInput struct {
	Action       string
	ResourceType string
	ResourceID   string
	Title        string
	Summary      string
	// BeforeState 与 AfterState 只保存本次变更真正影响的字段，
	// 不复制整个实体，也不保存媒体正文。
	BeforeState any
	AfterState  any
}

// Service 是 Activity 的应用服务。
type Service struct {
	db *database.DB
}

// New 构造 Service。
func New(db *database.DB) *Service { return &Service{db: db} }

// Record 在调用方的事务内写入一个批次。
//
// 它必须与业务写入处于同一事务：否则业务成功而历史缺失，撤销入口会指向不存在的批次。
func (s *Service) Record(
	ctx context.Context,
	q *dbgen.Queries,
	userID string,
	source Source,
	sourceID *string,
	entries []EntryInput,
) (string, error) {
	return s.record(ctx, q, userID, source, sourceID, entries, true)
}

// RecordNonUndoable 记录不可撤销的用户可见写入。
//
// 时光发布后不可编辑，删除还会同步清理对象存储，因此不能通过通用 Activity
// 撤销器恢复；但这类写入仍需出现在变更历史中，不能静默绕过审计。
func (s *Service) RecordNonUndoable(
	ctx context.Context,
	q *dbgen.Queries,
	userID string,
	source Source,
	sourceID *string,
	entries []EntryInput,
) (string, error) {
	return s.record(ctx, q, userID, source, sourceID, entries, false)
}

func (s *Service) record(
	ctx context.Context,
	q *dbgen.Queries,
	userID string,
	source Source,
	sourceID *string,
	entries []EntryInput,
	undoable bool,
) (string, error) {
	if len(entries) == 0 {
		return "", nil
	}

	batchID := idgen.New(idgen.PrefixActivityBatch)
	if _, err := q.CreateActivityBatch(ctx, dbgen.CreateActivityBatchParams{
		ID:       batchID,
		UserID:   userID,
		Source:   string(source),
		SourceID: sourceID,
		Undoable: undoable,
	}); err != nil {
		return "", apperr.Internal(err)
	}

	for i, entry := range entries {
		before, err := encodeState(entry.BeforeState)
		if err != nil {
			return "", err
		}
		after, err := encodeState(entry.AfterState)
		if err != nil {
			return "", err
		}
		if _, err := q.CreateActivityEntry(ctx, dbgen.CreateActivityEntryParams{
			ID:           idgen.New(idgen.PrefixActivityEntry),
			UserID:       userID,
			BatchID:      batchID,
			Action:       entry.Action,
			ResourceType: entry.ResourceType,
			ResourceID:   entry.ResourceID,
			Title:        entry.Title,
			Summary:      entry.Summary,
			BeforeState:  before,
			AfterState:   after,
			Position:     int32(i),
		}); err != nil {
			return "", apperr.Internal(err)
		}
	}
	return batchID, nil
}

// Batch 是批次与其条目的组合。
type Batch struct {
	Row     dbgen.ActivityBatch
	Entries []dbgen.ActivityEntry
}

// List 分页读取批次。
func (s *Service) List(ctx context.Context, userID string, cursorTime *time.Time, cursorID *string, limit int32) ([]Batch, error) {
	var out []Batch
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListActivityBatches(ctx, dbgen.ListActivityBatchesParams{
			CursorCreatedAt: cursorTime,
			CursorID:        cursorID,
			RowLimit:        limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		if len(rows) == 0 {
			return nil
		}

		ids := make([]string, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row.ID)
		}
		entries, err := q.ListActivityEntriesForBatches(ctx, ids)
		if err != nil {
			return apperr.Internal(err)
		}
		grouped := make(map[string][]dbgen.ActivityEntry, len(rows))
		for _, e := range entries {
			grouped[e.BatchID] = append(grouped[e.BatchID], e)
		}
		for _, row := range rows {
			out = append(out, Batch{Row: row, Entries: grouped[row.ID]})
		}
		return nil
	})
	return out, err
}

// Undoable 判断批次当前是否仍可撤销。
func Undoable(row dbgen.ActivityBatch, now time.Time) bool {
	if row.UndoneAt != nil || !row.Undoable {
		return false
	}
	return now.Sub(row.CreatedAt) <= UndoWindow
}

// Undoer 由拥有具体资源的模块实现，负责把一条变更还原。
//
// Activity 不直接修改其他模块的表：撤销必须回到拥有该资源的模块，
// 由它重新执行状态机与校验。
type Undoer interface {
	// UndoEntry 还原一条变更。资源在本批次之后再次变化时必须返回 VERSION_CONFLICT。
	UndoEntry(ctx context.Context, q *dbgen.Queries, userID string, entry dbgen.ActivityEntry) error
	// Handles 报告该 Undoer 是否处理这种资源类型。
	Handles(resourceType string) bool
}

// Undo 撤销一个批次。
func (s *Service) Undo(ctx context.Context, userID, batchID string, undoers []Undoer, now time.Time) (Batch, error) {
	var out Batch
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetActivityBatch(ctx, batchID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("变更记录")
			}
			return apperr.Internal(err)
		}
		if row.UndoneAt != nil {
			return apperr.Newf(apperr.CodeVersionConflict, "这次变更已经撤销过了。")
		}
		if !Undoable(row, now) {
			return apperr.Newf(apperr.CodeVersionConflict, "已超过可撤销时间，请手动修改。")
		}

		entries, err := q.ListActivityEntries(ctx, batchID)
		if err != nil {
			return apperr.Internal(err)
		}

		// 逆序还原，保证依赖关系（例如先建 Tracker 后建 Record）被正确回退。
		for i := len(entries) - 1; i >= 0; i-- {
			entry := entries[i]
			handled := false
			for _, u := range undoers {
				if !u.Handles(entry.ResourceType) {
					continue
				}
				if err := u.UndoEntry(ctx, q, userID, entry); err != nil {
					return err
				}
				handled = true
				break
			}
			if !handled {
				return apperr.Newf(apperr.CodeValidationFailed,
					"这次变更包含暂不支持撤销的内容。")
			}
		}

		updated, err := q.MarkActivityBatchUndone(ctx, batchID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.Newf(apperr.CodeVersionConflict, "这次变更已经撤销过了。")
			}
			return apperr.Internal(err)
		}
		out = Batch{Row: updated, Entries: entries}
		return nil
	})
	return out, err
}

func encodeState(v any) ([]byte, error) {
	if v == nil {
		return nil, nil
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return raw, nil
}
