package ai

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// CapabilityRisk 是能力的风险级别。
type CapabilityRisk string

// 风险级别取值。
const (
	// RiskReadOnly 只读取当前用户自己的数据。
	RiskReadOnly CapabilityRisk = "read_only"
	// RiskProposal 只构造建议，不执行写入。
	RiskProposal CapabilityRisk = "proposal"
)

// 永不开放给模型的能力（后端指南 10.7）：
//
//	任意 SQL、数据库连接与表名访问；任意 HTTP 与浏览器访问；
//	Shell、代码执行与文件系统；直接发送短信、邮件、推送；
//	直接创建、修改、删除业务实体；读取其他用户或全局数据；
//	获取 Token、Secrets、签名 URL 密钥或原始日志。
//
// Registry 只接受在代码里显式登记过的 Capability，
// 不支持按名字反射任意 Go 方法。

// ErrCapabilityNotFound 表示模型请求了未登记的能力。
var ErrCapabilityNotFound = errors.New("能力未登记")

// ErrCapabilityNotAllowed 表示该能力本轮不在允许集合内。
var ErrCapabilityNotAllowed = errors.New("能力本轮不可用")

// CapabilityContext 是一次工具调用的执行上下文。
//
// UserID 只来自服务端已验证的身份；模型自报的任何用户信息都被忽略。
type CapabilityContext struct {
	UserID   string
	Timezone string
	Now      time.Time
	// EntryResourceType 与 EntryResourceID 是客户端页面上下文，
	// 只用于消歧，执行前仍会重新校验归属。
	EntryResourceType string
	EntryResourceID   string
}

// CapabilityResult 是一次工具调用的结果。
type CapabilityResult struct {
	// Content 是交回模型的最小结果文本。
	Content string
	// SourceRefs 是本次实际读取过的来源，用于校验模型引用是否真实。
	SourceRefs []string
	// Proposals 只有 RiskProposal 的能力才会返回。
	Proposals []ProposalDraft
}

// ProposalDraft 是一条尚未落库的建议。
type ProposalDraft struct {
	Type string
	// TargetType 与 TargetID 指向已有实体，创建类建议为空。
	TargetType            string
	TargetID              string
	TargetExpectedVersion *int
	// Command 是类型化的领域命令载荷，不是任意 JSON Patch。
	Command map[string]any
	Preview ProposalPreview
	Reason  string
	// EditableFields 声明用户在确认页可以修改哪些字段。
	EditableFields []string
	SourceRefs     []string
}

// ProposalPreview 是给用户看的变更预览。
type ProposalPreview struct {
	Title   string
	Changes []ProposalChange
	Impact  string
}

// ProposalChange 是单个字段的变化。
type ProposalChange struct {
	Field  string
	Label  string
	Before string
	After  string
}

// CapabilityHandler 执行一次能力调用。
//
// 实现必须只调用拥有模块的公开 Query 或 Proposal Builder，
// 不得直接访问其他模块的私表，也不得执行写入。
type CapabilityHandler func(ctx context.Context, cc CapabilityContext, args map[string]any) (CapabilityResult, error)

// Capability 是一个已登记的能力。
type Capability struct {
	Name        string
	Version     string
	Description string
	Risk        CapabilityRisk
	// Parameters 是交给 Provider 的 JSON Schema 子集。
	Parameters map[string]any
	// MaxResultBytes 限制交回模型的结果大小，避免上下文被单个工具撑爆。
	MaxResultBytes int
	Timeout        time.Duration
	Handler        CapabilityHandler
}

// Registry 保存全部已登记能力。
type Registry struct {
	items map[string]Capability
	order []string
}

// NewRegistry 构造空的 Registry。
func NewRegistry() *Registry {
	return &Registry{items: make(map[string]Capability)}
}

// Register 登记一个能力。重复名称会 panic：这是编码错误，应当在启动时暴露。
func (r *Registry) Register(c Capability) {
	if c.Name == "" || c.Handler == nil {
		panic("能力必须有名称与处理函数")
	}
	if _, exists := r.items[c.Name]; exists {
		panic(fmt.Sprintf("能力 %s 重复登记", c.Name))
	}
	if c.Version == "" {
		c.Version = "v1"
	}
	if c.MaxResultBytes <= 0 {
		c.MaxResultBytes = 8 << 10
	}
	if c.Timeout <= 0 {
		c.Timeout = 10 * time.Second
	}
	r.items[c.Name] = c
	r.order = append(r.order, c.Name)
}

// Get 按名称查找能力。只按登记名查找，不支持反射。
func (r *Registry) Get(name string) (Capability, error) {
	c, ok := r.items[name]
	if !ok {
		return Capability{}, ErrCapabilityNotFound
	}
	return c, nil
}

// Allowed 计算本轮允许的能力集合。
//
// 模型收到的工具列表只是提示；每次调用前仍会重新授权，
// 因此这里的裁剪是性能与引导手段，不是唯一的安全边界。
func (r *Registry) Allowed(allowProposals bool) []Capability {
	out := make([]Capability, 0, len(r.order))
	for _, name := range r.order {
		c := r.items[name]
		if c.Risk == RiskProposal && !allowProposals {
			continue
		}
		out = append(out, c)
	}
	return out
}

// Names 返回全部已登记能力名，用于健康检查与调试。
func (r *Registry) Names() []string {
	out := make([]string, len(r.order))
	copy(out, r.order)
	return out
}
