package captures

import (
	"context"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/trackers"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

type trackerCaptureLists struct{}

func (trackerCaptureLists) ResolveListID(context.Context, *dbgen.Queries, string, *string) (string, error) {
	return "", nil
}

func TestTrackerCaptureConfirmsLinkedRecordOnce(t *testing.T) {
	db := captureIntegrationDB(t)
	userID := seedCaptureUser(t, db)
	ctx := context.Background()
	act := activity.New(db)
	service := New(db, nil, nil, nil, nil, trackers.New(db, captureTestUsers{}, act), trackerCaptureLists{}, captureTestUsers{}, act, nil, nil)
	captureID := idgen.New(idgen.PrefixCapture)
	opID := idgen.New(idgen.PrefixOperation)
	args := CaptureParseArgs{UserID: userID, CaptureID: captureID, OperationID: opID, Revision: 1, IdempotencyKey: "test-" + captureID}
	n := 68.5
	now := time.Now()
	result := ai.CaptureParseResult{Candidates: []ai.CandidateDraft{
		{Type: "record", Ref: "measurement", Title: "体重记录", TrackerRef: "weight", Timestamp: &now, RecordValues: []ai.RecordValueDraft{{Key: "weight_kg", Number: &n}}, Missing: []string{"tracker_id", "tracker_ref"}},
		weightTrackerCandidate(),
	}}
	err := db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		c, err := q.CreateCapture(ctx, dbgen.CreateCaptureParams{ID: captureID, UserID: userID, Status: "parsing", Origin: "home", Timezone: "Asia/Shanghai"})
		if err != nil {
			return err
		}
		if _, err := q.CreateOperation(ctx, dbgen.CreateOperationParams{ID: opID, UserID: userID, Kind: "capture.parse"}); err != nil {
			return err
		}
		return service.saveParseResult(ctx, q, args, c, nil, nil, result)
	})
	if err != nil {
		t.Fatal(err)
	}
	detail, err := service.Get(ctx, userID, captureID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Capture.Status != "needs_confirmation" || len(detail.Candidates) != 2 {
		t.Fatal("应产生两个待确认候选")
	}
	record := detail.Candidates[0]
	tracker := detail.Candidates[1]
	draft := decodePayload(record.Payload).Record
	if draft.TrackerRef == nil || *draft.TrackerRef != tracker.ID || !record.Selected || len(record.MissingFields) != 0 {
		t.Fatal("同批引用未解析或残留不可补全的 tracker_id")
	}
	if err := db.InTx(ctx, userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		var count int
		if err := tx.QueryRow(ctx, "SELECT (SELECT count(*) FROM trackers)+(SELECT count(*) FROM records)").Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			t.Fatal("确认前不能创建正式记录项或记录")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	body := httpapi.ConfirmCaptureRequest{Revision: 1, Items: []httpapi.ConfirmCaptureItem{{CandidateId: record.ID}, {CandidateId: tracker.ID}}}
	confirmed, err := service.Confirm(ctx, userID, captureID, "confirm-"+captureID, body)
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Detail.Capture.Status != "confirmed" {
		t.Fatal("确认没有完成")
	}
	if err := db.InTx(ctx, userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		var count int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM records r JOIN trackers t ON t.id=r.tracker_id AND t.user_id=r.user_id WHERE t.name='体重' AND r.values @> '[{\"key\":\"weight_kg\",\"number_value\":68.5}]'::jsonb").Scan(&count); err != nil {
			return err
		}
		if count != 1 {
			t.Fatal("确认后应只有一条关联到体重的正确数值记录")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	replay, err := service.Confirm(ctx, userID, captureID, "confirm-"+captureID, body)
	if err != nil {
		t.Fatal(err)
	}
	if replay.BatchID != confirmed.BatchID {
		t.Fatal("重复确认不得创建第二批数据")
	}
}
