// Package memory 拥有长期语义记忆：Memory Item、Evidence、Revision 与 Relearn Block。
//
// 三条硬规则：
//  1. 不允许静默把一次行为升级成长期记忆——只有用户确认过的条目才是 active。
//  2. 每条记忆至少有一条来源；用户据此判断系统为什么记住它。
//  3. 删除后立即从检索与 Prompt 上下文中排除；选择阻止重新学习时只存指纹，不存明文。
package memory

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/assistant"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

// FingerprintKeyVersion 随指纹密钥轮换递增，写入 Relearn Block 便于后续重算。
const FingerprintKeyVersion = "v1"

// 检索时允许进入 Prompt 的敏感级别。
//
// 高敏记忆默认不参与检索，只有当前功能确实需要且用户设置允许时才单独精确读取。
var retrievableSensitivity = []string{"normal"}

// Service 是长期记忆的应用服务。
type Service struct {
	db *database.DB
	// fingerprintKey 用于计算 Relearn Block 指纹。
	// 它是独立用途的密钥，不复用签名或加密密钥。
	fingerprintKey []byte
}

// New 构造 Service。
func New(db *database.DB, fingerprintKey []byte) *Service {
	return &Service{db: db, fingerprintKey: fingerprintKey}
}

// ---- 检索 ----

// Search 检索可用于本轮上下文的记忆。
//
// 先做确定性过滤（用户、状态、敏感级别、有效期），再按显式程度与
// 最近使用时间排序。返回条数有限，不返回用户完整记忆库。
func (s *Service) Search(ctx context.Context, userID, query string, limit int32) ([]assistant.MemoryFact, error) {
	facts, _, err := s.SearchWithStats(ctx, userID, query, limit)
	return facts, err
}

// SearchWithStats 与 Search 相同，另外返回这次检索的可观测信息。
func (s *Service) SearchWithStats(ctx context.Context, userID, query string,
	limit int32) ([]assistant.MemoryFact, assistant.MemoryRetrievalStats, error) {

	if limit <= 0 || limit > 20 {
		limit = 10
	}
	keyword := keywordOrNil(query)

	var (
		out   []assistant.MemoryFact
		stats = assistant.MemoryRetrievalStats{Keyword: keyword != nil}
	)
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.SearchMemories(ctx, dbgen.SearchMemoriesParams{
			AllowedSensitivity: retrievableSensitivity,
			Query:              keyword,
			RowLimit:           limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		ids := make([]string, 0, len(rows))
		for _, row := range rows {
			out = append(out, assistant.MemoryFact{ID: row.ID, Text: row.CanonicalText})
			ids = append(ids, row.ID)
		}
		stats.Hits = len(ids)

		if len(ids) > 0 {
			// 只记录使用时间用于排序；被模型引用不提高这条记忆的可信度。
			if err := q.TouchMemoryUsed(ctx, ids); err != nil {
				return apperr.Internal(err)
			}
			return nil
		}

		// 只在没命中时才数一次：这条统计每轮都跑没有意义，
		// 而没命中本身就不常见。
		available, err := q.CountRetrievableMemories(ctx, retrievableSensitivity)
		if err != nil {
			return apperr.Internal(err)
		}
		stats.Available = int(available)
		return nil
	})
	return out, stats, err
}

// keywordOrNil 把查询语句退化成关键词。
//
// 整句用户输入直接做 ILIKE 几乎不可能命中，这时宁可不过滤、
// 让排序决定顺序，也好过返回空结果让上下文里一条记忆都没有。
func keywordOrNil(query string) *string {
	q := strings.TrimSpace(query)
	if q == "" || len([]rune(q)) > 12 {
		return nil
	}
	return &q
}

// ---- 写入 ----

