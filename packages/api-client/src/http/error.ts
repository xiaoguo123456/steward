import type { ErrorCode as GeneratedErrorCode } from '../generated/model';

/**
 * 错误码直接复用生成类型，保证与契约同步。
 * App 只允许依赖这个枚举做分支，不得解析 message 文案。
 */
export type ErrorCode = GeneratedErrorCode;

export type ApiErrorInit = {
  status: number;
  code: ErrorCode;
  message: string;
  retryable: boolean;
  reloadTarget: boolean;
};

/** 所有 API 失败都以这个类型抛出。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  /** 是否可以用相同参数安全重试。 */
  readonly retryable: boolean;
  /** 是否需要先重新加载目标资源再重试。 */
  readonly reloadTarget: boolean;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.retryable = init.retryable;
    this.reloadTarget = init.reloadTarget;
  }
}

/** 判断错误是否为 ApiError。 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** 判断是否是登录态失效，需要跳回登录页。 */
export function isUnauthenticated(error: unknown): boolean {
  return isApiError(error) && (error.code === 'UNAUTHENTICATED' || error.code === 'REFRESH_TOKEN_INVALID');
}

/** 取出面向用户的中文提示；非 API 错误给出通用兜底文案。 */
export function errorMessage(error: unknown, fallback = '操作未能完成，请稍后重试。'): string {
  if (isApiError(error)) {
    return error.message;
  }
  return fallback;
}
