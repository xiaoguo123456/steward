package captures

import (
	"context"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

type failedThenHealthyParser struct {
	calls        int
	brokenSchema bool
}

func (*failedThenHealthyParser) Name() string { return "failure-continuation-fixture" }
func (p *failedThenHealthyParser) ParseCapture(context.Context, ai.CaptureParseRequest) (ai.CaptureParseResult, error) {
	p.calls++
	if p.calls == 1 {
		if p.brokenSchema {
			return ai.CaptureParseResult{Candidates: []ai.CandidateDraft{{Type: "tracker", Title: "缺少字段"}}}, nil
		}
		return ai.CaptureParseResult{}, ai.ErrProviderUnavailable
	}
	return ai.CaptureParseResult{Candidates: []ai.CandidateDraft{weightTrackerCandidate()}}, nil
}

func TestFailedCaptureDoesNotBlockNextCapture(t *testing.T) {
	for _, broken := range []bool{false, true} {
		t.Run(map[bool]string{false: "模型失败", true: "候选字段损坏"}[broken], func(t *testing.T) {
			db := captureIntegrationDB(t)
			uid := seedCaptureUser(t, db)
			ctx := context.Background()
			parser := &failedThenHealthyParser{brokenSchema: broken}
			svc := New(db, parser, nil, nil, nil, nil, trackerCaptureLists{}, captureTestUsers{}, nil, nil, nil)
			ids := make([]CaptureParseArgs, 2)
			for i := range ids {
				cid := idgen.New(idgen.PrefixCapture)
				oid := idgen.New(idgen.PrefixOperation)
				ids[i] = CaptureParseArgs{UserID: uid, CaptureID: cid, OperationID: oid, Revision: 1, IdempotencyKey: "parse-" + cid}
				err := db.InTx(ctx, uid, func(ctx context.Context, q *dbgen.Queries) error {
					if _, err := q.CreateCapture(ctx, dbgen.CreateCaptureParams{ID: cid, UserID: uid, Status: "parsing", Origin: "assistant", Timezone: "Asia/Shanghai"}); err != nil {
						return err
					}
					if _, err := q.CreateOperation(ctx, dbgen.CreateOperationParams{ID: oid, UserID: uid, Kind: "capture.parse"}); err != nil {
						return err
					}
					_, err := q.CreateCapturePart(ctx, dbgen.CreateCapturePartParams{ID: idgen.New(idgen.PrefixCapturePart), UserID: uid, CaptureID: cid, Revision: 1, Kind: "text", Status: "succeeded", Text: optional("新建体重打卡")})
					return err
				})
				if err != nil {
					t.Fatal(err)
				}
				if err := svc.RunParse(ctx, ids[i]); err != nil {
					t.Fatal(err)
				}
			}
			err := db.InTx(ctx, uid, func(ctx context.Context, q *dbgen.Queries) error {
				for i, args := range ids {
					c, err := q.GetCapture(ctx, args.CaptureID)
					if err != nil {
						return err
					}
					op, err := q.GetOperation(ctx, args.OperationID)
					if err != nil {
						return err
					}
					if i == 0 {
						if c.Status != "failed" || op.Status != "failed" || op.CompletedAt == nil {
							t.Fatal("失败输入与任务必须收尾")
						}
					} else if c.Status != "needs_confirmation" || op.Status != "succeeded" {
						t.Fatal("失败输入阻塞了后续新输入")
					}
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.RunParse(ctx, ids[0]); err != nil {
				t.Fatal(err)
			}
			if parser.calls != 2 {
				t.Fatal("已失败任务的迟到重复投递不应重新调用模型")
			}
		})
	}
}
