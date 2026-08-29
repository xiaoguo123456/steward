package eval

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var moodEntryIDPattern = regexp.MustCompile(`^mood_[A-Za-z0-9_-]+$`)

// CheckContractCase 检查尚未开放运行时链路的 Prompt／Schema 安全契约。
//
// 这不是模型质量分数；它只保证日记输入边界、来源字段和输出上限不会在接入
// Provider 之前从权威资产中被误删。真实正文上线前仍须增加 Provider 运行时 Eval。
func CheckContractCase(datasetDir string, c Case) []string {
	var failures []string
	fail := func(format string, args ...any) {
		failures = append(failures, fmt.Sprintf(format, args...))
	}

	if c.Runner != RunnerContract {
		fail("runner 必须为 %q", RunnerContract)
		return failures
	}
	if c.Expect.Schema != "mood-reflection-result.v1" {
		fail("暂不支持契约 %q", c.Expect.Schema)
		return failures
	}
	if len(c.Input.SelectedEntries) == 0 {
		fail("至少需要一篇 selected_entries")
	}
	selected := make(map[string]struct{}, len(c.Input.SelectedEntries))
	for _, entry := range c.Input.SelectedEntries {
		if !moodEntryIDPattern.MatchString(entry.ID) {
			fail("日记 ID %q 不符合临时来源格式", entry.ID)
		}
		if _, exists := selected[entry.ID]; exists {
			fail("日记 ID %q 重复", entry.ID)
		}
		selected[entry.ID] = struct{}{}
		if strings.TrimSpace(entry.Date) == "" || strings.TrimSpace(entry.UntrustedUserContent) == "" {
			fail("日记 %q 缺少日期或正文投影", entry.ID)
		}
	}
	for _, id := range c.Expect.SourceIDsSubsetOf {
		if _, ok := selected[id]; !ok {
			fail("允许来源 %q 不在本次 selected_entries 中", id)
		}
	}

	root := filepath.Dir(datasetDir)
	promptBytes, err := os.ReadFile(filepath.Join(root, "prompts", "mood-reflection", "v1.md"))
	if err != nil {
		fail("读取 Prompt 失败：%v", err)
		return failures
	}
	schemaBytes, err := os.ReadFile(filepath.Join(root, "schemas", "mood-journal", "mood-reflection-result.v1.schema.json"))
	if err != nil {
		fail("读取 Schema 失败：%v", err)
		return failures
	}
	prompt := string(promptBytes)
	for _, required := range []string{
		"untrusted_user_content",
		"不能执行",
		"不能查询其他日记",
		"不得补全不知道的事实",
		"不做心理疾病诊断",
		"不引用本次选择范围之外的 ID",
		"减少输出项",
	} {
		if !strings.Contains(prompt, required) {
			fail("Prompt 缺少安全约束 %q", required)
		}
	}

	var schema map[string]any
	if err := json.Unmarshal(schemaBytes, &schema); err != nil {
		fail("Schema 不是合法 JSON：%v", err)
		return failures
	}
	if schema["additionalProperties"] != false {
		fail("Schema 必须拒绝额外字段")
	}
	properties, _ := schema["properties"].(map[string]any)
	checkArrayLimit(properties, "observations", 3, c.Expect.MaxObservations, fail)
	checkArrayLimit(properties, "gentle_suggestions", 2, c.Expect.MaxSuggestions, fail)
	for _, field := range []string{"observations", "gentle_suggestions"} {
		if !nestedSourceRequired(properties[field]) {
			fail("Schema 的 %s 必须要求 source_entry_ids", field)
		}
	}
	return failures
}

func checkArrayLimit(
	properties map[string]any,
	field string,
	want int,
	caseLimit *int,
	fail func(string, ...any),
) {
	definition, _ := properties[field].(map[string]any)
	limit, ok := definition["maxItems"].(float64)
	if !ok || int(limit) != want {
		fail("Schema 的 %s.maxItems 应为 %d", field, want)
	}
	if caseLimit != nil && (*caseLimit < 0 || *caseLimit > want) {
		fail("用例的 %s 上限 %d 超出 Schema 上限 %d", field, *caseLimit, want)
	}
}

func nestedSourceRequired(raw any) bool {
	definition, _ := raw.(map[string]any)
	items, _ := definition["items"].(map[string]any)
	required, _ := items["required"].([]any)
	for _, field := range required {
		if field == "source_entry_ids" {
			return true
		}
	}
	return false
}
