package objects

import (
	"context"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

func TestUpdateNoteCommandInTxUsesVersionCASAndUserIsolation(t *testing.T) {
	db := shoppingTestDB(t)
	userID := seedShoppingTestUser(t, db)
	otherUserID := seedShoppingTestUser(t, db)
	service := &Service{}
	noteID := idgen.New(idgen.PrefixNote)

	err := db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		created, err := q.CreateNote(ctx, dbgen.CreateNoteParams{
			ID: noteID, UserID: userID, NoteKind: "general", Title: "原标题",
			Content: "原正文", ContentDocument: []byte(`{"version":1,"blocks":[]}`),
			Attachments: []byte("[]"), Tags: []string{}, CreatedBy: "user",
			ProvenanceRefs: []byte("[]"),
		})
		if err != nil {
			return err
		}
		newTitle := "Capture 更新后的标题"
		updated, err := service.UpdateNoteCommandInTx(ctx, q, userID, noteID,
			httpapi.UpdateNoteRequest{Title: &newTitle}, created.Version)
		if err != nil {
			return err
		}
		if updated.Title != newTitle || updated.Version != created.Version+1 {
			t.Fatalf("更新结果不符合预期：title=%q version=%d", updated.Title, updated.Version)
		}
		_, err = service.UpdateNoteCommandInTx(ctx, q, userID, noteID,
			httpapi.UpdateNoteRequest{Title: &newTitle}, created.Version)
		if appErr, ok := apperr.As(err); !ok || appErr.Code != apperr.CodeVersionConflict {
			t.Fatalf("旧版本更新应返回版本冲突，实际为：%v", err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("执行 Capture Note 更新失败：%v", err)
	}

	err = db.InTx(context.Background(), otherUserID, func(ctx context.Context, q *dbgen.Queries) error {
		title := "越权修改"
		_, err := service.UpdateNoteCommandInTx(ctx, q, otherUserID, noteID,
			httpapi.UpdateNoteRequest{Title: &title}, 2)
		if err == nil {
			t.Fatal("其他用户不应能更新该 Note")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("执行用户隔离校验失败：%v", err)
	}
}
