package captures

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

func TestConfirmDuplicateRequiresChoiceAndCanUpdateExistingNote(t *testing.T) {
	db := captureIntegrationDB(t)
	userID := seedCaptureUser(t, db)
	objectService := objects.New(db, nil, nil, activity.New(db), nil)

	var existing dbgen.Note
	err := db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		var err error
		title := "原笔记!"
		existing, err = objectService.CreateNoteInTx(ctx, q, userID, objects.CreateNoteCommand{
			Title: &title, Content: "旧正文", CreatedBy: "user",
		})
		return err
	})
	if err != nil {
		t.Fatalf("创建已有笔记失败：%v", err)
	}
	// 重复检测由 Go 确定性执行；全角/半角标点和连续空白归一化后应命中。
	err = db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		duplicateTitle := "  原笔记！ "
		match, err := (&Service{}).detectDuplicate(ctx, q, userID, "note", httpapi.CaptureDraftPayload{
			Note: &httpapi.CaptureNoteDraft{Title: &duplicateTitle, Content: "旧正文"},
		})
		if err != nil {
			return err
		}
		if match == nil || match.id != existing.ID || match.version != existing.Version {
			t.Fatalf("确定性重复检测未命中已有笔记：%+v", match)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	captureID, candidateID := idgen.New(idgen.PrefixCapture), idgen.New(idgen.PrefixCandidate)
	newTitle := "更新后的笔记"
	payload, err := json.Marshal(httpapi.CaptureDraftPayload{Note: &httpapi.CaptureNoteDraft{
		Title: &newTitle, Content: "新正文",
	}})
	if err != nil {
		t.Fatal(err)
	}
	err = db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.CreateCapture(ctx, dbgen.CreateCaptureParams{
			ID: captureID, UserID: userID, Status: "needs_confirmation", Origin: "home", Timezone: "Asia/Shanghai",
		}); err != nil {
			return err
		}
		_, err := q.CreateCaptureCandidate(ctx, dbgen.CreateCaptureCandidateParams{
			ID: candidateID, UserID: userID, CaptureID: captureID, Revision: 1,
			CandidateType: "note", Action: "create", TargetID: &existing.ID,
			TargetExpectedVersion: &existing.Version, DuplicateOf: &existing.ID,
			Selected: true, Payload: payload, FieldConfidences: []byte("[]"), SourceRefs: []byte("[]"),
			MissingFields: []string{}, Warnings: []string{}, Position: 0,
		})
		return err
	})
	if err != nil {
		t.Fatalf("准备重复候选失败：%v", err)
	}

	svc := &Service{db: db, objects: objectService, activity: activity.New(db)}
	body := httpapi.ConfirmCaptureRequest{Revision: 1, Items: []httpapi.ConfirmCaptureItem{{CandidateId: candidateID}}}
	if _, err := svc.Confirm(context.Background(), userID, captureID, "duplicate-choice-missing", body); err == nil {
		t.Fatal("重复候选未选择处理方式时应拒绝确认")
	}
	resolution := httpapi.ConfirmCaptureItemDuplicateResolutionUpdate
	body.Items[0].DuplicateResolution = &resolution
	result, err := svc.Confirm(context.Background(), userID, captureID, "duplicate-choice-update", body)
	if err != nil {
		t.Fatalf("更新重复笔记失败：%v", err)
	}
	if result.SavedRows != 1 {
		t.Fatalf("保存行数 = %d，期望 1", result.SavedRows)
	}

	err = db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		updated, err := q.GetNote(ctx, existing.ID)
		if err != nil {
			return err
		}
		if updated.Title != newTitle || updated.Content != "新正文" || updated.Version != existing.Version+1 {
			t.Fatalf("笔记未按候选更新：%+v", updated)
		}
		if !json.Valid(updated.ProvenanceRefs) || !containsUpdatedFrom(updated.ProvenanceRefs) {
			t.Fatalf("没有追加 updated_from 来源：%s", updated.ProvenanceRefs)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func containsUpdatedFrom(raw []byte) bool {
	var refs []struct {
		Action string `json:"action"`
	}
	if json.Unmarshal(raw, &refs) != nil {
		return false
	}
	for _, ref := range refs {
		if ref.Action == "updated_from" {
			return true
		}
	}
	return false
}
