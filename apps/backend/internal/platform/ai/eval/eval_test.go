package eval_test

import (
	"context"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai/eval"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/config"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
)

// 评测套件的入口。
//
//   - gate=hard 的用例直接决定构建成败。它们检验的是「模型乱来时系统怎么办」，
//     全部走脚本化 Provider，不花一分钱、不依赖网络，因此可以每次提交都跑。
//   - gate=quality 的用例只汇报，落在 -v 输出里作为基线。
//
// 没有数据库时跳过，理由与 RLS 测试一致：这套评测的价值全在真实的
// 事务、RLS 与确认路径上，用假仓库跑通不证明任何事情。

func TestEvalSuite(t *testing.T) {
	stack, ok := newStack(t)
	if !ok {
		return
	}

	dir, err := eval.DatasetDir()
	if err != nil {
		t.Fatalf("定位数据集失败：%v", err)
	}
	cases, err := eval.LoadDatasets(dir)
	if err != nil {
		t.Fatalf("加载数据集失败：%v", err)
	}
	if len(cases) == 0 {
		t.Fatal("数据集为空")
	}

	report := map[string]*tally{}
	for _, c := range cases {
		c := c
		t.Run(c.ID, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
			defer cancel()

			result, err := stack.Run(ctx, c)
			if err != nil {
				t.Fatalf("用例执行失败：%v", err)
			}
			failures := eval.Check(c, result)

			bucket := report[c.Category]
			if bucket == nil {
				bucket = &tally{}
				report[c.Category] = bucket
			}
			bucket.total++
			if len(failures) == 0 {
				bucket.passed++
				return
			}

			// 质量用例不判失败：没有基线数据时写绝对阈值只会被调到刚好通过。
			log := t.Errorf
			if c.Gate == eval.GateQuality {
				log = t.Logf
			}
			// 这一轮本身就没跑起来时，逐条断言的失败都是次生的，
			// 先把真正的原因说出来，免得看红灯的人去查一堆假线索。
			cause := ""
			if result.TurnError != nil {
				cause = "\n本轮执行出错：" + result.TurnError.Error()
			}
			log("【%s】%s\n守的规矩：%s%s\n%s",
				c.Gate, c.ID, c.Why, cause, join(failures))
		})
	}

	t.Log(format(report))
}

// TestEvalDatasetShape 检查数据集本身是否可用。
//
// 它不需要数据库：数据集写错时（缺 gate、缺 why、期望全空）应当在
// 任何环境下都立刻报错，而不是等到有库的机器上才发现。
func TestEvalDatasetShape(t *testing.T) {
	dir, err := eval.DatasetDir()
	if err != nil {
		t.Fatalf("定位数据集失败：%v", err)
	}
	cases, err := eval.LoadDatasets(dir)
	if err != nil {
		t.Fatalf("加载数据集失败：%v", err)
	}

	hard := 0
	for _, c := range cases {
		switch c.Gate {
		case eval.GateHard:
			hard++
		case eval.GateQuality:
		default:
			t.Errorf("用例 %s 的 gate 非法：%q", c.ID, c.Gate)
		}
		if c.Why == "" {
			t.Errorf("用例 %s 缺少 why：看到红灯的人需要知道破了哪条规矩", c.ID)
		}
		if c.UserText == "" {
			t.Errorf("用例 %s 缺少 user_text", c.ID)
		}
		// 期望全空的用例永远通过，等于没有这条用例。
		if eval.IsEmptyExpect(c.Expect) {
			t.Errorf("用例 %s 没有任何期望", c.ID)
		}
	}
	if hard == 0 {
		t.Error("一条硬门槛用例都没有，这套评测拦不住任何东西")
	}
	t.Logf("共 %d 条用例，其中硬门槛 %d 条", len(cases), hard)
}

func newStack(t *testing.T) (*eval.Stack, bool) {
	t.Helper()
	cfg, err := config.Load()
	if err != nil || cfg.DatabaseURL == "" {
		t.Skip("没有配置数据库，跳过评测套件")
		return nil, false
	}
	if os.Getenv("STEWARD_SKIP_EVAL") != "" {
		t.Skip("STEWARD_SKIP_EVAL 已设置")
		return nil, false
	}

	ctx := t.Context()
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Skipf("连接数据库失败，跳过评测套件：%v", err)
		return nil, false
	}
	t.Cleanup(db.Close)
	return eval.NewStack(db), true
}

type tally struct{ total, passed int }

func format(report map[string]*tally) string {
	names := make([]string, 0, len(report))
	for name := range report {
		names = append(names, name)
	}
	sort.Strings(names)

	out := "评测基线："
	for _, name := range names {
		bucket := report[name]
		out += "\n  " + name + "：" +
			itoa(bucket.passed) + "/" + itoa(bucket.total)
	}
	return out
}

func join(items []string) string {
	out := ""
	for i, item := range items {
		if i > 0 {
			out += "\n"
		}
		out += "  · " + item
	}
	return out
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}
