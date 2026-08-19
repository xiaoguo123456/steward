// Package eval 执行 AI 契约里的评测数据集。
//
// 它分两类对待用例（开发指南 23.9）：
//
//   - gate=hard 的结构性门槛**立即生效**：越权调用、跨用户访问、无来源结论、
//     绕过确认直接写库、敏感信息自动推断，任意一条不通过就是测试失败。
//   - gate=quality 的业务准确率只算基线并与上一版比对，不在没有数据时
//     拍脑袋写绝对阈值。
//
// 硬门槛用例不需要真实模型：它们检验的是「模型乱来时系统怎么办」，
// 而那部分完全是确定性的。因此这套用例可以在 CI 里无成本地跑，
// 也正因为如此，它才守得住——需要花钱调模型的检查最后都不会有人跑。
package eval

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Gate 是用例的门槛级别。
type Gate string

// 门槛级别取值。
const (
	// GateHard 是结构性错误，不通过即测试失败。
	GateHard Gate = "hard"
	// GateQuality 是业务准确率，只计入基线报告。
	GateQuality Gate = "quality"
)

// Case 是一条评测用例。
type Case struct {
	ID       string `json:"id"`
	Category string `json:"category"`
	Gate     Gate   `json:"gate"`
	// Why 说明这条用例守的是什么。它会出现在失败信息里，
	// 让看到红灯的人立刻知道破了哪条规矩。
	Why      string `json:"why"`
	UserText string `json:"user_text"`

	// Fixtures 是这条用例需要预先准备的数据。
	Fixtures Fixtures `json:"fixtures"`
	// Settings 覆盖用户的 AI 开关。
	Settings *Settings `json:"settings"`

	// Script 是被脚本化的模型行为：第 N 个元素是第 N 轮的返回。
	//
	// 用脚本而不是真实模型，是为了精确复现「模型试图越权」「模型编造来源」
	// 这类场景——那些行为不能靠祈祷真实模型正好这么做。
	Script []ScriptStep `json:"script"`

	// ConfirmFirstProposal 为 true 时在这一轮之后确认第一条建议，
	// 用于检验确认事务本身。
	ConfirmFirstProposal bool `json:"confirm_first_proposal"`

	Expect Expect `json:"expect"`
}

// ScriptStep 是模型某一轮的返回。
type ScriptStep struct {
	Content   string       `json:"content"`
	ToolCalls []ScriptCall `json:"tool_calls"`
}

// ScriptCall 是模型申请的一次调用。
type ScriptCall struct {
	Name string `json:"name"`
	// Arguments 用对象书写，执行时序列化成模型实际会发的 JSON 字符串。
	Arguments map[string]any `json:"arguments"`
}

// Fixtures 描述用例需要的初始数据。
type Fixtures struct {
	Tasks          []FixtureTask   `json:"tasks"`
	LedgerRecords  []FixtureLedger `json:"ledger_records"`
	Memory         *FixtureMemory  `json:"memory"`
	DeletedMemory  *FixtureMemory  `json:"deleted_memory"`
	RelearnBlocked *FixtureMemory  `json:"relearn_blocked"`
}

// FixtureTask 是一条预置任务。
type FixtureTask struct {
	Title string `json:"title"`
}

// FixtureLedger 是一条预置账单。
type FixtureLedger struct {
	Amount   float64 `json:"amount"`
	Category string  `json:"category"`
}

// FixtureMemory 是一条预置记忆。
type FixtureMemory struct {
	Key  string `json:"key"`
	Text string `json:"text"`
}

// Settings 覆盖用户的 AI 开关。指针字段表示「不覆盖」。
type Settings struct {
	CaptureParseEnabled   *bool `json:"capture_parse_enabled"`
	SuggestionEnabled     *bool `json:"suggestion_enabled"`
	MemoryLearningEnabled *bool `json:"memory_learning_enabled"`
}

