// Package memorymoments 拥有用户主动发布的私人照片时光。
//
// 它与 AI 长期记忆 memory_items 是两个独立领域。时光发布后不可编辑；
// 服务端只暴露创建、读取和整段删除能力。
package memorymoments

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"strconv"
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
	createEndpoint = "memory-moments.create"
	deleteEndpoint = "memory-moments.delete"
)

// MediaResolver 是时光依赖的最小媒体能力。
type MediaResolver interface {
	ValidateImageReferencesFor(context.Context, *dbgen.Queries, string, []string, string) error
	ReadURL(context.Context, string) (string, error)
}

// ActivityRecorder 记录不可撤销的时光发布与删除，不保存正文或图片地址。
type ActivityRecorder interface {
	RecordNonUndoable(context.Context, *dbgen.Queries, string, activity.Source, *string,
		[]activity.EntryInput) (string, error)
}

// MediaDeletionArgs 只携带用户和媒体引用，不把对象键写入任务表。
type MediaDeletionArgs struct {
	UserID  string
	MediaID string
}

// MediaDeletionEnqueuer 在删除事务中登记可重试的对象存储清理任务。
type MediaDeletionEnqueuer interface {
	EnqueueMemoryMomentMediaDeletion(context.Context, *dbgen.Queries, MediaDeletionArgs) error
}

// Service 是时光应用服务。
type Service struct {
	db       *database.DB
	media    MediaResolver
	activity ActivityRecorder
	jobs     MediaDeletionEnqueuer
}

// New 构造时光服务。
func New(db *database.DB, media MediaResolver, activity ActivityRecorder,
	jobs MediaDeletionEnqueuer) *Service {
	return &Service{db: db, media: media, activity: activity, jobs: jobs}
}

// Photo 是已完成上传的图片及其短期读取地址。
type Photo struct {
	MediaID     string
	ReadURL     string
	Description string
	Position    int32
	ObjectKey   string
}

// Moment 是时光领域读模型。
type Moment struct {
	Row    dbgen.MemoryMoment
	Photos []Photo
}

// Filter 是时光列表条件。日期均为用户选择的自然日。
type Filter struct {
	FromDate         *time.Time
	ToDate           *time.Time
	CursorOccurredOn *time.Time
	CursorID         *string
	Limit            int32
}

type createReplay struct {
	MomentID string `json:"moment_id"`
}

type deleteReplay struct {
	BatchID string `json:"activity_batch_id"`
}

// List 查询时光并为每张图片签发短期读取地址。
func (s *Service) List(ctx context.Context, userID string, filter Filter) ([]Moment, error) {
	if filter.FromDate != nil && filter.ToDate != nil && filter.FromDate.After(*filter.ToDate) {
		return nil, apperr.Validation(apperr.Field("from", "开始日期不能晚于结束日期。"))
	}
	var rows []dbgen.MemoryMoment
	var photos []dbgen.ListMemoryMomentPhotosForMomentsRow
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		found, err := q.ListMemoryMoments(ctx, dbgen.ListMemoryMomentsParams{
			FromDate: filter.FromDate, ToDate: filter.ToDate,
			CursorOccurredOn: filter.CursorOccurredOn, CursorID: filter.CursorID,
			RowLimit: filter.Limit,
		})
		if err != nil {
			return apperr.Internal(err)
		}
		rows = found
		if len(rows) == 0 {
			return nil
		}
		ids := make([]string, 0, len(rows))
		for _, row := range rows {
			ids = append(ids, row.ID)
		}
		photos, err = q.ListMemoryMomentPhotosForMoments(ctx, ids)
		if err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.attachPhotos(ctx, rows, photos)
}

// Get 读取单段时光。
func (s *Service) Get(ctx context.Context, userID, momentID string) (Moment, error) {
	var row dbgen.MemoryMoment
	var photos []dbgen.ListMemoryMomentPhotosRow
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		found, err := q.GetMemoryMoment(ctx, momentID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("时光")
			}
			return apperr.Internal(err)
		}
		row = found
		photos, err = q.ListMemoryMomentPhotos(ctx, momentID)
		if err != nil {
			return apperr.Internal(err)
		}
		return nil
	})
	if err != nil {
		return Moment{}, err
	}
	result := Moment{Row: row, Photos: make([]Photo, 0, len(photos))}
	for _, photo := range photos {
		mapped, err := s.signPhoto(ctx, photo.MediaID, photo.ObjectKey, photo.Description, photo.Position)
		if err != nil {
			return Moment{}, err
		}
		result.Photos = append(result.Photos, mapped)
	}
	return result, nil
}

