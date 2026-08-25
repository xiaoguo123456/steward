package objects

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// AddOrMergeShoppingTaskInTx 把商品加入活动购物清单。
// 同名未完成商品只合并份量和来源，避免从多份食谱反复生成重复行。
func (s *Service) AddOrMergeShoppingTaskInTx(ctx context.Context, q *dbgen.Queries,
	userID, listID, title, quantity string, recipeIDs []string) (dbgen.Task, error) {

	title = strings.TrimSpace(title)
	if title == "" {
		return dbgen.Task{}, apperr.Validation(apperr.Field("title", "商品名称不能为空。"))
	}
	category := string(ClassifyShoppingItem(title))
	provenance := recipeProvenance(recipeIDs)

	existing, err := q.FindOpenShoppingTaskByTitle(ctx, dbgen.FindOpenShoppingTaskByTitleParams{
		ListID: listID,
		Title:  title,
	})
	if err == nil {
		mergedProvenance, mergeErr := mergeProvenance(existing.ProvenanceRefs, provenance)
		if mergeErr != nil {
			return dbgen.Task{}, mergeErr
		}
		mergedQuantity := mergeQuantity(existing.QuantityText, quantity)
		updated, updateErr := q.UpdateShoppingTaskDetails(ctx, dbgen.UpdateShoppingTaskDetailsParams{
			ID:               existing.ID,
			QuantityText:     mergedQuantity,
			ShoppingCategory: &category,
			ProvenanceRefs:   mergedProvenance,
		})
		if updateErr != nil {
			return dbgen.Task{}, apperr.Internal(updateErr)
		}
		return updated, nil
	}
	if !database.IsNoRows(err) {
		return dbgen.Task{}, apperr.Internal(err)
	}

	provenanceJSON, err := json.Marshal(provenance)
	if err != nil {
		return dbgen.Task{}, apperr.Internal(err)
	}
	created, err := q.CreateTask(ctx, dbgen.CreateTaskParams{
		ID:               idgen.New(idgen.PrefixTask),
		UserID:           userID,
		Title:            title,
		Status:           "todo",
		Priority:         "normal",
		ListID:           listID,
		Reminders:        emptyJSONArray,
		QuantityText:     trimmedOrNil(&quantity),
		ShoppingCategory: &category,
		CreatedBy:        "user",
		ProvenanceRefs:   provenanceJSON,
	})
	if err != nil {
		return dbgen.Task{}, apperr.Internal(err)
	}
	return created, nil
}

func recipeProvenance(recipeIDs []string) []ProvenanceInput {
	refs := make([]ProvenanceInput, 0, len(recipeIDs))
	seen := map[string]struct{}{}
	for _, recipeID := range recipeIDs {
		recipeID = strings.TrimSpace(recipeID)
		if recipeID == "" {
			continue
		}
		if _, exists := seen[recipeID]; exists {
			continue
		}
		seen[recipeID] = struct{}{}
		refs = append(refs, ProvenanceInput{
			SourceType: "object", SourceID: recipeID, Action: "created_from",
		})
	}
	return refs
}

func mergeQuantity(existing *string, incoming string) *string {
	parts := make([]string, 0, 4)
	seen := map[string]struct{}{}
	appendParts := func(value string) {
		for _, part := range strings.Split(value, " + ") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			if _, exists := seen[part]; exists {
				continue
			}
			seen[part] = struct{}{}
			parts = append(parts, part)
		}
	}
	if existing != nil {
		appendParts(*existing)
	}
	appendParts(incoming)
	if len(parts) == 0 {
		return nil
	}
	value := strings.Join(parts, " + ")
	return &value
}

func mergeProvenance(raw []byte, incoming []ProvenanceInput) ([]byte, error) {
	var existing []ProvenanceInput
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &existing)
	}
	seen := map[string]struct{}{}
	for _, ref := range existing {
		seen[ref.SourceType+"\x00"+ref.SourceID+"\x00"+ref.Action] = struct{}{}
	}
	for _, ref := range incoming {
		key := ref.SourceType + "\x00" + ref.SourceID + "\x00" + ref.Action
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		existing = append(existing, ref)
	}
	out, err := json.Marshal(existing)
	if err != nil {
		return nil, apperr.Internal(err)
	}
	return out, nil
}
