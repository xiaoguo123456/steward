package trackers

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

type captureCommandUsers struct{}

func (captureCommandUsers) Timezone(context.Context, *dbgen.Queries, string) (string, error) {
	return "Asia/Shanghai", nil
}

func TestUpdateRecordCommandInTxUsesVersionCAS(t *testing.T) {
	databaseURL := config.LoadForTest().DatabaseURL
	if databaseURL == "" {
		t.Skip("未设置测试数据库，跳过 Capture Record 更新集成测试")
	}
	db, err := database.Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatalf("连接测试库失败：%v", err)
	}
	t.Cleanup(db.Close)
	userID := idgen.New(idgen.PrefixUser)
	phone := fmt.Sprintf("196%08d", time.Now().UnixNano()%100000000)
	err = db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT id FROM auth_create_user($1, $2, $3, $4)`,
			userID, phone, "Capture Record 更新测试", "Asia/Shanghai").Scan(&userID)
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
			_, err = tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
			return err
		})
	})

	service := &Service{users: captureCommandUsers{}}
	err = db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		tracker, err := service.CreateTrackerInTx(ctx, q, userID, "体重", []httpapi.TrackerField{{
			Key: "weight", Label: "体重", Type: httpapi.TrackerFieldTypeNumber, Required: true,
		}}, nil)
		if err != nil {
			return err
		}
		record, err := service.CreateRecordInTx(ctx, q, userID, tracker.ID, time.Now(),
			[]httpapi.RecordValue{{Key: "weight", NumberValue: float64Pointer(70)}}, nil, nil)
		if err != nil {
			return err
		}
		values := []httpapi.RecordValue{{Key: "weight", NumberValue: float64Pointer(69.5)}}
		updated, err := service.UpdateRecordCommandInTx(ctx, q, userID, record.ID,
			httpapi.UpdateRecordRequest{Values: &values}, record.Version)
		if err != nil {
			return err
		}
		if updated.Version != record.Version+1 {
			t.Fatalf("Record version 未递增：%d", updated.Version)
		}
		_, err = service.UpdateRecordCommandInTx(ctx, q, userID, record.ID,
			httpapi.UpdateRecordRequest{Values: &values}, record.Version)
		if appErr, ok := apperr.As(err); !ok || appErr.Code != apperr.CodeVersionConflict {
			t.Fatalf("旧版本更新应返回版本冲突，实际为：%v", err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("执行 Capture Record 更新失败：%v", err)
	}
}

func float64Pointer(v float64) *float64 { return &v }
