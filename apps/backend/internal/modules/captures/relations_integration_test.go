package captures

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

func seedRelationNotes(t *testing.T, db *database.DB, userID string) (string, string) {
	t.Helper()
	ids := []string{idgen.New(idgen.PrefixNote), idgen.New(idgen.PrefixNote)}
	err := db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		for index, id := range ids {
			_, err := q.CreateNote(ctx, dbgen.CreateNoteParams{
				ID:              id,
				UserID:          userID,
				NoteKind:        "general",
				Title:           fmt.Sprintf("关系测试笔记 %d", index+1),
				Content:         "用于验证 Capture 关系持久化",
				ContentDocument: []byte(`{"format":"plain_text","text":"用于验证 Capture 关系持久化"}`),
				Attachments:     []byte(`[]`),
				Tags:            []string{},
				CreatedBy:       "user",
				ProvenanceRefs:  []byte(`[]`),
			})
			if err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("创建关系端点失败：%v", err)
	}
	return ids[0], ids[1]
}

func TestPersistConfirmedRelationsRequiresBothSelectedEndpoints(t *testing.T) {
	db := captureIntegrationDB(t)
	userID := seedCaptureUser(t, db)
	fromID, toID := seedRelationNotes(t, db, userID)
	service := &Service{}
	candidates := []dbgen.CaptureRelationCandidate{{
		ID: "rel_candidate", UserID: userID, CaptureID: "cap_test", Revision: 1,
		Kind: "related_to", FromRef: "from_candidate", ToRef: "to_candidate",
	}}

	err := db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := service.PersistConfirmedRelations(ctx, q, userID, candidates,
			map[string]ConfirmedResource{
				"from_candidate": {Type: "note", ID: fromID},
			}, []byte(`[{"source_type":"capture","source_id":"cap_test"}]`))
		if err != nil {
			return err
		}
		if len(rows) != 0 {
			t.Fatalf("只选择一个端点时不应创建关系，实际创建 %d 条", len(rows))
		}
		return nil
	})
	if err != nil {
		t.Fatalf("保存未闭合关系失败：%v", err)
	}

	err = db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := service.PersistConfirmedRelations(ctx, q, userID, candidates,
			map[string]ConfirmedResource{
				"from_candidate": {Type: "note", ID: fromID},
				"to_candidate":   {Type: "note", ID: toID},
			}, []byte(`[{"source_type":"capture","source_id":"cap_test"}]`))
		if err != nil {
			return err
		}
		if len(rows) != 1 || rows[0].FromID != fromID || rows[0].ToID != toID {
			t.Fatalf("正式关系写入结果不正确：%+v", rows)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("保存闭合关系失败：%v", err)
	}
}

func TestPersistConfirmedRelationsConcurrentUpsertKeepsSingleIdentity(t *testing.T) {
	db := captureIntegrationDB(t)
	userID := seedCaptureUser(t, db)
	fromID, toID := seedRelationNotes(t, db, userID)
	service := &Service{}
	candidates := []dbgen.CaptureRelationCandidate{{
		ID: "rel_candidate", UserID: userID, CaptureID: "cap_test", Revision: 1,
		Kind: "requires", FromRef: "from_candidate", ToRef: "to_candidate",
	}}
	selected := map[string]ConfirmedResource{
		"from_candidate": {Type: "note", ID: fromID},
		"to_candidate":   {Type: "note", ID: toID},
	}

	const workers = 8
	start := make(chan struct{})
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for index := 0; index < workers; index++ {
		index := index
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			provenance, _ := json.Marshal([]map[string]any{{
				"source_type": "capture", "source_id": fmt.Sprintf("cap_%d", index),
			}})
			errs <- db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
				rows, err := service.PersistConfirmedRelations(
					ctx, q, userID, candidates, selected, provenance)
				if err == nil && len(rows) != 1 {
					return fmt.Errorf("并发写入应返回一条关系，实际 %d 条", len(rows))
				}
				return err
			})
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("并发保存关系失败：%v", err)
		}
	}

	err := db.InTx(context.Background(), userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		var count int
		if err := tx.QueryRow(ctx, `
			SELECT count(*)::int
			FROM relations
			WHERE user_id = $1 AND kind = 'requires'
			  AND from_type = 'note' AND from_id = $2
			  AND to_type = 'note' AND to_id = $3
			  AND deleted_at IS NULL
		`, userID, fromID, toID).Scan(&count); err != nil {
			return err
		}
		if count != 1 {
			t.Fatalf("并发确认后应只有一条有效关系，实际 %d 条", count)
		}
		var provenance []byte
		if err := tx.QueryRow(ctx, `
			SELECT provenance_refs
			FROM relations
			WHERE user_id = $1 AND kind = 'requires'
			  AND from_type = 'note' AND from_id = $2
			  AND to_type = 'note' AND to_id = $3
			  AND deleted_at IS NULL
		`, userID, fromID, toID).Scan(&provenance); err != nil {
			return err
		}
		var refs []map[string]any
		if err := json.Unmarshal(provenance, &refs); err != nil {
			return err
		}
		if len(refs) != workers {
			t.Fatalf("应合并 %d 个不同来源，实际 %d 个", workers, len(refs))
		}
		return nil
	})
	if err != nil {
		t.Fatalf("核对并发关系失败：%v", err)
	}
}

func TestPersistConfirmedRelationsRejectsCrossUserAndTrackerEndpoints(t *testing.T) {
	db := captureIntegrationDB(t)
	userID := seedCaptureUser(t, db)
	otherUserID := seedCaptureUser(t, db)
	fromID, _ := seedRelationNotes(t, db, userID)
	otherNoteID, _ := seedRelationNotes(t, db, otherUserID)
	service := &Service{}
	candidates := []dbgen.CaptureRelationCandidate{{
		ID: "rel_candidate", UserID: userID, CaptureID: "cap_test", Revision: 1,
		Kind: "related_to", FromRef: "from_candidate", ToRef: "to_candidate",
	}}

	err := db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		_, err := service.PersistConfirmedRelations(ctx, q, userID, candidates,
			map[string]ConfirmedResource{
				"from_candidate": {Type: "note", ID: fromID},
				"to_candidate":   {Type: "note", ID: otherNoteID},
			}, []byte(`[]`))
		return err
	})
	if err == nil {
		t.Fatal("不能把其他用户的正式内容作为 Relation 端点")
	}

	err = db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		_, err := service.PersistConfirmedRelations(ctx, q, userID, candidates,
			map[string]ConfirmedResource{
				"from_candidate": {Type: "note", ID: fromID},
				"to_candidate":   {Type: "tracker", ID: idgen.New(idgen.PrefixTracker)},
			}, []byte(`[]`))
		return err
	})
	if err == nil {
		t.Fatal("Tracker 不能作为 Relation 端点")
	}
}
