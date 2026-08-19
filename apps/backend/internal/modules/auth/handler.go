package auth

import (
	"context"

	"github.com/guoxiaozheng1/steward/apps/backend/internal/gen/httpapi"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/modules/users"
	"github.com/guoxiaozheng1/steward/apps/backend/internal/platform/httpx"
)

// SessionAPI 把生成的 strict server 接口映射到登录服务。
type SessionAPI struct {
	svc *Service
}

// NewSessionAPI 构造 SessionAPI。
func NewSessionAPI(svc *Service) *SessionAPI { return &SessionAPI{svc: svc} }

// RequestPhoneCode 发送登录验证码。
func (h *SessionAPI) RequestPhoneCode(ctx context.Context, req httpapi.RequestPhoneCodeRequestObject) (httpapi.RequestPhoneCodeResponseObject, error) {
	purpose := "login"
	if req.Body.Purpose != nil {
		purpose = string(*req.Body.Purpose)
	}
	result, err := h.svc.RequestCode(ctx, req.Body.Phone, purpose)
	if err != nil {
		return nil, err
	}

	resp := httpapi.RequestPhoneCode200JSONResponse{Meta: httpx.Meta(ctx)}
	resp.Data.ExpiresInSeconds = result.ExpiresInSeconds
	resp.Data.ResendAfterSeconds = result.ResendAfterSeconds
	if result.DevCode != "" {
		code := result.DevCode
		resp.Data.DevCode = &code
	}
	return resp, nil
}

// Login 手机号验证码登录。
func (h *SessionAPI) Login(ctx context.Context, req httpapi.LoginRequestObject) (httpapi.LoginResponseObject, error) {
	timezone := ""
	if req.Body.Timezone != nil {
		timezone = *req.Body.Timezone
	}
	result, err := h.svc.Login(ctx, req.Body.Phone, req.Body.Code, timezone)
	if err != nil {
		return nil, err
	}

	resp := httpapi.Login200JSONResponse{Meta: httpx.Meta(ctx)}
	resp.Data.Tokens = tokenPair(result)
	resp.Data.User = users.MapUser(result.User)
	resp.Data.IsNewUser = result.IsNewUser
	return resp, nil
}

// RefreshToken 用 Refresh Token 换取新的 Access Token。
func (h *SessionAPI) RefreshToken(ctx context.Context, req httpapi.RefreshTokenRequestObject) (httpapi.RefreshTokenResponseObject, error) {
	result, err := h.svc.Refresh(ctx, req.Body.RefreshToken)
	if err != nil {
		return nil, err
	}
	return httpapi.RefreshToken200JSONResponse{
		Data: tokenPair(result),
		Meta: httpx.Meta(ctx),
	}, nil
}

// Logout 注销当前 Refresh Token。
func (h *SessionAPI) Logout(ctx context.Context, _ httpapi.LogoutRequestObject) (httpapi.LogoutResponseObject, error) {
	userID, err := httpx.UserID(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.svc.Logout(ctx, userID); err != nil {
		return nil, err
	}
	return httpapi.Logout200JSONResponse{Meta: httpx.Meta(ctx)}, nil
}

func tokenPair(r LoginResult) httpapi.TokenPair {
	return httpapi.TokenPair{
		AccessToken:      r.AccessToken,
		AccessExpiresAt:  r.AccessExpiresAt,
		RefreshToken:     r.RefreshToken,
		RefreshExpiresAt: r.RefreshExpiresAt,
	}
}
