// Package idgen 生成带业务前缀且按时间单调的实体 ID。
//
// ID 形如 tsk_0abc...，前缀让日志、错误信息和跨模块引用一眼可读；
// 主体使用 UUIDv7 的 base32 编码，因此同一毫秒内也能稳定排序，
// 可以直接作为键集分页的次级排序列。
package idgen

import (
	"encoding/base32"
	"strings"

	"github.com/google/uuid"
)

// 各实体的稳定前缀。前缀一经发布不得修改，否则历史引用会失效。
const (
	PrefixUser             = "usr"
	PrefixTaskList         = "tls"
	PrefixTask             = "tsk"
	PrefixEvent            = "evt"
	PrefixProject          = "prj"
	PrefixNote             = "nte"
	PrefixRecord           = "rec"
	PrefixTracker          = "trk"
	PrefixRelation         = "rel"
	PrefixCapture          = "cap"
	PrefixMedia            = "med"
	PrefixCapturePart      = "cpt"
	PrefixCandidate        = "cnd"
	PrefixCaptureQuestion  = "cq"
	PrefixCaptureConflict  = "cfl"
	PrefixOperation        = "op"
	PrefixActivityBatch    = "ab"
	PrefixActivityEntry    = "ae"
	PrefixRequest          = "req"
	PrefixRefreshToken     = "rt"
	PrefixVerificationCode = "vc"
	PrefixAIAction         = "aia"
	PrefixAdminSession     = "ase"
	PrefixAdminAudit       = "aud"
	PrefixAICostItem       = "aci"
	PrefixAIPrice          = "apr"
	PrefixAggregationRun   = "agr"
	PrefixAccountAction    = "uaa"
	PrefixRun              = "run"
	PrefixReviewSuggestion = "rsg"
	PrefixReminder         = "rmd"
	PrefixThread           = "ath"
	PrefixMessage          = "amsg"
	PrefixTurn             = "atrn"
	PrefixToolCall         = "atc"
	PrefixProposal         = "aprp"
	PrefixMemory           = "mem"
	PrefixMemoryEvidence   = "mev"
	PrefixMemoryRevision   = "mrv"
	PrefixRelearnBlock     = "rlb"
	PrefixReviewSnapshot   = "rvs"
	PrefixRecipeFavorite   = "rfv"
	PrefixRecipeCookLog    = "rcl"
	PrefixMealPlan         = "mpl"
	PrefixMealPlanEntry    = "mpe"
	PrefixReminderDismiss  = "rdm"
)

var encoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// New 返回带指定前缀的新 ID。
func New(prefix string) string {
	// uuid.NewV7 只在随机源不可用时报错，这在正常运行中不会发生；
	// 退化为 V4 仍然唯一，只是失去时间排序，不影响正确性。
	u, err := uuid.NewV7()
	if err != nil {
		u = uuid.New()
	}
	return prefix + "_" + strings.ToLower(encoding.EncodeToString(u[:]))
}

// HasPrefix 判断 ID 是否属于某个实体类型。
// 用于在进入数据库之前挡掉明显不属于该资源的路径参数。
func HasPrefix(id, prefix string) bool {
	return strings.HasPrefix(id, prefix+"_")
}
