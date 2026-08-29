package retention

import (
	"context"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// AccountDeletionAPI 映射账号删除 strict server 接口。
type AccountDeletionAPI struct{ svc *Service }

// NewAccountDeletionAPI 构造 API。
func NewAccountDeletionAPI(svc *Service) *AccountDeletionAPI {
	return &AccountDeletionAPI{svc: svc}
}

// RequestAccountDeletion 正式受理账号删除。
func (h *AccountDeletionAPI) RequestAccountDeletion(ctx context.Context,
	req httpapi.RequestAccountDeletionRequestObject,
) (httpapi.RequestAccountDeletionResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	result, err := h.svc.Request(ctx, userID, req.Body.ReauthToken,
		req.Params.IdempotencyKey, req.Body.Acknowledgement)
	if err != nil {
		return nil, err
	}
	return httpapi.RequestAccountDeletion202JSONResponse{
		Data: httpapi.AccountDeletionAccepted{
			DeletionRequestId: result.RequestID,
			StatusToken:       result.StatusToken,
			Status:            httpapi.AccountDeletionStatus(result.Status),
			AcceptedAt:        result.AcceptedAt,
			BackupExpiresAt:   result.BackupExpiresAt,
		},
		Meta: httpx.Meta(ctx),
	}, nil
}

// GetAccountDeletionStatus 使用独立凭证查询状态。
func (h *AccountDeletionAPI) GetAccountDeletionStatus(ctx context.Context,
	req httpapi.GetAccountDeletionStatusRequestObject,
) (httpapi.GetAccountDeletionStatusResponseObject, error) {
	row, err := h.svc.Status(ctx, req.DeletionRequestId, req.Params.DeletionStatusToken)
	if err != nil {
		return nil, err
	}
	return httpapi.GetAccountDeletionStatus200JSONResponse{
		Data: httpapi.AccountDeletionStatusRecord{
			DeletionRequestId: row.RequestID,
			Status:            httpapi.AccountDeletionStatus(row.Status),
			AcceptedAt:        row.AcceptedAt,
			UpdatedAt:         row.UpdatedAt,
			CompletedAt:       row.CompletedAt,
			BackupExpiresAt:   row.BackupExpiresAt,
			PublicError:       row.PublicError,
		},
		Meta: httpx.Meta(ctx),
	}, nil
}