// Create 发布一段不可编辑的时光。
func (s *Service) Create(ctx context.Context, userID, idempotencyKey string,
	body httpapi.CreateMemoryMomentRequest) (Moment, error) {
	prepared, err := normalizeCreate(body)
	if err != nil {
		return Moment{}, err
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		return Moment{}, apperr.New(apperr.CodeIdempotencyKeyReq)
	}
	raw, err := json.Marshal(prepared)
	if err != nil {
		return Moment{}, apperr.Internal(err)
	}
	hash := authpkg.HashToken(string(raw))
	momentID := idgen.New(idgen.PrefixMemoryMoment)

	err = s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if err := q.AcquireIdempotencyLock(ctx,
			createEndpoint+":"+userID+":"+idempotencyKey); err != nil {
			return apperr.Internal(err)
		}
		replayed, err := q.GetIdempotencyRecord(ctx, dbgen.GetIdempotencyRecordParams{
			UserID: userID, Endpoint: createEndpoint, Key: idempotencyKey,
		})
		if err == nil {
			if subtle.ConstantTimeCompare(replayed.RequestHash, hash) != 1 {
				return apperr.New(apperr.CodeIdempotencyReused)
			}
			var snapshot createReplay
			if err := json.Unmarshal(replayed.ResponseBody, &snapshot); err != nil {
				return apperr.Internal(err)
			}
			momentID = snapshot.MomentID
			return nil
		}
		if !database.IsNoRows(err) {
			return apperr.Internal(err)
		}

		mediaIDs := make([]string, 0, len(prepared.Photos))
		for _, photo := range prepared.Photos {
			mediaIDs = append(mediaIDs, photo.MediaID)
		}
		if err := s.media.ValidateImageReferencesFor(
			ctx, q, userID, mediaIDs, "photos"); err != nil {
			return err
		}
		for index, mediaID := range mediaIDs {
			referenced, err := q.IsMediaReferencedByActiveMemoryMoment(ctx, mediaID)
			if err != nil {
				return apperr.Internal(err)
			}
			if referenced {
				return apperr.Validation(apperr.Field(
					"photos["+strconv.Itoa(index)+"]", "这张照片已经发布到其他时光。"))
			}
		}
		if _, err := q.CreateMemoryMoment(ctx, dbgen.CreateMemoryMomentParams{
			ID: momentID, UserID: userID, OccurredOn: prepared.OccurredOn,
			Title: prepared.Title, Story: prepared.Story, CreatedBy: "user",
		}); err != nil {
			return apperr.Internal(err)
		}
		for position, photo := range prepared.Photos {
			if _, err := q.CreateMemoryMomentPhoto(ctx, dbgen.CreateMemoryMomentPhotoParams{
				MomentID: momentID, UserID: userID, MediaID: photo.MediaID,
				Position: int32(position), Description: photo.Description,
			}); err != nil {
				return apperr.Internal(err)
			}
		}
		if _, err := s.activity.RecordNonUndoable(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action: "created", ResourceType: "memory_moment", ResourceID: momentID,
				Title: prepared.Title, Summary: "发布了照片时光",
			}}); err != nil {
			return err
		}
		snapshot, err := json.Marshal(createReplay{MomentID: momentID})
		if err != nil {
			return apperr.Internal(err)
		}
		return q.SaveIdempotencyRecord(ctx, dbgen.SaveIdempotencyRecordParams{
			UserID: userID, Endpoint: createEndpoint, Key: idempotencyKey,
			RequestHash: hash, StatusCode: 201, ResponseBody: snapshot,
			ResourceID: &momentID, ExpiresAt: time.Now().Add(24 * time.Hour),
		})
	})
	if err != nil {
		return Moment{}, err
	}
	return s.Get(ctx, userID, momentID)
}

