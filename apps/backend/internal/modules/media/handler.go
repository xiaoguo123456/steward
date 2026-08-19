package media

import (
	"context"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// MediaAPI 把生成的 strict server 接口映射到媒体服务。
type MediaAPI struct {
	svc *Service
}

// NewMediaAPI 构造 MediaAPI。
func NewMediaAPI(svc *Service) *MediaAPI { return &MediaAPI{svc: svc} }

// CreateUploadGrants 申请媒体直传授权。
func (h *MediaAPI) CreateUploadGrants(ctx context.Context, req httpapi.CreateUploadGrantsRequestObject) (httpapi.CreateUploadGrantsResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	grants, err := h.svc.CreateGrants(ctx, userID, req.Body.Items)
	if err != nil {
		return nil, err
	}

	data := make([]httpapi.UploadGrant, 0, len(grants))
	for _, grant := range grants {
		headers := grant.Upload.Headers
		maxBytes := grant.MaxBytes
		data = append(data, httpapi.UploadGrant{
			MediaId:   grant.MediaID,
			UploadUrl: grant.Upload.URL,
			Method:    httpapi.UploadGrantMethod(grant.Upload.Method),
			Headers:   &headers,
			MaxBytes:  &maxBytes,
			ExpiresAt: grant.Upload.ExpiresAt,
		})
	}
	return httpapi.CreateUploadGrants201JSONResponse{Data: data, Meta: httpx.Meta(ctx)}, nil
}

// GetMediaAsset 读取媒体资产状态。
func (h *MediaAPI) GetMediaAsset(ctx context.Context, req httpapi.GetMediaAssetRequestObject) (httpapi.GetMediaAssetResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	asset, err := h.svc.Get(ctx, userID, req.MediaId)
	if err != nil {
		return nil, err
	}
	return httpapi.GetMediaAsset200JSONResponse{Data: mapAsset(asset), Meta: httpx.Meta(ctx)}, nil
}

// CompleteMediaUpload 通知媒体上传完成。
func (h *MediaAPI) CompleteMediaUpload(ctx context.Context, req httpapi.CompleteMediaUploadRequestObject) (httpapi.CompleteMediaUploadResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	asset, err := h.svc.Complete(ctx, userID, req.MediaId, req.Body)
	if err != nil {
		return nil, err
	}
	return httpapi.CompleteMediaUpload200JSONResponse{Data: mapAsset(asset), Meta: httpx.Meta(ctx)}, nil
}

// DeleteMediaAsset 删除媒体资产。
func (h *MediaAPI) DeleteMediaAsset(ctx context.Context, req httpapi.DeleteMediaAssetRequestObject) (httpapi.DeleteMediaAssetResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.svc.Delete(ctx, userID, req.MediaId); err != nil {
		return nil, err
	}
	return httpapi.DeleteMediaAsset200JSONResponse(httpx.Mutation(ctx, "",
		httpx.Resource(httpapi.AffectedResourceTypeCapture, ""),
	)), nil
}

func mapAsset(asset Asset) httpapi.MediaAsset {
	row := asset.Row
	out := httpapi.MediaAsset{
		Id:          row.ID,
		Kind:        httpapi.MediaKind(row.Kind),
		ContentType: row.ContentType,
		Status:      httpapi.MediaStatus(row.Status),
		ByteSize:    row.ByteSize,
		CreatedAt:   row.CreatedAt,
		UploadedAt:  row.UploadedAt,
	}
	if asset.ReadURL != "" {
		url := asset.ReadURL
		out.ReadUrl = &url
	}
	return out
}
