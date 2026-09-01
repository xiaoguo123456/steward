package relationships

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/objects"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

func relationshipTestDB(t *testing.T) *database.DB {
	t.Helper()
	databaseURL := config.LoadForTest().DatabaseURL
	if databaseURL == "" {
		t.Skip("未设置 STEWARD_TEST_DATABASE_URL，跳过亲友联动集成测试")
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

func seedRelationshipTestUser(t *testing.T, db *database.DB, label string) string {
	t.Helper()
	var userID string
	phone := fmt.Sprintf("16%09d", time.Now().UnixNano()%1_000_000_000)
	err := db.InTxAnonymous(context.Background(), func(ctx context.Context, _ *dbgen.Queries) error {
		tx, err := database.TxFrom(ctx)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, "SELECT id FROM auth_create_user($1, $2, $3, $4)",
			idgen.New(idgen.PrefixUser), phone, label, "Asia/Shanghai").Scan(&userID)
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

func TestTaskPersonLinkKeepsListAndUserIsolation(t *testing.T) {
	db := relationshipTestDB(t)
	ownerID := seedRelationshipTestUser(t, db, "亲友联动测试")
	otherID := seedRelationshipTestUser(t, db, "亲友隔离测试")
	service := &Service{}
	objectService := (&objects.Service{}).WithPersonLinker(service)
	personID := idgen.New(idgen.PrefixPerson)
	var taskID string
	listID := idgen.New(idgen.PrefixTaskList)

	err := db.InTx(context.Background(), ownerID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.CreateTaskList(ctx, dbgen.CreateTaskListParams{
			ID: listID, UserID: ownerID, Name: "家人事项", Position: 0,
			IsDefault: true, ListKind: "tasks",
		}); err != nil {
			return err
		}
		if _, err := q.CreatePerson(ctx, dbgen.CreatePersonParams{
			ID: personID, UserID: ownerID, Name: "妈妈", RelationshipGroup: "family",
			CreatedBy: "user", ProvenanceRefs: []byte("[]"),
		}); err != nil {
			return err
		}
		created, err := objectService.CreateTaskInTx(ctx, q, ownerID, objects.CreateTaskCommand{
			Title: "买药", ListID: listID, PersonID: &personID, CreatedBy: "user",
		})
		if err != nil {
			return err
		}
		taskID = created.ID
		rows, err := q.ListTasks(ctx, dbgen.ListTasksParams{
			Statuses: []string{"todo", "doing"}, PersonID: &personID, RowLimit: 20,
		})
		if err != nil {
			return err
		}
		if len(rows) != 1 || rows[0].ID != taskID || rows[0].ListID != listID {
			t.Fatalf("人物筛选丢失任务或改变了清单归属：%+v", rows)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	err = db.InTx(context.Background(), otherID, func(ctx context.Context, q *dbgen.Queries) error {
		return service.LinkTask(ctx, q, otherID, taskID, personID)
	})
	var domainErr *apperr.Error
	if !errors.As(err, &domainErr) || domainErr.Code != apperr.CodeNotFound {
		t.Fatalf("其他账号关联人物时应返回不存在，实际：%v", err)
	}
}
