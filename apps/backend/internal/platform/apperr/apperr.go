// Package apperr 定义领域错误与稳定错误码之间的唯一映射。
//
// Domain 与 Application 只抛出这里的 Error，HTTP 层统一翻译成契约中的
// ErrorCode、HTTP 状态码和默认中文文案。业务代码不直接构造 HTTP 响应。
package apperr

import (
	"errors"
	"fmt"
	"net/http"
)

// Code 是契约 ErrorCode 的字符串形式。取值必须与
// packages/contracts/openapi/components/schemas/common.yaml 中的枚举保持一致。
type Code string

const (
	CodeValidationFailed  Code = "VALIDATION_FAILED"
	CodeUnauthenticated   Code = "UNAUTHENTICATED"
	CodePermissionDenied  Code = "PERMISSION_DENIED"
	CodeNotFound          Code = "RESOURCE_NOT_FOUND"
	CodeVersionConflict   Code = "VERSION_CONFLICT"
	CodeIdempotencyKeyReq Code = "IDEMPOTENCY_KEY_REQUIRED"
	CodeIdempotencyReused Code = "IDEMPOTENCY_KEY_REUSED"
	CodeRateLimited       Code = "RATE_LIMITED"
	CodeInternal          Code = "INTERNAL_ERROR"

	CodePhoneInvalid        Code = "PHONE_INVALID"
	CodeCodeInvalid         Code = "VERIFICATION_CODE_INVALID"
	CodeCodeExpired         Code = "VERIFICATION_CODE_EXPIRED"
	CodeRefreshTokenInvalid Code = "REFRESH_TOKEN_INVALID"

	CodeTaskListNameDuplicated Code = "TASK_LIST_NAME_DUPLICATED"
	CodeTaskListNotEmpty       Code = "TASK_LIST_NOT_EMPTY"
	CodeTaskListDefaultReq     Code = "TASK_LIST_DEFAULT_REQUIRED"
	CodeTaskStatusInvalid      Code = "TASK_STATUS_TRANSITION_INVALID"
	CodeEventTimeRangeInvalid  Code = "EVENT_TIME_RANGE_INVALID"
	CodeEventRecurrenceDenied  Code = "EVENT_RECURRENCE_NOT_ALLOWED"
	CodeTrackerSchemaInvalid   Code = "TRACKER_SCHEMA_INVALID"
	CodeRecordValuesInvalid    Code = "RECORD_VALUES_INVALID"
	CodeProjectHasOpenTasks    Code = "PROJECT_HAS_OPEN_TASKS"
	CodeObjectAlreadyDeleted   Code = "OBJECT_ALREADY_DELETED"

	CodeCaptureNotReady         Code = "CAPTURE_NOT_READY"
	CodeCaptureAlreadyConfirm   Code = "CAPTURE_ALREADY_CONFIRMED"
	CodeCaptureRevisionStale    Code = "CAPTURE_REVISION_STALE"
	CodeCaptureQuestionResolved Code = "CAPTURE_QUESTION_RESOLVED"
	CodeAIProviderUnavailable   Code = "AI_PROVIDER_UNAVAILABLE"
	CodeAIProviderRateLimited   Code = "AI_PROVIDER_RATE_LIMITED"
	CodeAISchemaInvalid         Code = "AI_SCHEMA_INVALID"
	CodeAISourceInvalid         Code = "AI_SOURCE_INVALID"
	CodeAIBudgetExceeded        Code = "AI_BUDGET_EXCEEDED"
	CodeAITurnCancelled         Code = "AI_TURN_CANCELLED"

	// Action Proposal。
	CodeAIProposalStale          Code = "AI_PROPOSAL_STALE"
	CodeAIProposalExpired        Code = "AI_PROPOSAL_EXPIRED"
	CodeAIProposalResolved       Code = "AI_PROPOSAL_ALREADY_RESOLVED"
	CodeAIProposalEditNotAllowed Code = "AI_PROPOSAL_EDIT_NOT_ALLOWED"

	// 长期记忆。
	CodeMemoryRelearnBlocked Code = "MEMORY_RELEARN_BLOCKED"
)

