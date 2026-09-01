package objects

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// ProjectWithProgress 是 Project 及其确定性进度统计。
type ProjectWithProgress struct {
	Row   dbgen.Project
	Total int32
	Done  int32
	Open  int32
}

// Progress 计算进度：已完成 ÷（全部 - 已取消）。
// 没有有效 Task 时返回 nil，页面显示“暂无有效任务”而不是误导性的 0%。
func (p ProjectWithProgress) Progress() *float32 {
	if p.Total == 0 {
		return nil
	}
	value := float32(p.Done) / float32(p.Total)
	return &value
}

// ListProjects 查询 Project。
func (s *Service) ListProjects(ctx context.Context, userID string, statuses []string,
	projectKind *string, cursorTime *time.Time, cursorID *string, limit int32) ([]ProjectWithProgress, error) {
	if len(statuses) == 0 {
		// 契约约定：不传 status 时默认排除已归档项目。
		statuses = []string{"active", "paused"}
	}

	var out []ProjectWithProgress
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListProjects(ctx, dbgen.ListProjectsParams{
			Statuses:        statuses,
			ProjectKind:     projectKind,
			CursorCreatedAt: cursorTime,
			CursorID:        cursorID,
			RowLimit:        limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		for _, row := range rows {
			counts, err := q.CountTasksByProject(ctx, &row.ID)
			if err != nil {
				return apperr.Internal(err)
			}
			out = append(out, ProjectWithProgress{
				Row: row, Total: counts.Total, Done: counts.Done, Open: counts.Open,
			})
		}
		return nil
	})
	return out, err
}

// GetProject 读取单个 Project。
func (s *Service) GetProject(ctx context.Context, userID, projectID string) (ProjectWithProgress, error) {
	var out ProjectWithProgress
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetProject(ctx, projectID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("项目")
			}
			return apperr.Internal(err)
		}
		counts, err := q.CountTasksByProject(ctx, &row.ID)
		if err != nil {
			return apperr.Internal(err)
		}
		out = ProjectWithProgress{Row: row, Total: counts.Total, Done: counts.Done, Open: counts.Open}
		return nil
	})
	return out, err
}

// CreateProject 新建 Project。
func (s *Service) CreateProject(ctx context.Context, userID string, body httpapi.CreateProjectRequest) (ProjectWithProgress, error) {
	title := strings.TrimSpace(body.Title)
	if title == "" {
		return ProjectWithProgress{}, apperr.Validation(apperr.Field("title", "项目名称不能为空。"))
	}
	if body.StartDate != nil && body.TargetDate != nil && body.TargetDate.Time.Before(body.StartDate.Time) {
		return ProjectWithProgress{}, apperr.Validation(apperr.Field(
			"target_date", "目标完成日期不能早于开始日期。"))
	}

	var out ProjectWithProgress
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		replayBody, replayed, requestHash, err := beginObjectReplay(
			ctx, q, userID, "projects.create", body)
		if err != nil {
			return err
		}
		if replayed {
			if err := json.Unmarshal(replayBody, &out); err != nil {
				return apperr.Internal(err)
			}
			return nil
		}
		created, err := q.CreateProject(ctx, dbgen.CreateProjectParams{
			ID:             idgen.New(idgen.PrefixProject),
			UserID:         userID,
			Title:          title,
			Description:    body.Description,
			Status:         "active",
			ProjectKind:    projectKindOr(body.ProjectKind),
			StartDate:      timePtrOfDate(body.StartDate),
			TargetDate:     timePtrOfDate(body.TargetDate),
			CreatedBy:      "user",
			ProvenanceRefs: emptyJSONArray,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		if _, err := s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action:       "created",
				ResourceType: "project",
				ResourceID:   created.ID,
				Title:        created.Title,
				Summary:      "创建了项目",
			}}); err != nil {
			return err
		}
		out = ProjectWithProgress{Row: created}
		return saveObjectReplay(ctx, q, userID, "projects.create", requestHash, 201, created.ID, out)
	})
	return out, err
}

// ProjectUpdate 是 Project 的修改意图。
type ProjectUpdate struct {
	Body            httpapi.UpdateProjectRequest
	ExpectedVersion *int32
}

// UpdateProject 修改 Project。
func (s *Service) UpdateProject(ctx context.Context, userID, projectID string, in ProjectUpdate) (ProjectWithProgress, error) {
	var out ProjectWithProgress
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetProject(ctx, projectID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("项目")
			}
			return apperr.Internal(err)
		}
		updated, err := s.updateProjectCommandInTx(ctx, q, userID, projectID, in.Body, in.ExpectedVersion)
		if err != nil {
			return err
		}

		if _, err := s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action:       "updated",
				ResourceType: "project",
				ResourceID:   updated.ID,
				Title:        updated.Title,
				Summary:      "修改了项目",
				BeforeState:  map[string]any{"status": current.Status, "title": current.Title},
				AfterState:   map[string]any{"status": updated.Status, "title": updated.Title},
			}}); err != nil {
			return err
		}

		counts, err := q.CountTasksByProject(ctx, &projectID)
		if err != nil {
			return apperr.Internal(err)
		}
		out = ProjectWithProgress{Row: updated, Total: counts.Total, Done: counts.Done, Open: counts.Open}
		return nil
	})
	return out, err
}

