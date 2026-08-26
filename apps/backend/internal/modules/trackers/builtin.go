package trackers

import (
	"context"
	"encoding/json"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/timeutil"
)

// 内置记录项。
//
// 运动、专注与记账三个生活场景需要固定的字段结构才能渲染专用界面。
// 它们不是新的领域类型：底下就是普通的 Tracker 与 Record，
// 打卡首页不会重复展示它们，但复盘与统计仍读取同一份 Record。
//
// 按需创建：用户第一次进这个场景时才建。注册时就造三个他可能永远
// 不用的记录项，只会让打卡页一上来就是三个空壳。

// BuiltinKey 是内置记录项的稳定标识。
type BuiltinKey = string

// 内置记录项取值。
const (
	BuiltinWorkout BuiltinKey = "workout"
	BuiltinFocus   BuiltinKey = "focus"
	BuiltinLedger  BuiltinKey = "ledger"
)

// builtinSpec 是一个内置记录项的定义。
type builtinSpec struct {
	Name        string
	Description string
	Color       string
	Icon        string
	Fields      []httpapi.TrackerField
}

func field(key, label string, kind httpapi.TrackerFieldType, required bool, unit string) httpapi.TrackerField {
	f := httpapi.TrackerField{Key: key, Label: label, Type: kind, Required: required}
	if unit != "" {
		f.Unit = &unit
	}
	return f
}

// builtinSpecs 是三个内置记录项的字段定义。
//
// 字段一旦发布就不能随意改 key：已有记录的 values 是按 key 存的，
// 改名会让历史记录读不出来。要加字段只能追加，且必须是可选。
var builtinSpecs = map[BuiltinKey]builtinSpec{
	BuiltinWorkout: {
		Name:        "运动",
		Description: "跑步、健走、骑行与力量训练的记录。",
		Color:       "green",
		Icon:        "walk-outline",
		// 时长排在方式前面：记录标题取第一个有值的字段，
		// 而 mode 存的是 running 这样的稳定英文值，直接出现在标题里
		// 用户看着莫名其妙。展示用的中文标签由客户端映射。
		Fields: []httpapi.TrackerField{
			field("duration_min", "时长", httpapi.TrackerFieldTypeDuration, true, "分钟"),
			field("mode", "运动方式", httpapi.TrackerFieldTypeText, true, ""),
			field("distance_km", "距离", httpapi.TrackerFieldTypeNumber, false, "公里"),
			// 只为兼容已经保存过的旧健走记录；新运动流程不再展示或写入步数。
			field("steps", "步数", httpapi.TrackerFieldTypeNumber, false, "步"),
			field("calories", "消耗", httpapi.TrackerFieldTypeNumber, false, "千卡"),
		},
	},
	BuiltinFocus: {
		Name:        "专注",
		Description: "番茄钟与正向计时的专注记录。",
		Color:       "purple",
		Icon:        "timer-outline",
		Fields: []httpapi.TrackerField{
			field("duration_min", "专注时长", httpapi.TrackerFieldTypeDuration, true, "分钟"),
			field("mode", "计时方式", httpapi.TrackerFieldTypeText, true, ""),
			// 关联任务只存标题：Record 不是 Task 的副本，
			// 任务本身的状态仍然由 Task 管。
			field("task_title", "关联任务", httpapi.TrackerFieldTypeText, false, ""),
			field("quality", "专注状态", httpapi.TrackerFieldTypeText, false, ""),
		},
	},
	BuiltinLedger: {
		Name:        "记账",
		Description: "日常收支记录。",
		Color:       "blue",
		Icon:        "wallet-outline",
		Fields: []httpapi.TrackerField{
			field("amount", "金额", httpapi.TrackerFieldTypeCurrency, true, "元"),
			// 收支方向单独一个字段，不用金额正负表达：
			// 负数金额在统计和展示里都容易被读错。
			field("direction", "收支", httpapi.TrackerFieldTypeText, true, ""),
			field("category", "分类", httpapi.TrackerFieldTypeText, true, ""),
			field("merchant", "商家", httpapi.TrackerFieldTypeText, false, ""),
			field("payment_method", "支付方式", httpapi.TrackerFieldTypeText, false, ""),
		},
	},
}

// IsBuiltinKey 判断是否为已知的内置标识。
func IsBuiltinKey(key string) bool {
	_, ok := builtinSpecs[key]
	return ok
}

// EnsureBuiltin 按需创建内置记录项并返回它。
//
// 已存在时直接返回现有的那个：用户可能已经改过名字或颜色，
// 不能拿定义覆盖回去。
func (s *Service) EnsureBuiltin(ctx context.Context, userID string, key BuiltinKey) (TrackerWithStats, error) {
	spec, ok := builtinSpecs[key]
	if !ok {
		return TrackerWithStats{}, apperr.Validation(
			apperr.Field("builtin_key", "不认识这个内置记录项。"))
	}

	var out TrackerWithStats
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		tz, err := s.users.Timezone(ctx, q, userID)
		if err != nil {
			return err
		}
		now := time.Now()
		loc := timeutil.LoadLocation(tz)
		existing, err := q.ListTrackers(ctx, dbgen.ListTrackersParams{BuiltinKey: &key})
		if err != nil {
			return apperr.Internal(err)
		}
		if len(existing) > 0 {
			stats, err := loadStats(ctx, q, timeutil.DayOf(now, loc))
			if err != nil {
				return err
			}
			rowStats := stats[existing[0].ID]
			out = TrackerWithStats{
				Row: existing[0], Stats: rowStats,
				DueToday: trackerDueToday(existing[0], rowStats, now, loc),
			}
			return nil
		}

		fieldsJSON, err := json.Marshal(spec.Fields)
		if err != nil {
			return apperr.Internal(err)
		}
		created, err := q.EnsureBuiltinTracker(ctx, dbgen.EnsureBuiltinTrackerParams{
			ID:          idgen.New(idgen.PrefixTracker),
			UserID:      userID,
			Name:        spec.Name,
			Description: &spec.Description,
			Fields:      fieldsJSON,
			Color:       &spec.Color,
			Icon:        &spec.Icon,
			BuiltinKey:  &key,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = TrackerWithStats{Row: created, DueToday: false}
		return nil
	})
	return out, err
}
