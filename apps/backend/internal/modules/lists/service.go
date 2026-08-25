// Package lists 拥有 TaskList。
//
// TaskList 是 Task 的轻量分类，不承担 Project 的目标、进度与风险能力。
// 每个用户恰好有一个默认清单；删除非空清单必须先指定 Task 的迁移目标。
package lists

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// DefaultListName 是初始化时创建的默认清单名称，用户可以重命名。
const DefaultListName = "默认清单"

// Service 是 TaskList 的应用服务。
type Service struct {
	db *database.DB
}

// New 构造 Service。
func New(db *database.DB) *Service {
	return &Service{db: db}
}

// DB 暴露连接以便同模块的 Handler 复用短事务。
func (s *Service) DB() *database.DB { return s.db }

// EnsureDefaultList 保证用户拥有默认清单。初始化与登录路径都可以重复调用。
//
// 它接受调用方的 Queries，因此可以和用户创建放在同一个事务里。
func (s *Service) EnsureDefaultList(ctx context.Context, q *dbgen.Queries, userID string) (dbgen.TaskList, error) {
	existing, err := q.GetDefaultTaskList(ctx)
	if err == nil {
		return existing, nil
	}
	if !database.IsNoRows(err) {
		return dbgen.TaskList{}, apperr.Internal(err)
	}

	created, err := q.CreateTaskList(ctx, dbgen.CreateTaskListParams{
		ID:        idgen.New(idgen.PrefixTaskList),
		UserID:    userID,
		Name:      DefaultListName,
		Position:  0,
		IsDefault: true,
		ListKind:  "tasks",
	})
	if err != nil {
		return dbgen.TaskList{}, apperr.Internal(err)
	}
	return created, nil
}

// ResolveListID 校验清单归属；listID 为空时返回默认清单。
// 供 Task 创建与 Capture 确认复用，保证不会把 Task 挂到别人的清单上。
func (s *Service) ResolveListID(ctx context.Context, q *dbgen.Queries, userID string, listID *string) (string, error) {
	if listID != nil && strings.TrimSpace(*listID) != "" {
		row, err := q.GetTaskList(ctx, *listID)
		if err != nil {
			if database.IsNoRows(err) {
				return "", apperr.NotFound("清单")
			}
			return "", apperr.Internal(err)
		}
		if row.ArchivedAt != nil {
			return "", apperr.Newf(apperr.CodeValidationFailed, "该清单已归档，不能接收新任务。")
		}
		return row.ID, nil
	}

	def, err := s.EnsureDefaultList(ctx, q, userID)
	if err != nil {
		return "", err
	}
	return def.ID, nil
}

// List 返回当前用户的全部清单。
func (s *Service) List(ctx context.Context, userID string, includeArchived bool,
	listKind *string) ([]dbgen.ListTaskListsRow, error) {
	var out []dbgen.ListTaskListsRow
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		// 首次访问时补齐默认清单，避免新用户看到空白页。
		if _, err := s.EnsureDefaultList(ctx, q, userID); err != nil {
			return err
		}
		if listKind != nil {
			rows, err := q.ListTaskListsByKind(ctx, dbgen.ListTaskListsByKindParams{
				IncludeArchived: includeArchived,
				ListKind:        listKindOr(*listKind),
			})
			if err != nil {
				return apperr.Internal(err)
			}
			out = make([]dbgen.ListTaskListsRow, 0, len(rows))
			for _, row := range rows {
				out = append(out, dbgen.ListTaskListsRow(row))
			}
			return nil
		}
		rows, err := q.ListTaskLists(ctx, includeArchived)
		if err != nil {
			return apperr.Internal(err)
		}
		out = rows
		return nil
	})
	return out, err
}

// Create 新建清单。
func (s *Service) Create(ctx context.Context, userID string, in CreateInput) (dbgen.TaskList, error) {
	var out dbgen.TaskList
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		created, err := s.CreateInTx(ctx, q, userID, in)
		out = created
		return err
	})
	return out, err
}

