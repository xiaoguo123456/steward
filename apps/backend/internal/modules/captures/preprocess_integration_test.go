package captures

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

type mediaGateParser struct {
	calls int
}

func (p *mediaGateParser) Name() string { return "media-gate-test" }

func (p *mediaGateParser) ParseCapture(context.Context, ai.CaptureParseRequest) (ai.CaptureParseResult, error) {
	p.calls++
	return ai.CaptureParseResult{}, nil
}

type mediaGateProcessor struct{}

func (mediaGateProcessor) ExtractFromImage(_ context.Context, input ai.MediaInput) (string, ai.Usage, error) {
	if strings.HasSuffix(string(input.Data), "-bad") {
		return "", ai.Usage{}, errors.New("测试媒体识别失败")
	}
	return "识别成功", ai.Usage{}, nil
}

func (mediaGateProcessor) Transcribe(ctx context.Context, input ai.MediaInput) (string, ai.Usage, error) {
	return mediaGateProcessor{}.ExtractFromImage(ctx, input)
}

type mediaGateReader struct{}

func (mediaGateReader) ResolveForParse(_ context.Context, userID, mediaID string) (dbgen.MediaAsset, error) {
	return dbgen.MediaAsset{
		ID: mediaID, UserID: userID, ObjectKey: mediaID, ContentType: "image/jpeg", Status: "uploaded",
	}, nil
}

func (mediaGateReader) ReadBytes(_ context.Context, objectKey string, _ int64) ([]byte, error) {
	return []byte(objectKey), nil
}

type mediaGateUserProfile struct{}

func (mediaGateUserProfile) Timezone(context.Context, *dbgen.Queries, string) (string, error) {
	return "Asia/Shanghai", nil
}

func (mediaGateUserProfile) AiSettingsInTx(context.Context, *dbgen.Queries, string) (dbgen.UserAiSetting, error) {
	return dbgen.UserAiSetting{CaptureParseEnabled: true}, nil
}

func captureMediaGateTestDB(t *testing.T) *database.DB {
	t.Helper()
	databaseURL := config.LoadForTest().DatabaseURL
	if databaseURL == "" {
		t.Skip("未设置 STEWARD_TEST_DATABASE_URL，跳过 Capture 媒体门禁集成测试")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("连接测试库失败：%v", err)
	}
	t.Cleanup(db.Close)
	return db
}

func seedCaptureMediaGateUser(t *testing.T, db *database.DB) string {
	t.Helper()
	var userID string
	phone := fmt.Sprintf("15%09d", time.Now().UnixNano()%1_000_000_000)
	err := db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, "SELECT id FROM auth_create_user($1, $2, $3, $4)",
			idgen.New(idgen.PrefixUser), phone, "媒体门禁测试", "Asia/Shanghai").Scan(&userID)
	})
	if err != nil {
		t.Fatalf("创建测试用户失败：%v", err)
	}
	t.Cleanup(func() {
		_ = db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
			tx, err := database.TxFrom(ctx)
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx, "DELETE FROM users WHERE id = $1", userID)
			return err
		})
	})
	return userID
}

func TestRunParseStopsAtMediaFailureGate(t *testing.T) {
	db := captureMediaGateTestDB(t)

	tests := []struct {
		name                string
		withText            bool
		mediaIDs            []string
		wantCaptureStatus   string
		wantOperationStatus string
	}{
		{
			name: "一项成功一项失败时等待用户处理", mediaIDs: []string{"good", "bad"},
			wantCaptureStatus: "partially_failed", wantOperationStatus: "succeeded",
		},
		{
			name: "全部媒体失败且无文字时整体失败", mediaIDs: []string{"bad"},
			wantCaptureStatus: "failed", wantOperationStatus: "failed",
		},
		{
			name: "全部媒体失败但文字可用时等待用户处理", withText: true, mediaIDs: []string{"bad"},
			wantCaptureStatus: "partially_failed", wantOperationStatus: "succeeded",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			userID := seedCaptureMediaGateUser(t, db)
			captureID := idgen.New(idgen.PrefixCapture)
			operationID := idgen.New(idgen.PrefixOperation)
			args := CaptureParseArgs{
				SchemaVersion: 1, UserID: userID, CaptureID: captureID, Revision: 1,
				OperationID: operationID, IdempotencyKey: "capture:" + captureID + ":revision:1:parse",
			}

			err := db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
				capture, err := q.CreateCapture(ctx, dbgen.CreateCaptureParams{
					ID: captureID, UserID: userID, Status: "preprocessing", Origin: "home", Timezone: "Asia/Shanghai",
				})
				if err != nil {
					return err
				}
				position := int32(0)
				if tt.withText {
					text := "这是可用文字"
					if _, err := q.CreateCapturePart(ctx, dbgen.CreateCapturePartParams{
						ID: idgen.New(idgen.PrefixCapturePart), UserID: userID, CaptureID: capture.ID,
						Revision: capture.Revision, Kind: "text", Status: "succeeded", Position: position, Text: &text,
					}); err != nil {
						return err
					}
					position++
				}
				for _, mediaID := range tt.mediaIDs {
					mediaID := captureID + "-" + mediaID
					if _, err := q.CreateMediaAsset(ctx, dbgen.CreateMediaAssetParams{
						ID: mediaID, UserID: userID, ObjectKey: mediaID, Kind: "image", ContentType: "image/jpeg",
					}); err != nil {
						return err
					}
					if _, err := q.CreateCapturePart(ctx, dbgen.CreateCapturePartParams{
						ID: idgen.New(idgen.PrefixCapturePart), UserID: userID, CaptureID: capture.ID,
						Revision: capture.Revision, Kind: "image", Status: "pending", Position: position, MediaID: &mediaID,
					}); err != nil {
						return err
					}
					position++
				}
				_, err = q.CreateOperation(ctx, dbgen.CreateOperationParams{
					ID: operationID, UserID: userID, Kind: "capture.parse",
				})
				return err
			})
			if err != nil {
				t.Fatal(err)
			}

			parser := &mediaGateParser{}
			service := New(db, parser, mediaGateProcessor{}, mediaGateReader{}, nil, nil, nil,
				mediaGateUserProfile{}, nil, nil, nil)
			if err := service.RunParse(context.Background(), args); err != nil {
				t.Fatalf("执行 Capture 解析失败：%v", err)
			}
			if parser.calls != 0 {
				t.Fatalf("媒体失败时仍调用了解析器 %d 次", parser.calls)
			}

			err = db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
				capture, err := q.GetCapture(ctx, captureID)
				if err != nil {
					return err
				}
				if capture.Status != tt.wantCaptureStatus {
					t.Fatalf("Capture 状态 = %q，期望 %q", capture.Status, tt.wantCaptureStatus)
				}
				operation, err := q.GetOperation(ctx, operationID)
				if err != nil {
					return err
				}
				if operation.Status != tt.wantOperationStatus || operation.CompletedAt == nil {
					t.Fatalf("Operation 未合理结束：status=%q completed_at=%v", operation.Status, operation.CompletedAt)
				}
				if _, err := q.GetProcessedJob(ctx, args.IdempotencyKey); err != nil {
					return fmt.Errorf("本轮任务未登记为已处理：%w", err)
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}
