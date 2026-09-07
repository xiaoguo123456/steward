package assistant

import (
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

// routeCapabilities 只裁剪具有明确入口语义的简单请求；复合请求和不确定表达保留全集。
// 它不授予任何新能力，也不改变每次调用和确认时的服务端校验。
func routeCapabilities(seed contextSeed, all []ai.Capability) []ai.Capability {
	text := strings.TrimSpace(seed.UserText)
	if seed.Clarification != nil || seed.PendingProposals > 0 || containsAny(text, "同时", "然后", "另外", "并且", "以及", "再帮我", "推荐", "首选", "挑选", "是否", "复制", "重复", "上次", "这个", "那个", "并", "和", "顺便", "接着", "还", "再", "也", "先", "；", ";") {
		return all
	}
	intents := []string{}
	add := func(match bool, name string) {
		if match {
			intents = append(intents, name)
		}
	}
	add(containsAny(text, "任务", "待办") && containsAny(text, "记", "新建", "创建"), "tasks.propose_create")
	add(containsAny(text, "拆分", "拆成"), "tasks.propose_split")
	add(containsAny(text, "截止", "到期") && containsAny(text, "改", "延", "推迟", "提前") && !containsAny(text, "日程", "项目", "生日", "纪念", "重要日"), "tasks.propose_update")
	add(containsAny(text, "日程", "会议", "读书会") && containsAny(text, "安排", "创建", "新建", "生成"), "events.propose_create")
	add(containsAny(text, "记住", "长期偏好"), "memories.propose_upsert")
	if len(intents) != 1 {
		return all
	}
	intent := intents[0]
	keep := map[string]bool{intent: true, "assistant.ask_clarification": true, "assistant.dismiss_proposal": true}
	out := []ai.Capability{}
	for _, c := range all {
		if c.Risk == ai.RiskReadOnly || keep[c.Name] {
			out = append(out, c)
		}
	}
	return out
}

func containsAny(text string, fragments ...string) bool {
	for _, fragment := range fragments {
		if strings.Contains(text, fragment) {
			return true
		}
	}
	return false
}
