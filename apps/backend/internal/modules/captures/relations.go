package captures

import (
	"context"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// ConfirmedResource 是一次 Capture 确认事务中已经创建或更新成功的正式资源。
// Key 使用 Capture Candidate ID，Relation Candidate 的 from_ref/to_ref 只能通过这张表解析，
// 因而取消任一端候选时不会留下悬空关系。
type ConfirmedResource struct {
	Type string
	ID   string
}

// PersistConfirmedRelations 把当前 revision 的关系候选写成正式 Relation。
//
// 调用方必须在 Confirm 的同一事务内调用，并只把本次用户实际选择且写入成功的候选放入
// selected。缺少任一端的关系候选会被忽略；已映射端点若不存在、越权或类型不合法则整体失败。
// 唯一索引和 Upsert 共同保证不同确认事务并发写同一关系时也只保留一条正式记录。
func (s *Service) PersistConfirmedRelations(
	ctx context.Context,
	q *dbgen.Queries,
	userID string,
	candidates []dbgen.CaptureRelationCandidate,
	selected map[string]ConfirmedResource,
	provenance []byte,
) ([]dbgen.Relation, error) {
	created := make([]dbgen.Relation, 0, len(candidates))
	seen := make(map[[6]string]struct{}, len(candidates))
	for _, candidate := range candidates {
		from, fromSelected := selected[candidate.FromRef]
		to, toSelected := selected[candidate.ToRef]
		if !fromSelected {
			from, fromSelected = existingRelationResource(candidate.FromRef)
		}
		if !toSelected {
			to, toSelected = existingRelationResource(candidate.ToRef)
		}
		if !fromSelected || !toSelected {
			// 产品规则要求取消任一候选端点时关系自动消失。
			continue
		}
		if candidate.Kind != "requires" && candidate.Kind != "related_to" {
			return nil, apperr.Validation(apperr.Field("relations", "关系类型不合法。"))
		}
		if !validRelationObjectType(from.Type) || !validRelationObjectType(to.Type) {
			return nil, apperr.Validation(apperr.Field("relations", "关系端点类型不合法。"))
		}
		if strings.TrimSpace(from.ID) == "" || strings.TrimSpace(to.ID) == "" ||
			(from.Type == to.Type && from.ID == to.ID) {
			return nil, apperr.Validation(apperr.Field("relations", "关系端点不合法。"))
		}

		fromExists, err := q.RelationEndpointExists(ctx, dbgen.RelationEndpointExistsParams{
			ObjectType:       from.Type,
			RelationUserID:   userID,
			RelationObjectID: from.ID,
		})
		if err != nil {
			return nil, apperr.Internal(err)
		}
		toExists, err := q.RelationEndpointExists(ctx, dbgen.RelationEndpointExistsParams{
			ObjectType:       to.Type,
			RelationUserID:   userID,
			RelationObjectID: to.ID,
		})
		if err != nil {
			return nil, apperr.Internal(err)
		}
		if !fromExists || !toExists {
			return nil, apperr.Validation(apperr.Field(
				"relations", "关系引用的正式内容不存在或已删除。"))
		}
		identity := [6]string{userID, candidate.Kind, from.Type, from.ID, to.Type, to.ID}
		if _, exists := seen[identity]; exists {
			continue
		}
		seen[identity] = struct{}{}

		row, err := q.UpsertActiveRelation(ctx, dbgen.UpsertActiveRelationParams{
			ID:             idgen.New(idgen.PrefixRelation),
			UserID:         userID,
			Kind:           candidate.Kind,
			FromType:       from.Type,
			FromID:         from.ID,
			ToType:         to.Type,
			ToID:           to.ID,
			CreatedBy:      "ai",
			ProvenanceRefs: provenance,
		})
		if err != nil {
			return nil, apperr.Internal(err)
		}
		created = append(created, row)
	}
	return created, nil
}

func existingRelationResource(id string) (ConfirmedResource, bool) {
	prefixes := map[string]string{
		"tsk_": "task", "evt_": "event", "prj_": "project", "nte_": "note", "rec_": "record",
	}
	for prefix, objectType := range prefixes {
		if strings.HasPrefix(id, prefix) {
			return ConfirmedResource{Type: objectType, ID: id}, true
		}
	}
	return ConfirmedResource{}, false
}

func validRelationObjectType(value string) bool {
	switch value {
	case "task", "event", "project", "note", "record":
		return true
	default:
		return false
	}
}