// FieldError 是单个字段的校验失败说明。
type FieldError struct {
	Field   string
	Message string
}

// Error 是全部业务错误的统一类型。
type Error struct {
	Code    Code
	Message string
	Fields  []FieldError
	// ReloadTarget 提示客户端需要重新加载目标资源后再重试。
	ReloadTarget bool
	// cause 只写入服务端日志，不返回给客户端。
	cause error
}

func (e *Error) Error() string {
	if e.cause != nil {
		return fmt.Sprintf("%s: %s: %v", e.Code, e.Message, e.cause)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *Error) Unwrap() error { return e.cause }

// WithCause 附加仅供日志使用的底层原因。
func (e *Error) WithCause(err error) *Error {
	e.cause = err
	return e
}

// New 用默认文案构造错误。
func New(code Code) *Error {
	return &Error{Code: code, Message: defaultMessage(code), ReloadTarget: reloadTarget(code)}
}

// Newf 用自定义文案构造错误。文案面向用户，必须使用中文。
func Newf(code Code, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...), ReloadTarget: reloadTarget(code)}
}

// Validation 构造带字段明细的校验错误。
func Validation(fields ...FieldError) *Error {
	e := New(CodeValidationFailed)
	e.Fields = fields
	return e
}

// Field 是 FieldError 的简写。
func Field(name, message string) FieldError {
	return FieldError{Field: name, Message: message}
}

// NotFound 构造资源不存在错误。资源不属于当前用户时同样返回它，
// 避免通过错误码区分“不存在”和“无权限”而泄漏他人资源的存在性。
func NotFound(resource string) *Error {
	return Newf(CodeNotFound, "%s不存在或已被删除", resource)
}

// Internal 包装未预期的内部错误。
func Internal(err error) *Error {
	return New(CodeInternal).WithCause(err)
}

// As 从错误链中取出 *Error。
func As(err error) (*Error, bool) {
	var e *Error
	if errors.As(err, &e) {
		return e, true
	}
	return nil, false
}

// HTTPStatus 返回错误码对应的 HTTP 状态码。
func (e *Error) HTTPStatus() int {
	switch e.Code {
	case CodeUnauthenticated, CodeRefreshTokenInvalid:
		return http.StatusUnauthorized
	case CodePermissionDenied:
		return http.StatusForbidden
	case CodeNotFound:
		return http.StatusNotFound
	case CodeVersionConflict, CodeIdempotencyReused,
		CodeTaskListNameDuplicated, CodeTaskListNotEmpty, CodeTaskListDefaultReq,
		CodeTaskStatusInvalid, CodeProjectHasOpenTasks, CodeObjectAlreadyDeleted,
		CodeCaptureAlreadyConfirm, CodeCaptureRevisionStale, CodeCaptureQuestionResolved,
		CodeAIProposalStale, CodeAIProposalExpired, CodeAIProposalResolved,
		CodeAITurnCancelled:
		return http.StatusConflict
	case CodeRateLimited, CodeAIProviderRateLimited:
		return http.StatusTooManyRequests
	case CodeInternal:
		return http.StatusInternalServerError
	case CodeAIProviderUnavailable:
		return http.StatusServiceUnavailable
	default:
		return http.StatusBadRequest
	}
}

// Retryable 说明客户端能否用相同参数安全重试。
func (e *Error) Retryable() bool {
	switch e.Code {
	case CodeInternal, CodeRateLimited, CodeAIProviderUnavailable, CodeAIProviderRateLimited:
		return true
	default:
		return false
	}
}

