package objects

import (
	"context"
	"sync"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

func TestCreateProjectIdempotencyIsAtomic(t *testing.T) {
	db := shoppingTestDB(t)
	userID := seedShoppingTestUser(t, db)
	service := &Service{db: db, activity: activity.New(db)}
	ctx := httpx.WithIdempotencyKey(context.Background(), "project-create-concurrent")
	body := httpapi.CreateProjectRequest{Title: "并发幂等项目"}

	const workers = 2
	start := make(chan struct{})
	results := make(chan string, workers)
	errs := make(chan error, workers)
	var group sync.WaitGroup
	for range workers {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			project, err := service.CreateProject(ctx, userID, body)
			if err != nil {
				errs <- err
				return
			}
			results <- project.Row.ID
		}()
	}
	close(start)
	group.Wait()
	close(results)
	close(errs)

	for err := range errs {
		t.Fatalf("并发幂等创建失败：%v", err)
	}
	var first string
	count := 0
	for id := range results {
		count++
		if first == "" {
			first = id
		} else if id != first {
			t.Fatalf("相同幂等键创建了不同项目：%s != %s", first, id)
		}
	}
	if count != workers {
		t.Fatalf("预期 %d 个成功响应，实际 %d", workers, count)
	}
	changedTitle := "创建后又被修改"
	if _, err := service.UpdateProject(context.Background(), userID, first,
		ProjectUpdate{Body: httpapi.UpdateProjectRequest{Title: &changedTitle}}); err != nil {
		t.Fatalf("准备响应快照回归场景失败：%v", err)
	}
	replayed, err := service.CreateProject(ctx, userID, body)
	if err != nil {
		t.Fatalf("重放首次创建响应失败：%v", err)
	}
	if replayed.Row.Title != body.Title {
		t.Fatalf("幂等重放没有恢复首次响应：want=%q got=%q", body.Title, replayed.Row.Title)
	}

	_, err = service.CreateProject(ctx, userID, httpapi.CreateProjectRequest{Title: "不同请求"})
	assertAppErrorCode(t, err, apperr.CodeIdempotencyReused)
}

func TestUpdateProjectIfMatchIsAtomic(t *testing.T) {
	db := shoppingTestDB(t)
	userID := seedShoppingTestUser(t, db)
	service := &Service{db: db, activity: activity.New(db)}
	created, err := service.CreateProject(context.Background(), userID,
		httpapi.CreateProjectRequest{Title: "版本保护项目"})
	if err != nil {
		t.Fatalf("创建项目失败：%v", err)
	}
	expected := created.Row.Version

	start := make(chan struct{})
	errs := make(chan error, 2)
	var group sync.WaitGroup
	for _, title := range []string{"并发更新甲", "并发更新乙"} {
		title := title
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			_, updateErr := service.UpdateProject(context.Background(), userID, created.Row.ID,
				ProjectUpdate{Body: httpapi.UpdateProjectRequest{Title: &title}, ExpectedVersion: &expected})
			errs <- updateErr
		}()
	}
	close(start)
	group.Wait()
	close(errs)

	succeeded := 0
	conflicted := 0
	for updateErr := range errs {
		if updateErr == nil {
			succeeded++
			continue
		}
		appErr, ok := apperr.As(updateErr)
		if ok && appErr.Code == apperr.CodeVersionConflict {
			conflicted++
			continue
		}
		t.Fatalf("并发更新返回意外错误：%v", updateErr)
	}
	if succeeded != 1 || conflicted != 1 {
		t.Fatalf("If-Match 原子保护失效：成功=%d，版本冲突=%d", succeeded, conflicted)
	}
}

func assertAppErrorCode(t *testing.T, err error, want apperr.Code) {
	t.Helper()
	appErr, ok := apperr.As(err)
	if !ok || appErr.Code != want {
		t.Fatalf("错误码不匹配：want=%s err=%v", want, err)
	}
}
