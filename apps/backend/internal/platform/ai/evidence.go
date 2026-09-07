package ai

// ProposalSourcesValid 只接受服务端本轮消息和已成功只读查询提供的证据。
// Proposal 工具自报的来源不得加入可信集合；修改类建议还必须包含目标来源。
func ProposalSourcesValid(draft ProposalDraft, trusted map[string]bool) bool {
	if len(draft.SourceRefs) == 0 {
		return false
	}
	hasTarget := draft.TargetID == ""
	for _, ref := range draft.SourceRefs {
		if !trusted[ref] {
			return false
		}
		if ref == draft.TargetType+":"+draft.TargetID {
			hasTarget = true
		}
	}
	return hasTarget
}
