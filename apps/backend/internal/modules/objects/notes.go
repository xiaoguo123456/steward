package objects

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/domain/notecontent"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// NoteFilter 是 Note 列表查询条件。
type NoteFilter struct {
	Tag        *string
	ProjectID  *string
	Query      *string
	CursorTime *time.Time
	CursorID   *string
	Limit      int32
}

// ListNotes 查询 Note。
func (s *Service) ListNotes(ctx context.Context, userID string, f NoteFilter) ([]dbgen.Note, error) {
	var out []dbgen.Note
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListNotes(ctx, dbgen.ListNotesParams{
			Tag:             f.Tag,
			ProjectID:       f.ProjectID,
			Query:           f.Query,
			CursorUpdatedAt: f.CursorTime,
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

// GetNote 读取单个 Note。
func (s *Service) GetNote(ctx context.Context, userID, noteID string) (dbgen.Note, error) {
	var out dbgen.Note
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetNote(ctx, noteID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("笔记")
			}
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// ListNoteTags 返回当前用户使用过的全部标签。
func (s *Service) ListNoteTags(ctx context.Context, userID string) ([]string, error) {
	var out []string
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		tags, err := q.ListNoteTags(ctx)
		if err != nil {
			return apperr.Internal(err)
		}
		out = tags
		return nil
	})
	return out, err
}

// CreateNote 新建 Note。
func (s *Service) CreateNote(ctx context.Context, userID string, body httpapi.CreateNoteRequest) (dbgen.Note, error) {
	contentDocument, content, err := notecontent.EncodePlainText(body.Content)
	if err != nil {
		return dbgen.Note{}, err
	}

	var out dbgen.Note
	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		replayBody, replayed, requestHash, err := beginObjectReplay(
			ctx, q, userID, "notes.create", body)
		if err != nil {
			return err
		}
		if replayed {
			if err := json.Unmarshal(replayBody, &out); err != nil {
				return apperr.Internal(err)
			}
			return nil
		}
		if body.ProjectId != nil {
			if err := s.assertProjectExists(ctx, q, *body.ProjectId); err != nil {
				return err
			}
		}
		provenance := []ProvenanceInput{}
		if body.PolishActionId != nil {
			actionID := strings.TrimSpace(*body.PolishActionId)
			if actionID == "" {
				return apperr.Validation(apperr.Field(
					"polish_action_id", "润色来源不能为空。"))
			}
			if _, err := q.GetSuccessfulNotePolishAction(ctx, dbgen.GetSuccessfulNotePolishActionParams{
				ActionID: actionID,
				UserID:   userID,
			}); err != nil {
				if database.IsNoRows(err) {
					return apperr.Validation(apperr.Field(
						"polish_action_id", "润色结果已失效，请重新润色。"))
				}
				return apperr.Internal(err)
			}
			provenance = append(provenance, ProvenanceInput{
				SourceType: "ai_action",
				SourceID:   actionID,
				Action:     "derived_from",
			})
		}
		provenanceJSON, err := marshalJSON(provenance)
		if err != nil {
			return err
		}
		created, err := q.CreateNote(ctx, dbgen.CreateNoteParams{
			ID:              idgen.New(idgen.PrefixNote),
			UserID:          userID,
			NoteKind:        "general",
			Title:           deriveNoteTitle(body.Title, content),
			Content:         content,
			ContentDocument: contentDocument,
			Attachments:     emptyJSONArray,
			Tags:            normalizeTags(body.Tags),
			ProjectID:       body.ProjectId,
			CreatedBy:       "user",
			ProvenanceRefs:  provenanceJSON,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		if _, err := s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action:       "created",
				ResourceType: "note",
				ResourceID:   created.ID,
				Title:        created.Title,
				Summary:      "创建了笔记",
			}}); err != nil {
			return err
		}
		out = created
		return saveObjectReplay(ctx, q, userID, "notes.create", requestHash, 201, created.ID, out)
	})
	return out, err
}

// NoteUpdate 是 Note 的修改意图。
type NoteUpdate struct {
	Body            httpapi.UpdateNoteRequest
	ExpectedVersion *int32
}

