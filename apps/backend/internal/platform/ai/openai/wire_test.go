package openai

import (
	"strings"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

// 线上协议约束的测试。
//
// **这个包原来一个测试都没有，两个真实事故就是这么溜过去的**：
// 第一次接真模型时，Capture 解析每一条都 400，Assistant 每一轮都 400。
// 脚本化 Provider 不校验请求体，评测套件因此完全测不到这一层。
//
// 这里测的不是「模型答得好不好」，而是「我们发出去的请求合不合法」——
// 后者是确定性的，不需要连网。

// 服务端要求工具名匹配 ^[a-zA-Z0-9_-]+$，而我们的能力名带点。
func TestWireToolNameMatchesProviderPattern(t *testing.T) {
	allowed := func(r rune) bool {
		return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '_' || r == '-'
	}
	// 这些是实际登记的能力名。
	for _, name := range []string{
		"tasks.search", "tasks.propose_create", "tasks.propose_update",
		"calendar.read", "objects.get", "records.aggregate",
		"search.hybrid", "reviews.read", "memories.search",
		"memories.propose_upsert", "events.propose_create",
	} {
		wire := toWireToolName(name)
		for _, r := range wire {
			if !allowed(r) {
				t.Errorf("%q 转出来的 %q 含有服务端不接受的字符 %q", name, wire, r)
			}
		}
		if wire == "" {
			t.Errorf("%q 不该转成空串", name)
		}
	}
}

// 模型回传的工具名要能还原成能力名。
//
// 还原不了的话，引擎会拿着 tasks_search 去授权表里找 tasks.search，
// 每一次调用都被拒——功能看起来是「模型不会用工具」，其实是名字对不上。
func TestToolNamesRoundTrip(t *testing.T) {
	tools := []ai.ToolSpec{
		{Name: "tasks.search"},
		{Name: "tasks.propose_create"},
		{Name: "memories.propose_upsert"},
	}
	wire, back := toWireTools(tools)
	if len(wire) != len(tools) {
		t.Fatalf("工具数量不对：%d vs %d", len(wire), len(tools))
	}
	for i, spec := range wire {
		got := fromWireToolName(spec.Function.Name, back)
		if got != tools[i].Name {
			t.Errorf("还原失败：%q → %q → %q", tools[i].Name, spec.Function.Name, got)
		}
	}
}

// 认不出来的名字原样返回，**不猜**。
// 猜错等于把一次越权调用翻译成一次合法调用；原样返回的话，
// 引擎按名字重新授权时会拒掉并留审计。
func TestUnknownToolNameIsNotGuessed(t *testing.T) {
	_, back := toWireTools([]ai.ToolSpec{{Name: "tasks.search"}})
	if got := fromWireToolName("tasks_delete_everything", back); got != "tasks_delete_everything" {
		t.Errorf("不认识的名字应当原样返回，实际 %q", got)
	}
}

// 用 response_format=json_object 时，**user 消息**里必须出现 "json"。
//
// 补在 system 上没用：服务商把 chat/completions 转译成 Responses API，
// system 变成 instructions，不算 input message。我们的解析提示词
// 本来就提到 json 三次，照样被 400 打回。
func TestEnsureJSONMentionAddsToUserMessage(t *testing.T) {
	messages := []chatMessage{
		{Role: "system", Content: "你是一个解析器，输出 JSON。"},
		{Role: "user", Content: "明天下午三点开会"},
	}
	got := ensureJSONMention(messages)

	var userText string
	for _, m := range got {
		if m.Role == "user" {
			userText += textOf(m.Content)
		}
	}
	if !strings.Contains(strings.ToLower(userText), "json") {
		t.Errorf("user 消息里必须出现 json，实际 %q", userText)
	}
	// system 已经提到 json 了也不算数，所以不能因此跳过。
	if len(got) != len(messages) {
		t.Errorf("不该额外增删消息，%d → %d", len(messages), len(got))
	}
}

// user 消息本来就提到 json 时不重复添加。
func TestEnsureJSONMentionSkipsWhenUserAlreadyMentions(t *testing.T) {
	messages := []chatMessage{
		{Role: "user", Content: "请以 json 返回"},
	}
	got := ensureJSONMention(messages)
	if textOf(got[0].Content) != "请以 json 返回" {
		t.Errorf("已经提到 json 就不该改动，实际 %q", textOf(got[0].Content))
	}
}

// 一条 user 都没有时补一条，不能因为找不到就什么都不做。
func TestEnsureJSONMentionAddsUserWhenMissing(t *testing.T) {
	got := ensureJSONMention([]chatMessage{{Role: "system", Content: "只输出结构化结果"}})

	found := false
	for _, m := range got {
		if m.Role == "user" && strings.Contains(strings.ToLower(textOf(m.Content)), "json") {
			found = true
		}
	}
	if !found {
		t.Errorf("没有 user 消息时应当补一条，实际 %+v", got)
	}
}

// 带图片的多段消息不能被塞进文本，那会打乱 text 与 image_url 的配对。
func TestEnsureJSONMentionLeavesMultipartAlone(t *testing.T) {
	original := []contentPart{
		{Type: "text", Text: "看看这张图"},
		{Type: "image_url", ImageURL: &imageURLPart{URL: "data:image/png;base64,xxx"}},
	}
	messages := []chatMessage{{Role: "user", Content: original}}
	got := ensureJSONMention(messages)

	for _, m := range got {
		if parts, ok := m.Content.([]contentPart); ok {
			if len(parts) != len(original) {
				t.Errorf("多段内容不该被改动，%d → %d", len(original), len(parts))
			}
		}
	}
}
