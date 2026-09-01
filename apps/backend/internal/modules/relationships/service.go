// Package relationships 管理用户主动建立的亲友档案及其事件、任务关联。
package relationships

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/dbgen"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/activity"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/apperr"
	authpkg "github.com/guoxiaozheng1/steward/apps/backend/internal/platform/auth"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/database"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/idgen"
)

const (
	createPersonEndpoint      = "people.create"
	deletePersonEndpoint      = "people.delete"
	createInteractionEndpoint = "people.interactions.create"
	createEventEndpoint       = "people.events.create"
)

var emptyJSONArray = []byte("[]")

// EventCreator 是 objects 模块开放给亲友模块的最小事务内能力。
type EventCreator interface {
	CreateUserEventInTx(context.Context, *dbgen.Queries, string, httpapi.CreateEventRequest) (dbgen.Event, error)
}

// ActivityRecorder 记录亲友模块产生的不可撤销活动摘要，不保存正文。
type ActivityRecorder interface {
	RecordNonUndoable(context.Context, *dbgen.Queries, string, activity.Source, *string,
		[]activity.EntryInput) (string, error)
}

// Service 是亲友应用服务。
type Service struct {
	db       *database.DB
	events   EventCreator
	activity ActivityRecorder
}

// New 构造亲友服务。
func New(db *database.DB, events EventCreator, recorder ActivityRecorder) *Service {
	return &Service{db: db, events: events, activity: recorder}
}

// PersonFilter 是亲友列表筛选条件。
type PersonFilter struct {
	Query      *string
	Group      *string
	CursorTime *time.Time
	CursorID   *string
	Limit      int32
}

// InteractionFilter 是互动列表筛选条件。
type InteractionFilter struct {
	CursorTime *time.Time
	CursorID   *string
	Limit      int32
}

type resourceReplay struct {
	ResourceID string `json:"resource_id"`
}

type deleteReplay struct {
	BatchID string `json:"activity_batch_id"`
}

// List 查询亲友档案。
func (s *Service) List(ctx context.Context, userID string, filter PersonFilter) ([]dbgen.Person, error) {
	var out []dbgen.Person
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		rows, err := q.ListPeople(ctx, dbgen.ListPeopleParams{
			RelationshipGroup: filter.Group,
			Query:             trimmedOrNil(filter.Query),
			CursorCreatedAt:   filter.CursorTime,
			CursorID:          filter.CursorID,
			RowLimit:          filter.Limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = rows
		return nil
	})
	return out, err
}

// Get 读取单个人物。
func (s *Service) Get(ctx context.Context, userID, personID string) (dbgen.Person, error) {
	var out dbgen.Person
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetPerson(ctx, personID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("亲友")
			}
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// LinkTask 在调用方事务内校验人物归属并关联正式 Task。
func (s *Service) LinkTask(ctx context.Context, q *dbgen.Queries,
	userID, taskID, personID string) error {
	if _, err := q.GetPerson(ctx, personID); err != nil {
		if database.IsNoRows(err) {
			return apperr.NotFound("亲友")
		}
		return apperr.Internal(err)
	}
	if err := q.LinkTaskToPerson(ctx, dbgen.LinkTaskToPersonParams{
		TaskID: taskID, PersonID: personID, UserID: userID,
	}); err != nil {
		return apperr.Internal(err)
	}
	return nil
}

// Create 手动创建亲友档案。
func (s *Service) Create(ctx context.Context, userID, idempotencyKey string, body httpapi.CreatePersonRequest) (dbgen.Person, error) {
	name := strings.TrimSpace(body.Name)
	if err := validatePerson(name, body.RelationshipLabel, body.Note); err != nil {
		return dbgen.Person{}, err
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		return dbgen.Person{}, apperr.New(apperr.CodeIdempotencyKeyReq)
	}
	body.Name = name
	body.RelationshipLabel = trimmedOrNil(body.RelationshipLabel)
	body.Note = trimmedOrNil(body.Note)
	raw, _ := json.Marshal(body)
	hash := authpkg.HashToken(string(raw))
	personID := idgen.New(idgen.PrefixPerson)

	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		replayed, handled, err := beginReplay(ctx, q, userID, createPersonEndpoint, idempotencyKey, hash)
		if err != nil {
			return err
		}
		if handled {
			personID = replayed.ResourceID
			return nil
		}
		created, err := q.CreatePerson(ctx, dbgen.CreatePersonParams{
			ID: personID, UserID: userID, Name: body.Name,
			RelationshipGroup: string(body.RelationshipGroup),
			RelationshipLabel: body.RelationshipLabel, Note: body.Note,
			CreatedBy: "user", ProvenanceRefs: emptyJSONArray,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		if _, err := s.activity.RecordNonUndoable(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{Action: "created", ResourceType: "person", ResourceID: personID,
				Title: created.Name, Summary: "添加了亲友"}}); err != nil {
			return err
		}
		return saveReplay(ctx, q, userID, createPersonEndpoint, idempotencyKey, hash, 201, personID)
	})
	if err != nil {
		return dbgen.Person{}, err
	}
	return s.Get(ctx, userID, personID)
}