// UpdateNote 修改 Note。
func (s *Service) UpdateNote(ctx context.Context, userID, noteID string, in NoteUpdate) (dbgen.Note, error) {
	var out dbgen.Note
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetNote(ctx, noteID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("笔记")
			}
			return apperr.Internal(err)
		}
		updated, err := s.updateNoteCommandInTx(ctx, q, userID, noteID, in.Body, in.ExpectedVersion)
		if err != nil {
			return err
		}

		if _, err := s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action:       "updated",
				ResourceType: "note",
				ResourceID:   updated.ID,
				Title:        updated.Title,
				Summary:      "修改了笔记",
				BeforeState:  map[string]any{"title": current.Title, "content": current.Content},
				AfterState:   map[string]any{"title": updated.Title, "content": updated.Content},
			}}); err != nil {
			return err
		}
		out = updated
		return nil
	})
	return out, err
}

// UpdateNoteCommandInTx 在 Capture 确认事务内更新 Note，不单独创建 Activity 批次。
func (s *Service) UpdateNoteCommandInTx(ctx context.Context, q *dbgen.Queries,
	userID, noteID string, body httpapi.UpdateNoteRequest, expectedVersion int32) (dbgen.Note, error) {
	return s.updateNoteCommandInTx(ctx, q, userID, noteID, body, &expectedVersion)
}

func (s *Service) updateNoteCommandInTx(ctx context.Context, q *dbgen.Queries,
	userID, noteID string, body httpapi.UpdateNoteRequest, expectedVersion *int32) (dbgen.Note, error) {
	current, err := q.GetNoteForUpdate(ctx, noteID)
	if err != nil {
		if database.IsNoRows(err) {
			return dbgen.Note{}, apperr.NotFound("笔记")
		}
		return dbgen.Note{}, apperr.Internal(err)
	}
	if expectedVersion != nil && *expectedVersion != current.Version {
		return dbgen.Note{}, apperr.New(apperr.CodeVersionConflict)
	}
	if body.ProjectId != nil {
		if err := s.assertProjectExists(ctx, q, *body.ProjectId); err != nil {
			return dbgen.Note{}, err
		}
	}

	var content *string
	var contentDocument []byte
	if body.Content != nil {
		document, plaintext, err := notecontent.EncodePlainText(*body.Content)
		if err != nil {
			return dbgen.Note{}, err
		}
		content = &plaintext
		contentDocument = document
	}
	var tags []string
	if body.Tags != nil {
		tags = normalizeTags(body.Tags)
	}
	clearProject := false
	if body.Clear != nil {
		for _, item := range *body.Clear {
			if item == httpapi.UpdateNoteRequestClearProjectId {
				clearProject = true
			}
		}
	}
	updated, err := q.UpdateNote(ctx, dbgen.UpdateNoteParams{
		ID: noteID, Title: trimmedOrNil(body.Title), Content: content,
		ContentDocument: contentDocument, Tags: tags, Pinned: body.Pinned,
		ProjectID: body.ProjectId, ClearProjectID: clearProject,
	})
	if err != nil {
		return dbgen.Note{}, apperr.Internal(err)
	}
	return updated, nil
}

// DeleteNote 软删除 Note。
func (s *Service) DeleteNote(ctx context.Context, userID, noteID string) (string, error) {
	var batchID string
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		replayBody, replayed, requestHash, err := beginObjectReplay(
			ctx, q, userID, "notes.delete", map[string]string{"note_id": noteID})
		if err != nil {
			return err
		}
		if replayed {
			if err := json.Unmarshal(replayBody, &batchID); err != nil {
				return apperr.Internal(err)
			}
			return nil
		}
		current, err := q.GetNoteForUpdate(ctx, noteID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("笔记")
			}
			return apperr.Internal(err)
		}
		if _, err := q.SoftDeleteNote(ctx, noteID); err != nil {
			return apperr.Internal(err)
		}
		batchID, err = s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action:       "deleted",
				ResourceType: "note",
				ResourceID:   noteID,
				Title:        current.Title,
				Summary:      "删除了笔记",
			}})
		if err != nil {
			return err
		}
		return saveObjectReplay(ctx, q, userID, "notes.delete", requestHash, 200, batchID, batchID)
	})
	return batchID, err
}

// normalizeTags 去重并去空白。同一 Note 内标签不重复。
func normalizeTags(tags *[]string) []string {
	if tags == nil {
		return []string{}
	}
	seen := make(map[string]struct{}, len(*tags))
	out := make([]string, 0, len(*tags))
	for _, tag := range *tags {
		t := strings.TrimSpace(tag)
		if t == "" {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	return out
}
