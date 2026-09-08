package captures

import (
	"regexp"
	"strings"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/ai"
)

var trackerCandidateFieldKey = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

// validateTrackerCandidates 在审计成功与落库前拒绝不完整字段和悬空引用。
// 数值的最终领域校验仍由确认事务负责，不能以模型输出代替用户确认。
func validateTrackerCandidates(candidates []ai.CandidateDraft, trackers []ai.TrackerRef) error {
	refs := make(map[string]ai.CandidateDraft, len(candidates))
	for _, c := range candidates {
		if c.Ref != "" {
			if _, exists := refs[c.Ref]; exists {
				return ai.ErrSchemaInvalid
			}
			refs[c.Ref] = c
		}
		if c.Type != "tracker" {
			continue
		}
		if c.Ref == "" || len(c.TrackerFields) == 0 || strings.TrimSpace(c.Title) == "" {
			return ai.ErrSchemaInvalid
		}
		keys := make(map[string]bool, len(c.TrackerFields))
		for _, f := range c.TrackerFields {
			if !trackerCandidateFieldKey.MatchString(f.Key) || keys[f.Key] || strings.TrimSpace(f.Label) == "" {
				return ai.ErrSchemaInvalid
			}
			keys[f.Key] = true
			switch f.Type {
			case "number", "currency", "percentage", "duration", "text":
			default:
				return ai.ErrSchemaInvalid
			}
		}
	}
	for _, c := range candidates {
		if c.Type != "record" {
			continue
		}
		var fields []ai.TrackerFieldRef
		if c.TrackerRef != "" {
			target, ok := refs[c.TrackerRef]
			if !ok || target.Type != "tracker" || c.TrackerID != "" {
				return ai.ErrSchemaInvalid
			}
			fields = target.TrackerFields
		} else if c.TrackerID != "" {
			target := findTrackerRef(trackers, c.TrackerID)
			if target == nil {
				return ai.ErrSchemaInvalid
			}
			fields = target.Fields
		} else {
			continue
		} // 无法唯一匹配时可保留缺失字段并澄清，不允许确认。
		byKey := make(map[string]ai.TrackerFieldRef, len(fields))
		for _, f := range fields {
			byKey[f.Key] = f
		}
		seen := make(map[string]bool, len(c.RecordValues))
		for _, v := range c.RecordValues {
			f, ok := byKey[v.Key]
			if !ok || seen[v.Key] {
				return ai.ErrSchemaInvalid
			}
			seen[v.Key] = true
			if f.Type == "text" && v.Number != nil {
				return ai.ErrSchemaInvalid
			}
			if f.Type != "text" && v.Text != "" {
				return ai.ErrSchemaInvalid
			}
		}
	}
	return nil
}

func resolvedTrackerMissing(fields []string) []string {
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if f != "tracker_id" && f != "tracker_ref" {
			out = append(out, f)
		}
	}
	return out
}