func reloadTarget(code Code) bool {
	switch code {
	case CodeVersionConflict, CodeCaptureRevisionStale, CodeCaptureAlreadyConfirm,
		CodeCaptureQuestionResolved, CodeObjectAlreadyDeleted,
		CodeAIProposalStale, CodeAIProposalExpired, CodeAIProposalResolved:
		return true
	default:
		return false
	}
}

// defaultMessage 是每个错误码的默认中文文案。
// App 可以在特定场景覆盖为更贴合的说法，但不得解析这里的文本做逻辑分支。
func defaultMessage(code Code) string {
	switch code {
	case CodeValidationFailed:
		return "提交的内容不符合要求，请检查后重试。"
	case CodeUnauthenticated:
		return "登录状态已失效，请重新登录。"
	case CodePermissionDenied:
		return "没有权限执行该操作。"
	case CodeNotFound:
		return "内容不存在或已被删除。"
	case CodeVersionConflict:
		return "内容已在别处被修改，请刷新后重试。"
	case CodeIdempotencyKeyReq:
		return "缺少幂等键，请重试。"
	case CodeIdempotencyReused:
		return "相同的幂等键被用于不同的请求内容。"
	case CodeRateLimited:
		return "操作过于频繁，请稍后再试。"
	case CodeInternal:
		return "服务出现问题，请稍后重试。"
	case CodePhoneInvalid:
		return "手机号格式不正确。"
	case CodeCodeInvalid:
		return "验证码不正确。"
	case CodeCodeExpired:
		return "验证码已过期，请重新获取。"
	case CodeRefreshTokenInvalid:
		return "登录状态已失效，请重新登录。"
	case CodeTaskListNameDuplicated:
		return "已有同名清单，请换一个名称。"
	case CodeTaskListNotEmpty:
		return "清单中还有任务，请先选择要迁移到的清单。"
	case CodeTaskListDefaultReq:
		return "需要先指定另一个默认清单。"
	case CodeTaskStatusInvalid:
		return "该状态变更不被允许。"
	case CodeEventTimeRangeInvalid:
		return "开始与结束时间不合法。"
	case CodeEventRecurrenceDenied:
		return "只有重要日可以按年重复。"
	case CodeTrackerSchemaInvalid:
		return "记录项的字段定义不合法。"
	case CodeRecordValuesInvalid:
		return "填写的数据不符合该记录项的字段定义。"
	case CodeProjectHasOpenTasks:
		return "项目下还有未完成的任务。"
	case CodeObjectAlreadyDeleted:
		return "内容已被删除。"
	case CodeCaptureNotReady:
		return "本次输入还在处理中，请稍候。"
	case CodeCaptureAlreadyConfirm:
		return "本次输入已经保存过了。"
	case CodeCaptureRevisionStale:
		return "输入内容已更新，请查看最新的整理结果。"
	case CodeAIProposalStale:
		return "这条内容在此期间被改动过，请重新查看后再确认。"
	case CodeAIProposalExpired:
		return "这条建议已经过期，请重新提问。"
	case CodeAIProposalResolved:
		return "这条建议已经处理过了。"
	case CodeAIProposalEditNotAllowed:
		return "这个字段不支持在确认页修改。"
	case CodeMemoryRelearnBlocked:
		return "你已设置不再记住这类信息。"
	case CodeCaptureQuestionResolved:
		return "这个问题已经处理过了。"
	case CodeAIProviderUnavailable:
		return "智能整理暂时不可用，你仍然可以手动填写。"
	case CodeAIProviderRateLimited:
		return "智能整理请求过于频繁，请稍后再试。"
	case CodeAISchemaInvalid:
		return "整理结果格式不正确，请重试。"
	case CodeAISourceInvalid:
		return "整理结果缺少可追溯的来源。"
	case CodeAIBudgetExceeded:
		return "本次整理超出可用额度。"
	case CodeAITurnCancelled:
		return "本次整理已取消。"
	default:
		return "请求未能完成。"
	}
}
