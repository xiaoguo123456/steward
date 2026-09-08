package trackers

import (
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

// normalizeBuiltinValues 统一内置账本的收支值，避免中文值导致统计漏算。
// 自定义记录项的同名字段不受影响；未知方向和非正金额不能直接入账。
func normalizeBuiltinValues(key *string, values []httpapi.RecordValue) ([]httpapi.RecordValue, error) {
	if key == nil || *key != string(BuiltinLedger) {
		return values, nil
	}
	out := append([]httpapi.RecordValue(nil), values...)
	for i, value := range out {
		switch value.Key {
		case "amount":
			if value.NumberValue == nil || *value.NumberValue <= 0 {
				return nil, apperr.Newf(apperr.CodeRecordValuesInvalid, "记账金额必须大于 0。")
			}
		case "direction":
			direction := ""
			if value.TextValue != nil {
				direction = strings.ToLower(strings.TrimSpace(*value.TextValue))
			}
			switch direction {
			case "income", "收入":
				direction = "income"
			case "expense", "支出":
				direction = "expense"
			default:
				return nil, apperr.Newf(apperr.CodeRecordValuesInvalid, "请选择收入或支出。")
			}
			out[i].TextValue = &direction
		}
	}
	return out, nil
}
