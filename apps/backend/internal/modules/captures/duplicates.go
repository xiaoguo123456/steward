package captures

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"unicode"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
)

type duplicateMatch struct {
	id      string
	version int32
}

// normalizeDuplicateText 只执行规格允许的确定性归一化：首尾/连续空白、
// 英文小写，以及全角 ASCII 标点和空格转半角。
func normalizeDuplicateText(value string) string {
	var b strings.Builder
	space := false
	for _, r := range strings.TrimSpace(value) {
		switch {
		case r == '\u3000':
			r = ' '
		case r >= '\uff01' && r <= '\uff5e':
			r -= 0xfee0
		}
		if unicode.IsSpace(r) {
			space = b.Len() > 0
			continue
		}
		if space {
			b.WriteByte(' ')
			space = false
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return b.String()
}

func (s *Service) detectDuplicate(ctx context.Context, q *dbgen.Queries, userID,
	candidateType string, payload httpapi.CaptureDraftPayload) (*duplicateMatch, error) {
	switch candidateType {
	case "task":
		if payload.Task == nil {
			return nil, nil
		}
		rows, err := q.ListTaskDuplicateCandidates(ctx, dbgen.ListTaskDuplicateCandidatesParams{
			UserID: userID, ProjectID: payload.Task.ProjectRef,
		})
		if err != nil {
			return nil, apperr.Internal(err)
		}
		want := normalizeDuplicateText(payload.Task.Title)
		for _, row := range rows {
			if normalizeDuplicateText(row.Title) == want {
				return &duplicateMatch{id: row.ID, version: row.Version}, nil
			}
		}
	case "event":
		if payload.Event == nil {
			return nil, nil
		}
		want := normalizeDuplicateText(payload.Event.Title)
		if payload.Event.AllDay && payload.Event.StartDate != nil {
			end := payload.Event.StartDate.Time
			if payload.Event.EndDate != nil {
				end = payload.Event.EndDate.Time
			}
			rows, err := q.ListAllDayEventDuplicateCandidates(ctx, dbgen.ListAllDayEventDuplicateCandidatesParams{
				UserID: userID, StartDate: payload.Event.StartDate.Time, EndDate: end,
			})
			if err != nil {
				return nil, apperr.Internal(err)
			}
			for _, row := range rows {
				if normalizeDuplicateText(row.Title) == want {
					return &duplicateMatch{id: row.ID, version: row.Version}, nil
				}
			}
		} else if payload.Event.StartAt != nil {
			rows, err := q.ListTimedEventDuplicateCandidates(ctx, dbgen.ListTimedEventDuplicateCandidatesParams{
				UserID: userID, StartAt: *payload.Event.StartAt,
			})
			if err != nil {
				return nil, apperr.Internal(err)
			}
			for _, row := range rows {
				if normalizeDuplicateText(row.Title) == want {
					return &duplicateMatch{id: row.ID, version: row.Version}, nil
				}
			}
		}
	case "project":
		if payload.Project == nil {
			return nil, nil
		}
		rows, err := q.ListProjectDuplicateCandidates(ctx, userID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		want := normalizeDuplicateText(payload.Project.Title)
		for _, row := range rows {
			if normalizeDuplicateText(row.Title) == want {
				return &duplicateMatch{id: row.ID, version: row.Version}, nil
			}
		}
	case "note":
		if payload.Note == nil {
			return nil, nil
		}
		rows, err := q.ListNoteDuplicateCandidates(ctx, userID)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		title := ""
		if payload.Note.Title != nil {
			title = *payload.Note.Title
		}
		wantTitle, wantContent := normalizeDuplicateText(title), normalizeDuplicateText(payload.Note.Content)
		for _, row := range rows {
			if normalizeDuplicateText(row.Title) == wantTitle && normalizeDuplicateText(row.Content) == wantContent {
				return &duplicateMatch{id: row.ID, version: row.Version}, nil
			}
		}
	case "record":
		if payload.Record == nil || payload.Record.TrackerRef == nil || *payload.Record.TrackerRef == "" {
			return nil, nil
		}
		rows, err := q.ListRecordDuplicateCandidates(ctx, dbgen.ListRecordDuplicateCandidatesParams{
			UserID: userID, TrackerID: *payload.Record.TrackerRef, Timestamp: payload.Record.Timestamp,
		})
		if err != nil {
			return nil, apperr.Internal(err)
		}
		want, err := canonicalJSON(payload.Record.Values)
		if err != nil {
			return nil, apperr.Internal(err)
		}
		for _, row := range rows {
			got, err := canonicalJSON(row.Values)
			if err == nil && bytes.Equal(got, want) {
				return &duplicateMatch{id: row.ID, version: row.Version}, nil
			}
		}
	}
	return nil, nil
}

func canonicalJSON(value any) ([]byte, error) {
	var raw []byte
	switch typed := value.(type) {
	case []byte:
		raw = typed
	case json.RawMessage:
		raw = typed
	default:
		var err error
		raw, err = json.Marshal(value)
		if err != nil {
			return nil, err
		}
	}
	var normalized any
	if err := json.Unmarshal(raw, &normalized); err != nil {
		return nil, err
	}
	return json.Marshal(normalized)
}
