package assistant

import (
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"testing"
)

func TestProposalDatesRejectInvalidInput(t *testing.T) {
	for _, value := range []any{"", "2026-02-30", "明天", nil, 123} {
		if err := validateProposalTimes(map[string]any{"due_date": value}); err == nil {
			t.Errorf("非法日期被接受：%v", value)
		}
	}
	for _, value := range []string{"2026-09-08T15:00:00", "2026-09-08", "不是日期"} {
		if err := validateProposalTimes(map[string]any{"due_at": value}); err == nil {
			t.Errorf("非法时刻被接受：%s", value)
		}
	}
	if err := validateProposalTimes(map[string]any{"due_date": "2026-09-08", "scheduled_start_at": "2026-09-08T15:00:00+08:00"}); err != nil {
		t.Fatal(err)
	}
	if err := validateProposalTimes(map[string]any{}); err != nil {
		t.Fatal("未填时间应保留为空")
	}
}

func TestAssistantProvenanceIncludesAction(t *testing.T) {
	refs := provenanceOf(dbgen.ActionProposal{ID: "aprp_contract"})
	if len(refs) != 1 || refs[0].SourceID != "aprp_contract" || refs[0].SourceType != "assistant_proposal" || refs[0].Action != "created_from" {
		t.Fatalf("来源不符合网络契约：%+v", refs)
	}
}