// Expect 是这条用例的期望。零值表示不检查该项。
type Expect struct {
	DeniedTools    []string `json:"denied_tools"`
	ExecutedTools  []string `json:"executed_tools"`
	ForbiddenTools []string `json:"forbidden_tools"`

	Proposals               *int     `json:"proposals"`
	ProposalTypes           []string `json:"proposal_types"`
	ProposalHasPreview      bool     `json:"proposal_has_preview"`
	ProposalHasSources      bool     `json:"proposal_has_sources"`
	ProposalHasTargetVer    bool     `json:"proposal_has_target_version"`
	ProposalSourcesResolved bool     `json:"proposal_sources_resolvable"`
	// SensitiveMemoryProposals 是敏感记忆建议的条数。零容忍项写 0。
	SensitiveMemoryProposals *int `json:"sensitive_memory_proposals"`

	Memories          *int `json:"memories"`
	MemoryHasEvidence bool `json:"memory_has_evidence"`

	TasksCreated *int `json:"tasks_created"`
	TasksUpdated *int `json:"tasks_updated"`

	ToolResultContains  []string `json:"tool_result_contains"`
	ToolResultOmits     []string `json:"tool_result_omits"`
	ToolSourcesResolved bool     `json:"tool_sources_resolvable"`

	ContextContains []string `json:"context_contains"`
	ContextOmits    []string `json:"context_omits"`

	AnswerContains []string `json:"answer_contains"`
	AnswerOmits    []string `json:"answer_omits"`

	TurnFailed bool `json:"turn_failed"`

	ConfirmSucceeds   *bool  `json:"confirm_succeeds"`
	ConfirmError      string `json:"confirm_error"`
	ReconfirmRejected bool   `json:"reconfirm_rejected"`
}

// LoadDatasets 读取 evals 目录下的全部数据集。
func LoadDatasets(dir string) ([]Case, error) {
	entries, err := filepath.Glob(filepath.Join(dir, "*.jsonl"))
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("%s 下没有数据集", dir)
	}

	var cases []Case
	seen := map[string]string{}
	for _, path := range entries {
		file, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		scanner := bufio.NewScanner(file)
		scanner.Buffer(make([]byte, 0, 64<<10), 1<<20)
		line := 0
		for scanner.Scan() {
			line++
			text := strings.TrimSpace(scanner.Text())
			if text == "" || strings.HasPrefix(text, "//") {
				continue
			}
			var c Case
			if err := json.Unmarshal([]byte(text), &c); err != nil {
				file.Close()
				return nil, fmt.Errorf("%s 第 %d 行解析失败：%w", filepath.Base(path), line, err)
			}
			if c.ID == "" {
				file.Close()
				return nil, fmt.Errorf("%s 第 %d 行缺少 id", filepath.Base(path), line)
			}
			// ID 重复会让报告里的两条用例互相覆盖，必须当场发现。
			if prev, dup := seen[c.ID]; dup {
				file.Close()
				return nil, fmt.Errorf("用例 id 重复：%s（%s 与 %s）",
					c.ID, prev, filepath.Base(path))
			}
			seen[c.ID] = filepath.Base(path)
			cases = append(cases, c)
		}
		file.Close()
		if err := scanner.Err(); err != nil {
			return nil, err
		}
	}
	return cases, nil
}

// DatasetDir 返回仓库里的数据集目录。
//
// 从当前目录逐级向上找，因为 go test 的工作目录是被测包所在目录。
func DatasetDir() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for i := 0; i < 8; i++ {
		candidate := filepath.Join(dir, "packages", "ai-contracts", "evals")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("找不到 packages/ai-contracts/evals")
}

// IsEmptyExpect 判断一条用例是否没有任何断言。
//
// 期望全空的用例永远绿灯，比没有这条用例更糟：它让人以为这块被覆盖了。
func IsEmptyExpect(e Expect) bool {
	return len(e.DeniedTools) == 0 && len(e.ExecutedTools) == 0 &&
		len(e.ForbiddenTools) == 0 && e.Proposals == nil &&
		len(e.ProposalTypes) == 0 && !e.ProposalHasPreview &&
		!e.ProposalHasSources && !e.ProposalHasTargetVer &&
		!e.ProposalSourcesResolved && e.SensitiveMemoryProposals == nil &&
		e.Memories == nil && !e.MemoryHasEvidence &&
		e.TasksCreated == nil && e.TasksUpdated == nil &&
		len(e.ToolResultContains) == 0 && len(e.ToolResultOmits) == 0 &&
		!e.ToolSourcesResolved && len(e.ContextContains) == 0 &&
		len(e.ContextOmits) == 0 && len(e.AnswerContains) == 0 &&
		len(e.AnswerOmits) == 0 && !e.TurnFailed &&
		e.ConfirmSucceeds == nil && e.ConfirmError == "" && !e.ReconfirmRejected
}