// UpsertInTx 在调用方的事务内写入或更新一条记忆。
//
// 只由 Action Proposal 的确认事务调用：用户点了确认才走到这里。
func (s *Service) UpsertInTx(ctx context.Context, q *dbgen.Queries,
	userID string, cmd assistant.MemoryUpsertCommand) (string, error) {

	key := strings.TrimSpace(cmd.Key)
	text := strings.TrimSpace(cmd.Text)
	if key == "" || text == "" {
		return "", apperr.Validation(apperr.Field("text", "记忆内容不完整。"))
	}

	// 这条路径写出来的记忆一律是 learned（见下面的 Origin），
	// 而高于 normal 的敏感级别只能由用户自己显式选择。
	// 能力层已经挡过一次，这里再挡一次：它是最后一道，越权到这里就该炸。
	if cmd.Sensitivity != "" && cmd.Sensitivity != "normal" {
		return "", apperr.Validation(apperr.Field("sensitivity",
			"敏感信息只能由你自己添加，助理不能替你记。"))
	}

	// 用户此前选择过"不再学这个"，就不能靠换一种说法绕回来。
	blocked, err := q.IsRelearnBlocked(ctx, dbgen.IsRelearnBlockedParams{
		MemoryKey:        key,
		ValueFingerprint: s.fingerprint(key, text),
	})
	if err != nil {
		return "", apperr.Internal(err)
	}
	if blocked {
		return "", apperr.New(apperr.CodeMemoryRelearnBlocked)
	}

	value, err := json.Marshal(map[string]any{"text": text})
	if err != nil {
		return "", apperr.Internal(err)
	}

	// 同一语义键上已有 active 记忆时，更新它并留一条 Revision，
	// 而不是并列两条互相矛盾的偏好。
	if existing, err := q.GetActiveMemoryByKey(ctx, key); err == nil {
		updated, err := q.UpdateMemoryValue(ctx, dbgen.UpdateMemoryValueParams{
			Value: value, CanonicalText: text, ID: existing.ID,
		})
		if err != nil {
			return "", apperr.Internal(err)
		}
		if err := s.recordRevision(ctx, q, userID, updated, "edit", cmd.ProposalID); err != nil {
			return "", err
		}
		if err := s.recordEvidence(ctx, q, userID, updated, cmd.SourceRefs); err != nil {
			return "", err
		}
		return updated.ID, nil
	} else if !database.IsNoRows(err) {
		return "", apperr.Internal(err)
	}

	created, err := q.CreateMemory(ctx, dbgen.CreateMemoryParams{
		ID:            idgen.New(idgen.PrefixMemory),
		UserID:        userID,
		MemoryKey:     key,
		MemoryType:    memoryTypeOr(cmd.Type),
		Value:         value,
		CanonicalText: text,
		Sensitivity:   sensitivityOr(cmd.Sensitivity),
		// 经用户确认才到这里，但内容本身是从对话中学到的。
		Origin: "learned",
	})
	if err != nil {
		return "", apperr.Internal(err)
	}
	if err := s.recordRevision(ctx, q, userID, created, "create", cmd.ProposalID); err != nil {
		return "", err
	}
	if err := s.recordEvidence(ctx, q, userID, created, cmd.SourceRefs); err != nil {
		return "", err
	}
	return created.ID, nil
}

