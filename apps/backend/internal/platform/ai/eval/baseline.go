package eval

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// 质量基线。
//
// 硬门槛用例自己就会判失败，不需要基线。基线守的是**质量用例**：
// 它们没有绝对阈值可写（写了只会被调到刚好通过），但「这次比上次差了」
// 是可以判定的。所以规则只有一条——
//
//	上次过、这次不过，就是退化，构建失败。
//
// 基线文件提交进仓库，因此这条判定在每个人的机器和 CI 上都成立。
// 只存在某台机器上的基线守不住任何东西。

// BaselineFile 是基线在数据集目录下的文件名。
const BaselineFile = "baseline.json"

// Baseline 是上一次固化下来的结果。
type Baseline struct {
	// Note 只写给人看，说明这个文件是什么、怎么更新。
	Note string `json:"note"`
	// Cases 是用例 ID 到 "pass" / "fail" 的映射。
	//
	// 只存每条用例的结果，不存分类统计：统计能从这里算出来，
	// 存两份迟早会对不上。
	Cases map[string]string `json:"cases"`
}

const (
	outcomePass = "pass"
	outcomeFail = "fail"
)

// Outcome 把一次运行的结果转成基线里的取值。
func Outcome(passed bool) string {
	if passed {
		return outcomePass
	}
	return outcomeFail
}

// LoadBaseline 读取基线。文件不存在时返回空基线，不报错——
// 第一次引入评测的人不该先被一个缺文件挡住。
func LoadBaseline(dir string) (Baseline, error) {
	raw, err := os.ReadFile(filepath.Join(dir, BaselineFile))
	if os.IsNotExist(err) {
		return Baseline{Cases: map[string]string{}}, nil
	}
	if err != nil {
		return Baseline{}, err
	}
	var out Baseline
	if err := json.Unmarshal(raw, &out); err != nil {
		return Baseline{}, fmt.Errorf("%s 解析失败：%w", BaselineFile, err)
	}
	if out.Cases == nil {
		out.Cases = map[string]string{}
	}
	return out, nil
}

// SaveBaseline 写回基线。
//
// 只在显式要求时调用（见 make eval-update）。**绝不能在普通测试里自动写**：
// 那样一次退化会把自己写成新基线，下一次运行就再也发现不了。
func SaveBaseline(dir string, results map[string]string) error {
	baseline := Baseline{
		Note: "AI 评测的质量基线，由 `make eval-update` 生成，不要手工改。" +
			"上次 pass 这次 fail 即为退化，评测会失败。",
		Cases: results,
	}
	raw, err := json.MarshalIndent(baseline, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, BaselineFile), append(raw, '\n'), 0o644)
}

// Drift 是本次结果与基线的差异。
type Drift struct {
	// Regressed 是上次过、这次不过的用例。它决定构建成败。
	Regressed []string
	// Improved 是上次不过、这次过的用例。固化它才能防住再次退化。
	Improved []string
	// Added 是基线里没有的新用例。
	Added []string
	// Removed 是基线里有、数据集里已经没有的用例。
	Removed []string
}

// CompareBaseline 比对本次结果与基线。
func CompareBaseline(baseline Baseline, results map[string]string) Drift {
	var drift Drift

	for id, now := range results {
		before, known := baseline.Cases[id]
		switch {
		case !known:
			drift.Added = append(drift.Added, id)
		case before == outcomePass && now == outcomeFail:
			drift.Regressed = append(drift.Regressed, id)
		case before == outcomeFail && now == outcomePass:
			drift.Improved = append(drift.Improved, id)
		}
	}
	for id := range baseline.Cases {
		if _, still := results[id]; !still {
			drift.Removed = append(drift.Removed, id)
		}
	}

	// 排序让报告在不同机器上一致，diff 才有意义。
	sort.Strings(drift.Regressed)
	sort.Strings(drift.Improved)
	sort.Strings(drift.Added)
	sort.Strings(drift.Removed)
	return drift
}

// Clean 表示本次结果与基线完全一致。
func (d Drift) Clean() bool {
	return len(d.Regressed) == 0 && len(d.Improved) == 0 &&
		len(d.Added) == 0 && len(d.Removed) == 0
}
