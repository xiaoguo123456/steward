package relationships

import (
	"errors"
	"strings"
	"testing"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

func TestValidatePersonRejectsEmptyAndOverlongValues(t *testing.T) {
	longLabel := strings.Repeat("友", 41)
	longNote := strings.Repeat("记", 501)
	for _, input := range []struct {
		name  string
		label *string
		note  *string
	}{
		{name: " "},
		{name: "小林", label: &longLabel},
		{name: "小林", note: &longNote},
	} {
		err := validatePerson(input.name, input.label, input.note)
		var domainErr *apperr.Error
		if !errors.As(err, &domainErr) || domainErr.Code != apperr.CodeValidationFailed {
			t.Fatalf("应返回字段校验错误，实际：%v", err)
		}
	}
}

func TestPersonClearFlags(t *testing.T) {
	clear := []httpapi.UpdatePersonRequestClear{
		httpapi.UpdatePersonRequestClearRelationshipLabel,
		httpapi.UpdatePersonRequestClearNote,
	}
	label, note := personClearFlags(&clear)
	if !label || !note {
		t.Fatalf("清空标记没有完整识别：label=%v note=%v", label, note)
	}
}