func (s *Service) recordRevision(ctx context.Context, q *dbgen.Queries, userID string,
	item dbgen.MemoryItem, kind, proposalID string) error {

	// 经建议确认的改动记为 assistant_proposal，用户在设置页直接改的记为 user。
	// 两者都是用户点过确认的，但来源不同，审计时需要分得开。
	changedBy := "user"
	if proposalID != "" {
		changedBy = "assistant_proposal"
	}
	if err := q.CreateMemoryRevision(ctx, dbgen.CreateMemoryRevisionParams{
		ID:            idgen.New(idgen.PrefixMemoryRevision),
		UserID:        userID,
		MemoryID:      item.ID,
		Revision:      item.Version,
		Value:         item.Value,
		CanonicalText: &item.CanonicalText,
		ChangeKind:    kind,
		ChangedBy:     changedBy,
		ProposalID:    nilIfEmpty(proposalID),
	}); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

// recordEvidence 保存这条记忆的来源引用。
//
// 只存引用不存原文：来源被删除后显示 tombstone，不把已删除的内容
// 通过记忆表复制留存。
func (s *Service) recordEvidence(ctx context.Context, q *dbgen.Queries, userID string,
	item dbgen.MemoryItem, sourceRefs []string) error {

	for _, ref := range sourceRefs {
		sourceType, sourceID, ok := splitRef(ref)
		if !ok {
			continue
		}
		if err := q.CreateMemoryEvidence(ctx, dbgen.CreateMemoryEvidenceParams{
			ID:            idgen.New(idgen.PrefixMemoryEvidence),
			UserID:        userID,
			MemoryID:      item.ID,
			MemoryVersion: item.Version,
			SourceType:    sourceType,
			SourceID:      sourceID,
			// 走到这里说明用户在确认页采纳了它。
			EvidenceRole: "user_confirmed",
		}); err != nil {
			return apperr.Internal(err)
		}
	}
	return nil
}

// ---- 管理 ----

// Item 是记忆与其来源的组合。
type Item struct {
	Row      dbgen.MemoryItem
	Evidence []dbgen.MemoryEvidence
}

// List 读取记忆列表。不传状态时只返回生效中的记忆。
func (s *Service) List(ctx context.Context, userID string, memoryType *string,
	statuses []string, limit int32) ([]Item, error) {

	if len(statuses) == 0 {
		statuses = []string{"active"}
	}
	var out []Item
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListMemories(ctx, dbgen.ListMemoriesParams{
			Statuses: statuses, MemoryType: memoryType, RowLimit: limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		for _, row := range rows {
			evidence, err := q.ListMemoryEvidence(ctx, row.ID)
			if err != nil {
				return apperr.Internal(err)
			}
			out = append(out, Item{Row: row, Evidence: evidence})
		}
		return nil
	})
	return out, err
}

// Get 读取单条记忆及其来源。
func (s *Service) Get(ctx context.Context, userID, memoryID string) (Item, error) {
	var out Item
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetMemory(ctx, memoryID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这条记忆")
			}
			return apperr.Internal(err)
		}
		evidence, err := q.ListMemoryEvidence(ctx, memoryID)
		if err != nil {
			return apperr.Internal(err)
		}
		out = Item{Row: row, Evidence: evidence}
		return nil
	})
	return out, err
}

// Update 修改已确认的记忆，并创建新的 Revision。
func (s *Service) Update(ctx context.Context, userID, memoryID, canonicalText string,
	expectedVersion *int32) (Item, error) {

	text := strings.TrimSpace(canonicalText)
	if text == "" {
		return Item{}, apperr.Validation(apperr.Field("canonical_text", "内容不能为空。"))
	}

	var out Item
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetMemory(ctx, memoryID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这条记忆")
			}
			return apperr.Internal(err)
		}
		if expectedVersion != nil && current.Version != *expectedVersion {
			return apperr.New(apperr.CodeVersionConflict)
		}
		if current.Status != "active" {
			return apperr.Newf(apperr.CodeValidationFailed, "这条记忆已经失效，不能修改。")
		}

		value, err := json.Marshal(map[string]any{"text": text})
		if err != nil {
			return apperr.Internal(err)
		}
		updated, err := q.UpdateMemoryValue(ctx, dbgen.UpdateMemoryValueParams{
			Value: value, CanonicalText: text, ID: memoryID,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		if err := s.recordRevision(ctx, q, userID, updated, "edit", ""); err != nil {
			return err
		}
		// 用户亲手改过之后，这条记忆的来源就是用户本人。
		if err := q.CreateMemoryEvidence(ctx, dbgen.CreateMemoryEvidenceParams{
			ID:            idgen.New(idgen.PrefixMemoryEvidence),
			UserID:        userID,
			MemoryID:      memoryID,
			MemoryVersion: updated.Version,
			SourceType:    "user_setting",
			SourceID:      memoryID,
			EvidenceRole:  "explicit",
		}); err != nil {
			return apperr.Internal(err)
		}

		evidence, err := q.ListMemoryEvidence(ctx, memoryID)
		if err != nil {
			return apperr.Internal(err)
		}
		out = Item{Row: updated, Evidence: evidence}
		return nil
	})
	return out, err
}

// DeleteResult 是删除记忆的结果。
type DeleteResult struct {
	Recoverable       bool
	BlockedRelearning bool
}

