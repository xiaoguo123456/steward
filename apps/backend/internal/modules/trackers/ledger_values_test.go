package trackers

import (
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
)

func TestNormalizeLedgerValues(t *testing.T) {
	key := "ledger"
	for _, tc := range []struct{ input, want string }{{"收入", "income"}, {"支出", "expense"}, {" Income ", "income"}, {"expense", "expense"}} {
		t.Run(tc.input, func(t *testing.T) {
			value := tc.input
			input := []httpapi.RecordValue{{Key: "direction", TextValue: &value}}
			out, err := normalizeBuiltinValues(&key, input)
			if err != nil || *out[0].TextValue != tc.want || *input[0].TextValue != tc.input {
				t.Fatalf("收支归一化错误或修改原始输入：%v", err)
			}
		})
	}
	for _, direction := range []string{"", "转账", "未知"} {
		if _, err := normalizeBuiltinValues(&key, []httpapi.RecordValue{{Key: "direction", TextValue: &direction}}); err == nil {
			t.Fatalf("不应接受不明确的收支：%s", direction)
		}
	}
	for _, amount := range []float64{0, -1} {
		if _, err := normalizeBuiltinValues(&key, []httpapi.RecordValue{{Key: "amount", NumberValue: &amount}}); err == nil {
			t.Fatal("不应接受非正记账金额")
		}
	}
	direction := "向北"
	if _, err := normalizeBuiltinValues(nil, []httpapi.RecordValue{{Key: "direction", TextValue: &direction}}); err != nil {
		t.Fatal("不能约束自定义记录项的同名字段")
	}
}
