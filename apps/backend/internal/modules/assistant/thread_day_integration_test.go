package assistant

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

type threadDayUserProfile struct {
	timezone string
}

func (p threadDayUserProfile) Timezone(context.Context, *dbgen.Queries, string) (string, error) {
	return p.timezone, nil
}

func (threadDayUserProfile) AiSettingsInTx(context.Context, *dbgen.Queries,
	string) (dbgen.UserAiSetting, error) {
	return dbgen.UserAiSetting{}, nil
}

func TestCurrentThreadUsesLatestUserMessageOfDay(t *testing.T) {
	db := assistantTestDB(t)
	userID := seedAssistantTestUser(t, db)

	dayStart := time.Date(2026, time.August, 24, 0, 0, 0, 0, time.UTC)
	olderThread := idgen.New(idgen.PrefixThread)
	currentThread := idgen.New(idgen.PrefixThread)
	defaultEmpty := idgen.New(idgen.PrefixThread)
	explicitEmpty := idgen.New(idgen.PrefixThread)

	err := db.InTx(context.Background(), userID, func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO assistant_threads
			    (id, user_id, title, last_message_seq, created_at, updated_at, created_for_default)
			VALUES
			    ($1, $5, '较早对话', 2, $6, $7, false),
			    ($2, $5, '当天对话', 1, $6, $8, false),
			    ($3, $5, '默认空对话', 0, $9, $9, true),
			    ($4, $5, '显式空对话', 0, $10, $10, false)`,
			olderThread, currentThread, defaultEmpty, explicitEmpty, userID,
			dayStart.Add(8*time.Hour), dayStart.AddDate(0, 0, 1).Add(time.Hour),
			dayStart.Add(12*time.Hour), dayStart.Add(13*time.Hour), dayStart.Add(14*time.Hour)); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO assistant_messages
			    (id, user_id, thread_id, message_seq, role, content, status, created_at)
			VALUES
			    ($1, $4, $5, 1, 'user', '较早用户消息', 'completed', $7),
			    ($2, $4, $5, 2, 'assistant', '跨午夜回复', 'completed', $8),
			    ($3, $4, $6, 1, 'user', '当天较新用户消息', 'completed', $9)`,
			idgen.New(idgen.PrefixMessage), idgen.New(idgen.PrefixMessage),
			idgen.New(idgen.PrefixMessage), userID, olderThread, currentThread,
			dayStart.Add(9*time.Hour), dayStart.AddDate(0, 0, 1).Add(time.Hour),
			dayStart.Add(11*time.Hour))
		return err
	})
	if err != nil {
		t.Fatalf("写入对话测试数据失败：%v", err)
	}

	svc := &Service{
		db:    db,
		users: threadDayUserProfile{timezone: "UTC"},
		now:   func() time.Time { return dayStart.Add(15 * time.Hour) },
	}
	got, err := svc.CurrentThread(context.Background(), userID)
	if err != nil {
		t.Fatalf("读取当天对话失败：%v", err)
	}
	if got == nil || got.ID != currentThread {
		t.Fatalf("应按最新用户消息选择 %s，实际为 %+v", currentThread, got)
	}

	err = db.InTx(context.Background(), userID, func(ctx context.Context, q *dbgen.Queries) error {
		got, err := q.GetCurrentDayEmptyThread(ctx, dbgen.GetCurrentDayEmptyThreadParams{
			DayStart: dayStart,
			DayEnd:   dayStart.AddDate(0, 0, 1),
		})
		if err != nil {
			return err
		}
		if got.ID != defaultEmpty {
			return fmt.Errorf("应复用默认空 Thread %s，实际为 %s", defaultEmpty, got.ID)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func assistantTestDB(t *testing.T) *database.DB {
	t.Helper()
	dsn := config.LoadForTest().DatabaseURL
	if dsn == "" {
		t.Skip("未设置 STEWARD_TEST_DATABASE_URL，跳过 Assistant Thread 集成测试")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	db, err := database.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("连接测试库失败：%v", err)
	}
	t.Cleanup(db.Close)
	return db
}

func seedAssistantTestUser(t *testing.T, db *database.DB) string {
	t.Helper()
	userID := idgen.New(idgen.PrefixUser)
	phone := fmt.Sprintf("199%08d", time.Now().UnixNano()%100_000_000)
	err := db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, "SELECT id FROM auth_create_user($1, $2, $3, $4)",
			userID, phone, "对话日期测试", "UTC").Scan(&userID)
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
			_, err = tx.Exec(ctx, "DELETE FROM users WHERE id = $1", userID)
			return err
		})
	})
	return userID
}