// Delete 删除记忆。
//
// 删除后立即从检索与 Prompt 上下文中排除。选择阻止重新学习时写入
// Relearn Block —— 只保存指纹，不保存明文，因此它也不能用来恢复原值。
func (s *Service) Delete(ctx context.Context, userID, memoryID string, blockRelearning bool) (DeleteResult, error) {
	var out DeleteResult
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetMemory(ctx, memoryID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这条记忆")
			}
			return apperr.Internal(err)
		}
		deleted, err := q.DeleteMemory(ctx, memoryID)
		if err != nil {
			return apperr.Internal(err)
		}
		if err := s.recordRevision(ctx, q, userID, deleted, "delete", ""); err != nil {
			return err
		}

		if blockRelearning {
			if err := q.CreateRelearnBlock(ctx, dbgen.CreateRelearnBlockParams{
				ID:               idgen.New(idgen.PrefixRelearnBlock),
				UserID:           userID,
				MemoryKey:        current.MemoryKey,
				ValueFingerprint: s.fingerprint(current.MemoryKey, current.CanonicalText),
			}); err != nil {
				return apperr.Internal(err)
			}
			out.BlockedRelearning = true
		}
		// 高敏记忆不提供恢复入口，避免删除只是表面生效。
		out.Recoverable = current.Sensitivity == "normal"
		return nil
	})
	return out, err
}

// ListRelearnBlocks 读取已禁止重新学习的项目。只返回语义键与时间。
func (s *Service) ListRelearnBlocks(ctx context.Context, userID string) ([]dbgen.MemoryRelearnBlock, error) {
	var out []dbgen.MemoryRelearnBlock
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListRelearnBlocks(ctx, 100)
		if err != nil {
			return apperr.Internal(err)
		}
		out = rows
		return nil
	})
	return out, err
}

// DeleteRelearnBlock 解除重新学习阻止。
func (s *Service) DeleteRelearnBlock(ctx context.Context, userID, blockID string) error {
	return s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.DeleteRelearnBlock(ctx, blockID); err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("这条阻止记录")
			}
			return apperr.Internal(err)
		}
		return nil
	})
}

// ---- 指纹 ----

// fingerprint 计算 Relearn Block 的指纹。
//
// 基于「语义键 + 规范化文本」而不是原句哈希：否则用户换一种说法
// 就能绕过阻止，等于没有阻止。规范化只做去空白与大小写折叠，
// 更强的语义归一化留给后续版本，届时递增 FingerprintKeyVersion。
func (s *Service) fingerprint(key, text string) []byte {
	mac := hmac.New(sha256.New, s.fingerprintKey)
	mac.Write([]byte(FingerprintKeyVersion))
	mac.Write([]byte{0})
	mac.Write([]byte(normalize(key)))
	mac.Write([]byte{0})
	mac.Write([]byte(normalize(text)))
	return mac.Sum(nil)
}

func normalize(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

// ---- 辅助 ----

// memoryTypeOr 把模型给的类型收敛到契约枚举。
// 未知类型一律落到 personal_context，不新增自由文本类型。
func memoryTypeOr(v string) string {
	switch v {
	case "communication_preference", "routine_preference",
		"domain_preference", "personal_context", "constraint":
		return v
	default:
		return "personal_context"
	}
}

// sensitivityOr 只接受契约里的级别，未知值按普通处理。
//
// 它只做取值收敛，不判断谁有资格用哪一级：那条规则在 UpsertInTx 里，
// 因为只有那里知道这次写入的来源是不是 learned。
func sensitivityOr(v string) string {
	switch v {
	case "sensitive", "highly_sensitive":
		return v
	default:
		return "normal"
	}
}

// splitRef 把 "task:tsk_xxx" 拆成来源类型与 ID。
func splitRef(ref string) (string, string, bool) {
	parts := strings.SplitN(ref, ":", 2)
	if len(parts) != 2 || parts[1] == "" {
		return "", "", false
	}
	switch parts[0] {
	case "task", "event", "note", "project":
		return "object", parts[1], true
	case "record", "tracker":
		return "record", parts[1], true
	case "message":
		return "user_message", parts[1], true
	default:
		return "", "", false
	}
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