// Update 修改亲友资料并执行乐观锁校验。
func (s *Service) Update(ctx context.Context, userID, personID string, body httpapi.UpdatePersonRequest, expected *int32) (dbgen.Person, error) {
	var out dbgen.Person
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		current, err := q.GetPerson(ctx, personID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("亲友")
			}
			return apperr.Internal(err)
		}
		if expected != nil && current.Version != *expected {
			return apperr.New(apperr.CodeVersionConflict)
		}
		name := body.Name
		if name != nil {
			trimmed := strings.TrimSpace(*name)
			name = &trimmed
		}
		label, note := trimmedOrNil(body.RelationshipLabel), trimmedOrNil(body.Note)
		if err := validatePersonValue(name, label, note); err != nil {
			return err
		}
		clearLabel, clearNote := personClearFlags(body.Clear)
		var group *string
		if body.RelationshipGroup != nil {
			value := string(*body.RelationshipGroup)
			group = &value
		}
		out, err = q.UpdatePerson(ctx, dbgen.UpdatePersonParams{
			ID: personID, Name: name, RelationshipGroup: group,
			ClearRelationshipLabel: clearLabel, RelationshipLabel: label,
			ClearNote: clearNote, Note: note,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		_, err = s.activity.RecordNonUndoable(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{Action: "updated", ResourceType: "person", ResourceID: personID,
				Title: out.Name, Summary: "更新了亲友资料"}})
		return err
	})
	return out, err
}

// Delete 删除亲友档案、互动和事件关联；Event 本身继续保留。
func (s *Service) Delete(ctx context.Context, userID, personID, idempotencyKey string) (string, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return "", apperr.New(apperr.CodeIdempotencyKeyReq)
	}
	hash := authpkg.HashToken(personID)
	var batchID string
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if err := q.AcquireIdempotencyLock(ctx, deletePersonEndpoint+":"+userID+":"+idempotencyKey); err != nil {
			return apperr.Internal(err)
		}
		record, err := q.GetIdempotencyRecord(ctx, dbgen.GetIdempotencyRecordParams{
			UserID: userID, Endpoint: deletePersonEndpoint, Key: idempotencyKey,
		})
		if err == nil {
			if subtle.ConstantTimeCompare(record.RequestHash, hash) != 1 {
				return apperr.New(apperr.CodeIdempotencyReused)
			}
			var replay deleteReplay
			if err := json.Unmarshal(record.ResponseBody, &replay); err != nil {
				return apperr.Internal(err)
			}
			batchID = replay.BatchID
			return nil
		}
		if !database.IsNoRows(err) {
			return apperr.Internal(err)
		}
		person, err := q.SoftDeletePerson(ctx, personID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("亲友")
			}
			return apperr.Internal(err)
		}
		if err := q.SoftDeletePersonInteractions(ctx, personID); err != nil {
			return apperr.Internal(err)
		}
		if err := q.DeleteEventPeopleForPerson(ctx, personID); err != nil {
			return apperr.Internal(err)
		}
		batchID, err = s.activity.RecordNonUndoable(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{Action: "deleted", ResourceType: "person", ResourceID: personID,
				Title: person.Name, Summary: "删除了亲友"}})
		if err != nil {
			return err
		}
		snapshot, _ := json.Marshal(deleteReplay{BatchID: batchID})
		return q.SaveIdempotencyRecord(ctx, dbgen.SaveIdempotencyRecordParams{
			UserID: userID, Endpoint: deletePersonEndpoint, Key: idempotencyKey,
			RequestHash: hash, StatusCode: 200, ResponseBody: snapshot,
			ResourceID: &personID, ExpiresAt: time.Now().Add(24 * time.Hour),
		})
	})
	return batchID, err
}

