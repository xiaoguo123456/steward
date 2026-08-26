package trackers_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

func TestArchivedTrackerRetention(t *testing.T) {
	cfg := config.LoadForTest()
	if cfg.DatabaseURL == "" {
		t.Skip("未设置测试数据库，跳过归档保留集成测试")
	}

	ctx := context.Background()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatalf("连接测试库失败：%v", err)
	}
	t.Cleanup(db.Close)

	userID := idgen.New(idgen.PrefixUser)
	phone := fmt.Sprintf("199%08d", time.Now().UnixNano()%100000000)
	err = db.InTxAnonymous(ctx, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx,
			`SELECT id FROM auth_create_user($1, $2, $3, $4)`,
			userID, phone, "归档测试用户", "Asia/Shanghai",
		).Scan(&userID)
	})
	if err != nil {
		t.Fatalf("创建测试用户失败：%v", err)
	}
	t.Cleanup(func() {
		_ = db.InTx(context.Background(), userID, func(ctx context.Context, _ *dbgen.Queries) error {
			tx, err := database.TxFrom(ctx)
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
			return err
		})
	})

	trackerID := idgen.New(idgen.PrefixTracker)
	recordID := idgen.New(idgen.PrefixRecord)
	fields := []byte(`[{"key":"value","name":"数值","type":"number","required":true}]`)
	values := []byte(`[{"key":"value","number_value":1}]`)

	err = db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.CreateTracker(ctx, dbgen.CreateTrackerParams{
			ID: trackerID, UserID: userID, Name: "归档测试", Fields: fields,
			Status: "active", CreatedBy: "user", ProvenanceRefs: []byte("[]"),
		}); err != nil {
			return err
		}
		_, err := q.CreateRecord(ctx, dbgen.CreateRecordParams{
			ID: recordID, UserID: userID, Title: "归档记录", TrackerID: trackerID,
			Timestamp: time.Now(), Values: values, CreatedBy: "user", ProvenanceRefs: []byte("[]"),
		})
		return err
	})
	if err != nil {
		t.Fatalf("准备打卡项失败：%v", err)
	}

	firstArchivedAt := updateTrackerStatus(t, db, userID, trackerID, "archived")
	if firstArchivedAt == nil {
		t.Fatal("归档后没有写入 archived_at")
	}
	if restoredAt := updateTrackerStatus(t, db, userID, trackerID, "active"); restoredAt != nil {
		t.Fatal("恢复后 archived_at 没有清空")
	}

	// PostgreSQL 的 now() 是事务时间；等到下一毫秒再归档，模拟真实的下一次请求。
	time.Sleep(2 * time.Millisecond)
	secondArchivedAt := updateTrackerStatus(t, db, userID, trackerID, "archived")
	if secondArchivedAt == nil || !secondArchivedAt.After(*firstArchivedAt) {
		t.Fatal("再次归档没有开始新的保留周期")
	}

	err = db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		_, err := q.SoftDeleteExpiredArchivedTracker(ctx, dbgen.SoftDeleteExpiredArchivedTrackerParams{
			TrackerID: trackerID, ArchivedBefore: *firstArchivedAt,
		})
		if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("旧清理任务应当空跑，实际错误：%w", err)
		}
		if _, err := q.GetTracker(ctx, trackerID); err != nil {
			return fmt.Errorf("旧任务误删了新一轮归档：%w", err)
		}
		_, err = q.SoftDeleteExpiredArchivedTracker(ctx, dbgen.SoftDeleteExpiredArchivedTrackerParams{
			TrackerID: trackerID, ArchivedBefore: *secondArchivedAt,
		})
		return err
	})
	if err != nil {
		t.Fatalf("执行归档清理失败：%v", err)
	}

	err = db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.GetTracker(ctx, trackerID); !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("过期打卡项仍可读取：%w", err)
		}
		if _, err := q.GetRecord(ctx, recordID); !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("过期打卡项的记录仍可读取：%w", err)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func updateTrackerStatus(
	t *testing.T, db *database.DB, userID, trackerID, status string,
) *time.Time {
	t.Helper()
	var archivedAt *time.Time
	err := db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.UpdateTracker(ctx, dbgen.UpdateTrackerParams{
			ID: trackerID, Status: &status,
		})
		if err == nil {
			archivedAt = row.ArchivedAt
		}
		return err
	})
	if err != nil {
		t.Fatalf("更新打卡项状态失败：%v", err)
	}
	return archivedAt
}