// UpdateProjectCommandInTx 在 Capture 确认事务内更新 Project，不单独创建 Activity 批次。
func (s *Service) UpdateProjectCommandInTx(ctx context.Context, q *dbgen.Queries,
	userID, projectID string, body httpapi.UpdateProjectRequest, expectedVersion int32) (dbgen.Project, error) {
	return s.updateProjectCommandInTx(ctx, q, userID, projectID, body, &expectedVersion)
}

func (s *Service) updateProjectCommandInTx(ctx context.Context, q *dbgen.Queries,
	userID, projectID string, body httpapi.UpdateProjectRequest, expectedVersion *int32) (dbgen.Project, error) {
	current, err := q.GetProjectForUpdate(ctx, projectID)
	if err != nil {
		if database.IsNoRows(err) {
			return dbgen.Project{}, apperr.NotFound("项目")
		}
		return dbgen.Project{}, apperr.Internal(err)
	}
	if expectedVersion != nil && *expectedVersion != current.Version {
		return dbgen.Project{}, apperr.New(apperr.CodeVersionConflict)
	}
	counts, err := q.CountTasksByProject(ctx, &projectID)
	if err != nil {
		return dbgen.Project{}, apperr.Internal(err)
	}
	var status *string
	if body.Status != nil {
		next, err := resolveProjectStatus(projectStatusChange{
			From: current.Status, Requested: string(*body.Status),
			BeforeArchived: current.StatusBeforeArchived,
			Force:          body.Force != nil && *body.Force, OpenTasks: counts.Open,
		})
		if err != nil {
			return dbgen.Project{}, err
		}
		status = &next
	}
	clear := projectClearFlagsOf(body.Clear)
	updated, err := q.UpdateProject(ctx, dbgen.UpdateProjectParams{
		ID: projectID, Title: trimmedOrNil(body.Title), Description: body.Description,
		ClearDescription: clear.Description, Status: status,
		StartDate: timePtrOfDate(body.StartDate), ClearStartDate: clear.StartDate,
		TargetDate: timePtrOfDate(body.TargetDate), ClearTargetDate: clear.TargetDate,
	})
	if err != nil {
		return dbgen.Project{}, apperr.Internal(err)
	}
	return updated, nil
}

// DeleteProject 软删除 Project，并清空关联对象的 project_id。
// 关联对象本身保留：删除项目不应连带删除用户的任务与笔记。
func (s *Service) DeleteProject(ctx context.Context, userID, projectID string) (string, error) {
	var batchID string
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		replayBody, replayed, requestHash, err := beginObjectReplay(
			ctx, q, userID, "projects.delete", map[string]string{"project_id": projectID})
		if err != nil {
			return err
		}
		if replayed {
			if err := json.Unmarshal(replayBody, &batchID); err != nil {
				return apperr.Internal(err)
			}
			return nil
		}
		current, err := q.GetProjectForUpdate(ctx, projectID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("项目")
			}
			return apperr.Internal(err)
		}
		if err := q.ClearProjectFromTasks(ctx, &projectID); err != nil {
			return apperr.Internal(err)
		}
		if err := q.ClearProjectFromEvents(ctx, &projectID); err != nil {
			return apperr.Internal(err)
		}
		if err := q.ClearProjectFromNotes(ctx, &projectID); err != nil {
			return apperr.Internal(err)
		}
		if err := q.ClearProjectFromRecords(ctx, &projectID); err != nil {
			return apperr.Internal(err)
		}
		if _, err := q.SoftDeleteProject(ctx, projectID); err != nil {
			return apperr.Internal(err)
		}
		batchID, err = s.activity.Record(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action:       "deleted",
				ResourceType: "project",
				ResourceID:   projectID,
				Title:        current.Title,
				Summary:      "删除了项目",
			}})
		if err != nil {
			return err
		}
		return saveObjectReplay(ctx, q, userID, "projects.delete", requestHash, 200, batchID, batchID)
	})
	return batchID, err
}

type projectClearFlags struct {
	Description bool
	StartDate   bool
	TargetDate  bool
}

func projectClearFlagsOf(clear *[]httpapi.UpdateProjectRequestClear) projectClearFlags {
	var f projectClearFlags
	if clear == nil {
		return f
	}
	for _, item := range *clear {
		switch item {
		case httpapi.UpdateProjectRequestClearDescription:
			f.Description = true
		case httpapi.UpdateProjectRequestClearStartDate:
			f.StartDate = true
		case httpapi.UpdateProjectRequestClearTargetDate:
			f.TargetDate = true
		}
	}
	return f
}

// projectKindOr 把项目用途收敛到已知取值，未知一律当普通项目。
func projectKindOr(kind *httpapi.ProjectKind) string {
	if kind != nil && *kind == httpapi.ProjectKindTrip {
		return "trip"
	}
	return "general"
}