// ListInteractions 查询某人的历史互动。
func (s *Service) ListInteractions(ctx context.Context, userID, personID string, filter InteractionFilter) ([]dbgen.PersonInteraction, error) {
	var out []dbgen.PersonInteraction
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.GetPerson(ctx, personID); err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("亲友")
			}
			return apperr.Internal(err)
		}
		rows, err := q.ListPersonInteractions(ctx, dbgen.ListPersonInteractionsParams{
			PersonID: personID, CursorOccurredAt: filter.CursorTime,
			CursorID: filter.CursorID, RowLimit: filter.Limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = rows
		return nil
	})
	return out, err
}

// CreateInteraction 记录一次已经发生的互动。
func (s *Service) CreateInteraction(ctx context.Context, userID, personID, idempotencyKey string, body httpapi.CreatePersonInteractionRequest) (dbgen.PersonInteraction, error) {
	body.Summary = strings.TrimSpace(body.Summary)
	body.Note = trimmedOrNil(body.Note)
	if body.Summary == "" || utf8.RuneCountInString(body.Summary) > 160 {
		return dbgen.PersonInteraction{}, apperr.Validation(apperr.Field("summary", "互动摘要需要 1～160 个字。"))
	}
	if body.Note != nil && utf8.RuneCountInString(*body.Note) > 1000 {
		return dbgen.PersonInteraction{}, apperr.Validation(apperr.Field("note", "补充内容最多 1000 个字。"))
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		return dbgen.PersonInteraction{}, apperr.New(apperr.CodeIdempotencyKeyReq)
	}
	raw, _ := json.Marshal(struct {
		PersonID string
		Body     httpapi.CreatePersonInteractionRequest
	}{personID, body})
	hash := authpkg.HashToken(string(raw))
	interactionID := idgen.New(idgen.PrefixPersonInteraction)
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		replayed, handled, err := beginReplay(ctx, q, userID, createInteractionEndpoint, idempotencyKey, hash)
		if err != nil {
			return err
		}
		if handled {
			interactionID = replayed.ResourceID
			return nil
		}
		if _, err := q.GetPerson(ctx, personID); err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("亲友")
			}
			return apperr.Internal(err)
		}
		created, err := q.CreatePersonInteraction(ctx, dbgen.CreatePersonInteractionParams{
			ID: interactionID, UserID: userID, PersonID: personID,
			InteractionType: string(body.InteractionType), OccurredAt: body.OccurredAt,
			Summary: body.Summary, Note: body.Note, CreatedBy: "user", ProvenanceRefs: emptyJSONArray,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		if _, err := s.activity.RecordNonUndoable(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{Action: "created", ResourceType: "person_interaction", ResourceID: interactionID,
				Title: created.Summary, Summary: "记录了亲友互动"}}); err != nil {
			return err
		}
		return saveReplay(ctx, q, userID, createInteractionEndpoint, idempotencyKey, hash, 201, interactionID)
	})
	if err != nil {
		return dbgen.PersonInteraction{}, err
	}
	var out dbgen.PersonInteraction
	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetPersonInteraction(ctx, interactionID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("互动")
			}
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

// ListEvents 查询某人的关联事件。
func (s *Service) ListEvents(ctx context.Context, userID, personID string, filter PersonFilter) ([]dbgen.Event, error) {
	var out []dbgen.Event
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if _, err := q.GetPerson(ctx, personID); err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("亲友")
			}
			return apperr.Internal(err)
		}
		rows, err := q.ListPersonEvents(ctx, dbgen.ListPersonEventsParams{
			PersonID: personID, CursorCreatedAt: filter.CursorTime,
			CursorID: filter.CursorID, RowLimit: filter.Limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		out = rows
		return nil
	})
	return out, err
}