// CreateInTx 在调用方事务内新建清单。
//
// 「从食谱生成购物清单」要在同一个事务里建清单与它的全部条目：
// 建了清单却没建成条目，用户会看到一个空清单，不知道该重来还是接着填。
func (s *Service) CreateInTx(ctx context.Context, q *dbgen.Queries, userID string,
	in CreateInput) (dbgen.TaskList, error) {

	name := strings.TrimSpace(in.Name)
	if name == "" {
		return dbgen.TaskList{}, apperr.Validation(apperr.Field("name", "清单名称不能为空。"))
	}
	if listKindOr(in.ListKind) == "shopping" {
		return s.EnsureShoppingList(ctx, q, userID, ShoppingListInput{
			Name: name, Color: in.Color, Icon: in.Icon,
		})
	}

	var out dbgen.TaskList
	err := func() error {
		position := int32(0)
		if in.Position != nil {
			position = int32(*in.Position)
		} else {
			count, err := q.CountTaskLists(ctx)
			if err != nil {
				return apperr.Internal(err)
			}
			position = count
		}

		created, err := q.CreateTaskList(ctx, dbgen.CreateTaskListParams{
			ID:        idgen.New(idgen.PrefixTaskList),
			UserID:    userID,
			Name:      name,
			Color:     in.Color,
			Icon:      in.Icon,
			Position:  position,
			IsDefault: false,
			ListKind:  listKindOr(in.ListKind),
		})
		if err != nil {
			if isUniqueViolation(err) {
				return apperr.New(apperr.CodeTaskListNameDuplicated)
			}
			return apperr.Internal(err)
		}
		out = created
		return nil
	}()
	return out, err
}

// ShoppingListInput 是首次创建活动购物清单时使用的展示字段。
type ShoppingListInput struct {
	Name  string
	Color *string
	Icon  *string
}

// EnsureShoppingList 返回用户唯一的活动购物清单；不存在时创建。
// 数据库部分唯一索引负责并发下最多只有一份活动清单。
func (s *Service) EnsureShoppingList(ctx context.Context, q *dbgen.Queries,
	userID string, in ShoppingListInput) (dbgen.TaskList, error) {

	existing, err := q.GetActiveShoppingTaskList(ctx, userID)
	if err == nil {
		return existing, nil
	}
	if !database.IsNoRows(err) {
		return dbgen.TaskList{}, apperr.Internal(err)
	}

	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = "购物清单"
	}
	position, err := q.CountTaskLists(ctx)
	if err != nil {
		return dbgen.TaskList{}, apperr.Internal(err)
	}
	created, err := q.CreateShoppingTaskListIfAbsent(ctx, dbgen.CreateShoppingTaskListIfAbsentParams{
		ID:       idgen.New(idgen.PrefixTaskList),
		UserID:   userID,
		Name:     name,
		Color:    in.Color,
		Icon:     in.Icon,
		Position: position,
	})
	if err == nil {
		return created, nil
	}
	if !database.IsNoRows(err) {
		return dbgen.TaskList{}, apperr.Internal(err)
	}

	// 并发请求可能已经先创建成功；重新读取即可。
	existing, err = q.GetActiveShoppingTaskList(ctx, userID)
	if err == nil {
		return existing, nil
	}
	if database.IsNoRows(err) {
		return dbgen.TaskList{}, apperr.New(apperr.CodeTaskListNameDuplicated)
	}
	return dbgen.TaskList{}, apperr.Internal(err)
}

