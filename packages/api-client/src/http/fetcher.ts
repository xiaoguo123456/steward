import { ApiError, type ErrorCode } from './error';
import { getRuntimeConfig, newIdempotencyKey } from './runtime';

/** 需要携带幂等键的写方法。 */
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * 生成代码里所有请求的唯一出口。
 *
 * 它负责四件事：拼接 baseURL、附加鉴权头、把错误信封翻译成 ApiError，
 * 以及在 Access Token 过期时用 Refresh Token 静默续期并重放一次。
 * 业务代码因此永远不需要处理裸 Response 或手写 URL。
 */
export async function stewardFetch<T>(
  url: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<T> {
  // 生成器不会把契约里的 Idempotency-Key 写进函数签名，
  // 因此在这里统一补上：缺了它服务端会直接拒绝所有写请求。
  //
  // 自动生成的键只在本次调用内稳定（包括 401 续期后的重放）。
  // 需要「用户重试也复用同一个键」时，调用方显式传入：
  //   createTask(body, { headers: { 'Idempotency-Key': key } })
  const prepared = withIdempotencyKey(init);
  const response = await requestWithAuth(url, prepared, true);

  // 204 与空响应体没有可解析内容。
  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload: unknown = text ? safeParse(text) : undefined;

  if (!response.ok) {
    throw toApiError(response.status, payload);
  }
  return payload as T;
}

async function requestWithAuth(
  url: string,
  init: RequestInit | undefined,
  allowRetry: boolean,
): Promise<Response> {
  const config = getRuntimeConfig();
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const token = await config.getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(joinUrl(config.baseUrl, url), { ...init, headers });

  // Access Token 过期时静默续期并重放一次。只重放一次，避免无限循环。
  // Refresh 请求本身失败时不能再次触发 Refresh，否则会等待自己完成，形成
  // 永远不结束的 Promise 环。它应把 401 原样交给 SessionStore 清理登录态。
  if (response.status === 401 && allowRetry && !isRefreshRequest(url)) {
    const refreshed = await config.refreshTokens();
    if (refreshed) {
      return requestWithAuth(url, init, false);
    }
  }
  return response;
}

function isRefreshRequest(url: string): boolean {
  const path = url.split('?', 1)[0].replace(/\/+$/, '');
  return path.endsWith('/v1/auth/refresh');
}

/** 为写请求补上幂等键；调用方已显式提供时保持不变。 */
function withIdempotencyKey(
  init: (RequestInit & { signal?: AbortSignal }) | undefined,
): (RequestInit & { signal?: AbortSignal }) | undefined {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (!WRITE_METHODS.has(method)) {
    return init;
  }
  const headers = new Headers(init?.headers);
  if (!headers.has('Idempotency-Key')) {
    headers.set('Idempotency-Key', newIdempotencyKey());
  }
  return { ...init, headers };
}

function joinUrl(baseUrl: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  return `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** 把契约里的错误信封翻译成 ApiError。 */
function toApiError(status: number, payload: unknown): ApiError {
  const body = payload as
    | { error?: { code?: string; message?: string; retryable?: boolean; reload_target?: boolean } }
    | undefined;
  const error = body?.error;

  if (error?.code) {
    return new ApiError({
      status,
      code: error.code as ErrorCode,
      message: error.message ?? '请求未能完成。',
      retryable: error.retryable ?? false,
      reloadTarget: error.reload_target ?? false,
    });
  }

  // 网关或代理返回的非契约错误：统一降级为内部错误，不猜测原因。
  return new ApiError({
    status,
    code: 'INTERNAL_ERROR',
    message: status === 0 ? '网络连接失败，请检查网络后重试。' : '服务出现问题，请稍后重试。',
    retryable: true,
    reloadTarget: false,
  });
}