// CreateEvent 创建正式 Event 并在同一事务内关联人物。
func (s *Service) CreateEvent(ctx context.Context, userID, personID, idempotencyKey string, body httpapi.CreateEventRequest) (dbgen.Event, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return dbgen.Event{}, apperr.New(apperr.CodeIdempotencyKeyReq)
	}
	raw, _ := json.Marshal(struct {
		PersonID string
		Body     httpapi.CreateEventRequest
	}{personID, body})
	hash := authpkg.HashToken(string(raw))
	eventID := ""
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		replayed, handled, err := beginReplay(ctx, q, userID, createEventEndpoint, idempotencyKey, hash)
		if err != nil {
			return err
		}
		if handled {
			eventID = replayed.ResourceID
			return nil
		}
		person, err := q.GetPerson(ctx, personID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("亲友")
			}
			return apperr.Internal(err)
		}
		created, err := s.events.CreateUserEventInTx(ctx, q, userID, body)
		if err != nil {
			return err
		}
		eventID = created.ID
		if err := q.LinkEventToPerson(ctx, dbgen.LinkEventToPersonParams{EventID: eventID, PersonID: personID, UserID: userID}); err != nil {
			return apperr.Internal(err)
		}
		if _, err := s.activity.RecordNonUndoable(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{Action: "created", ResourceType: "event", ResourceID: eventID,
				Title: created.Title, Summary: "为" + person.Name + "添加了事件"}}); err != nil {
			return err
		}
		return saveReplay(ctx, q, userID, createEventEndpoint, idempotencyKey, hash, 201, eventID)
	})
	if err != nil {
		return dbgen.Event{}, err
	}
	var out dbgen.Event
	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		row, err := q.GetEvent(ctx, eventID)
		if err != nil {
			return apperr.Internal(err)
		}
		out = row
		return nil
	})
	return out, err
}

func validatePerson(name string, label, note *string) error {
	return validatePersonValue(&name, label, note)
}

func validatePersonValue(name, label, note *string) error {
	if name != nil && (strings.TrimSpace(*name) == "" || utf8.RuneCountInString(*name) > 80) {
		return apperr.Validation(apperr.Field("name", "姓名需要 1～80 个字。"))
	}
	if label != nil && utf8.RuneCountInString(strings.TrimSpace(*label)) > 40 {
		return apperr.Validation(apperr.Field("relationship_label", "关系称呼最多 40 个字。"))
	}
	if note != nil && utf8.RuneCountInString(strings.TrimSpace(*note)) > 500 {
		return apperr.Validation(apperr.Field("note", "备注最多 500 个字。"))
	}
	return nil
}

func personClearFlags(clear *[]httpapi.UpdatePersonRequestClear) (bool, bool) {
	if clear == nil {
		return false, false
	}
	var label, note bool
	for _, item := range *clear {
		switch item {
		case httpapi.UpdatePersonRequestClearRelationshipLabel:
			label = true
		case httpapi.UpdatePersonRequestClearNote:
			note = true
		}
	}
	return label, note
}

func trimmedOrNil(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func beginReplay(ctx context.Context, q *dbgen.Queries, userID, endpoint, key string, hash []byte) (resourceReplay, bool, error) {
	if err := q.AcquireIdempotencyLock(ctx, endpoint+":"+userID+":"+key); err != nil {
		return resourceReplay{}, false, apperr.Internal(err)
	}
	record, err := q.GetIdempotencyRecord(ctx, dbgen.GetIdempotencyRecordParams{UserID: userID, Endpoint: endpoint, Key: key})
	if database.IsNoRows(err) {
		return resourceReplay{}, false, nil
	}
	if err != nil {
		return resourceReplay{}, false, apperr.Internal(err)
	}
	if subtle.ConstantTimeCompare(record.RequestHash, hash) != 1 {
		return resourceReplay{}, false, apperr.New(apperr.CodeIdempotencyReused)
	}
	var replay resourceReplay
	if err := json.Unmarshal(record.ResponseBody, &replay); err != nil {
		return resourceReplay{}, false, apperr.Internal(err)
	}
	return replay, true, nil
}

func saveReplay(ctx context.Context, q *dbgen.Queries, userID, endpoint, key string, hash []byte, status int32, resourceID string) error {
	snapshot, _ := json.Marshal(resourceReplay{ResourceID: resourceID})
	return q.SaveIdempotencyRecord(ctx, dbgen.SaveIdempotencyRecordParams{
		UserID: userID, Endpoint: endpoint, Key: key, RequestHash: hash,
		StatusCode: status, ResponseBody: snapshot, ResourceID: &resourceID,
		ExpiresAt: time.Now().Add(24 * time.Hour),
	})
}