// Update 修改清单。
func (s *Service) Update(ctx context.Context, userID, listID string, in UpdateInput) (dbgen.GetTaskListRow, error) {
	var out dbgen.GetTaskListRow
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetTaskList(ctx, listID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("清单")
			}
			return apperr.Internal(err)
		}
		if err := in.CheckVersion(current.Version); err != nil {
			return err
		}
		// 默认清单归档后用户会失去落点，因此不允许归档。
		if current.IsDefault && in.Archived != nil && *in.Archived {
			return apperr.Newf(apperr.CodeTaskListDefaultReq, "默认清单不能归档，请先指定另一个默认清单。")
		}
		if in.Name != nil && strings.TrimSpace(*in.Name) == "" {
			return apperr.Validation(apperr.Field("name", "清单名称不能为空。"))
		}

		updated, err := q.UpdateTaskList(ctx, dbgen.UpdateTaskListParams{
			ID:         listID,
			Name:       in.Name,
			Color:      in.Color,
			ClearColor: in.ClearColor,
			Icon:       in.Icon,
			ClearIcon:  in.ClearIcon,
			Position:   in.Position,
			Archived:   in.Archived,
		})
		if err != nil {
			if isUniqueViolation(err) {
				return apperr.New(apperr.CodeTaskListNameDuplicated)
			}
			return apperr.Internal(err)
		}

		count, err := q.CountTasksInList(ctx, updated.ID)
		if err != nil {
			return apperr.Internal(err)
		}
		out = dbgen.GetTaskListRow{
			ID: updated.ID, UserID: updated.UserID, Name: updated.Name,
			Color: updated.Color, Icon: updated.Icon, Position: updated.Position,
			IsDefault: updated.IsDefault, ArchivedAt: updated.ArchivedAt,
			CreatedAt: updated.CreatedAt, UpdatedAt: updated.UpdatedAt,
			DeletedAt: updated.DeletedAt, Version: updated.Version,
			TaskCount: count,
		}
		return nil
	})
	return out, err
}

// Delete 删除清单。非空清单必须提供迁移目标。
func (s *Service) Delete(ctx context.Context, userID, listID string, moveTo *string) error {
	return s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetTaskList(ctx, listID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("清单")
			}
			return apperr.Internal(err)
		}
		if current.IsDefault {
			return apperr.Newf(apperr.CodeTaskListDefaultReq,
				"默认清单不能删除，请先把另一个清单设为默认。")
		}

		count, err := q.CountTasksInList(ctx, listID)
		if err != nil {
			return apperr.Internal(err)
		}
		if count > 0 {
			if moveTo == nil || *moveTo == "" {
				return apperr.New(apperr.CodeTaskListNotEmpty)
			}
			if *moveTo == listID {
				return apperr.Validation(apperr.Field("move_tasks_to_list_id", "不能迁移到正在删除的清单。"))
			}
			target, err := q.GetTaskList(ctx, *moveTo)
			if err != nil {
				if database.IsNoRows(err) {
					return apperr.NotFound("目标清单")
				}
				return apperr.Internal(err)
			}
			if target.ArchivedAt != nil {
				return apperr.Validation(apperr.Field("move_tasks_to_list_id", "已归档的清单不能接收任务。"))
			}
			if err := q.MoveTasksToList(ctx, dbgen.MoveTasksToListParams{
				TargetListID: target.ID,
				SourceListID: listID,
			}); err != nil {
				return apperr.Internal(err)
			}
		}

		if _, err := q.SoftDeleteTaskList(ctx, listID); err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
}

// CreateInput 是新建清单的输入。
type CreateInput struct {
	Name     string
	Color    *string
	Icon     *string
	Position *int
	// ListKind 决定移动端用哪套界面展示这个清单。
	// 它不是新的领域类型，底下仍然是同一套 TaskList 与 Task。
	ListKind string
}

// UpdateInput 是修改清单的输入。
type UpdateInput struct {
	Name       *string
	Color      *string
	ClearColor bool
	Icon       *string
	ClearIcon  bool
	Position   *int32
	Archived   *bool
	// ExpectedVersion 来自 If-Match，为空表示不做并发检查。
	ExpectedVersion *int32
}

// CheckVersion 比较期望版本与当前版本。
func (in UpdateInput) CheckVersion(current int32) error {
	if in.ExpectedVersion == nil {
		return nil
	}
	if *in.ExpectedVersion != current {
		return apperr.New(apperr.CodeVersionConflict)
	}
	return nil
}

// isUniqueViolation 判断是否命中唯一索引，例如同名未归档清单。
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

// listKindOr 把清单用途收敛到已知取值，未知一律当普通任务清单。
func listKindOr(kind string) string {
	if kind == "shopping" {
		return "shopping"
	}
	return "tasks"
}