// Delete 让整段时光立即不可见，并清理服务端媒体副本。
func (s *Service) Delete(ctx context.Context, userID, momentID, idempotencyKey string) (string, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return "", apperr.New(apperr.CodeIdempotencyKeyReq)
	}
	hash := authpkg.HashToken(momentID)
	var mediaIDs []string
	var batchID string
	err := s.db.InTx(ctx, userID, func(ctx context.Context, q *dbgen.Queries) error {
		if err := q.AcquireIdempotencyLock(ctx,
			deleteEndpoint+":"+userID+":"+idempotencyKey); err != nil {
			return apperr.Internal(err)
		}
		replayed, err := q.GetIdempotencyRecord(ctx, dbgen.GetIdempotencyRecordParams{
			UserID: userID, Endpoint: deleteEndpoint, Key: idempotencyKey,
		})
		if err == nil {
			if subtle.ConstantTimeCompare(replayed.RequestHash, hash) != 1 {
				return apperr.New(apperr.CodeIdempotencyReused)
			}
			var snapshot deleteReplay
			if err := json.Unmarshal(replayed.ResponseBody, &snapshot); err != nil {
				return apperr.Internal(err)
			}
			batchID = snapshot.BatchID
			return nil
		}
		if !database.IsNoRows(err) {
			return apperr.Internal(err)
		}

		moment, err := q.GetMemoryMoment(ctx, momentID)
		if err != nil {
			if database.IsNoRows(err) {
				return apperr.NotFound("时光")
			}
			return apperr.Internal(err)
		}
		photos, err := q.ListMemoryMomentPhotos(ctx, momentID)
		if err != nil {
			return apperr.Internal(err)
		}
		for _, photo := range photos {
			mediaIDs = append(mediaIDs, photo.MediaID)
		}
		if _, err := q.SoftDeleteMemoryMoment(ctx, momentID); err != nil {
			return apperr.Internal(err)
		}
		for _, mediaID := range mediaIDs {
			if _, err := q.SoftDeleteMediaAsset(ctx, mediaID); err != nil {
				return apperr.Internal(err)
			}
			if err := s.jobs.EnqueueMemoryMomentMediaDeletion(ctx, q, MediaDeletionArgs{
				UserID: userID, MediaID: mediaID,
			}); err != nil {
				return err
			}
		}
		batchID, err = s.activity.RecordNonUndoable(ctx, q, userID, activity.SourceUserForm, nil,
			[]activity.EntryInput{{
				Action: "deleted", ResourceType: "memory_moment", ResourceID: momentID,
				Title: moment.Title, Summary: "删除了照片时光",
			}})
		if err != nil {
			return err
		}
		snapshot, err := json.Marshal(deleteReplay{BatchID: batchID})
		if err != nil {
			return apperr.Internal(err)
		}
		return q.SaveIdempotencyRecord(ctx, dbgen.SaveIdempotencyRecordParams{
			UserID: userID, Endpoint: deleteEndpoint, Key: idempotencyKey,
			RequestHash: hash, StatusCode: 200, ResponseBody: snapshot,
			ResourceID: &momentID, ExpiresAt: time.Now().Add(24 * time.Hour),
		})
	})
	if err != nil {
		return "", err
	}
	return batchID, nil
}

type normalizedCreate struct {
	OccurredOn time.Time
	Title      string
	Story      string
	Photos     []normalizedPhoto
}

type normalizedPhoto struct {
	MediaID     string
	Description string
}

func normalizeCreate(body httpapi.CreateMemoryMomentRequest) (normalizedCreate, error) {
	if len(body.Photos) < 1 || len(body.Photos) > 9 {
		return normalizedCreate{}, apperr.Validation(
			apperr.Field("photos", "请选择 1～9 张照片。"))
	}
	title := trimmed(body.Title)
	story := trimmed(body.Story)
	if utf8.RuneCountInString(title) > 32 {
		return normalizedCreate{}, apperr.Validation(
			apperr.Field("title", "标题最多 32 个字。"))
	}
	if utf8.RuneCountInString(story) > 300 {
		return normalizedCreate{}, apperr.Validation(
			apperr.Field("story", "故事最多 300 个字。"))
	}
	photos := make([]normalizedPhoto, 0, len(body.Photos))
	seen := make(map[string]struct{}, len(body.Photos))
	for index, photo := range body.Photos {
		mediaID := strings.TrimSpace(photo.MediaId)
		if mediaID == "" {
			return normalizedCreate{}, apperr.Validation(
				apperr.Field("photos", "照片引用不能为空。"))
		}
		if _, exists := seen[mediaID]; exists {
			return normalizedCreate{}, apperr.Validation(
				apperr.Field("photos", "同一张照片不能重复发布。"))
		}
		seen[mediaID] = struct{}{}
		description := trimmed(photo.Description)
		if description == "" {
			description = "第 " + strconv.Itoa(index+1) + " 张照片"
		}
		if utf8.RuneCountInString(description) > 200 {
			return normalizedCreate{}, apperr.Validation(
				apperr.Field("photos", "照片描述最多 200 个字。"))
		}
		photos = append(photos, normalizedPhoto{MediaID: mediaID, Description: description})
	}
	return normalizedCreate{
		OccurredOn: body.OccurredOn.Time, Title: title, Story: story, Photos: photos,
	}, nil
}

func trimmed(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func (s *Service) attachPhotos(ctx context.Context, rows []dbgen.MemoryMoment,
	photos []dbgen.ListMemoryMomentPhotosForMomentsRow) ([]Moment, error) {
	grouped := make(map[string][]Photo, len(rows))
	for _, photo := range photos {
		mapped, err := s.signPhoto(ctx, photo.MediaID, photo.ObjectKey, photo.Description, photo.Position)
		if err != nil {
			return nil, err
		}
		grouped[photo.MomentID] = append(grouped[photo.MomentID], mapped)
	}
	out := make([]Moment, 0, len(rows))
	for _, row := range rows {
		out = append(out, Moment{Row: row, Photos: grouped[row.ID]})
	}
	return out, nil
}

func (s *Service) signPhoto(ctx context.Context, mediaID, objectKey, description string,
	position int32) (Photo, error) {
	url, err := s.media.ReadURL(ctx, objectKey)
	if err != nil {
		return Photo{}, apperr.Internal(err)
	}
	return Photo{
		MediaID: mediaID, ReadURL: url, Description: description,
		Position: position, ObjectKey: objectKey,
	}, nil
}
