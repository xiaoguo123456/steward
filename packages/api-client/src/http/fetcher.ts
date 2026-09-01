import { ApiError, type ErrorCode } from './error';
import { getRuntimeConfig, newIdempotencyKey } from './runtime';

/** 需要携带幂等键的写方法。 */
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * 一次 App 进程内尚未成功完成的写请求。
 *
 * 网络断开、超时或 5xx 后，用户再次提交同一 URL、If-Match 版本与请求体时
 * 必须复用原来的幂等键；否则服务端可能已经提交成功，第二次却又创建一份数据。
 * 成功响应完成运行时校验后才释放键，让用户之后可以再次执行相同动作。
 */
const pendingIdempotencyKeys = new Map<string, string>();
const MAX_PENDING_IDEMPOTENCY_KEYS = 128;

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
  responseValidator?: { parse(value: unknown): T },
): Promise<T> {
  // 生成器不会把契约里的 Idempotency-Key 写进函数签名，
  // 因此在这里统一补上：缺了它服务端会直接拒绝所有写请求。
  //
  // 自动生成的键在同一 App 进程内按方法、URL、If-Match 与请求体保持稳定，
  // 直到服务端成功响应也通过运行时校验；401 续期与用户点击重试都会复用它。
  // 需要跨进程／离线队列恢复时，调用方仍应显式持久化并传入：
  //   createTask(body, { headers: { 'Idempotency-Key': key } })
  const prepared = withIdempotencyKey(url, init);
  const response = await requestWithAuth(url, prepared.init, true);

  // 204 与空响应体没有可解析内容。
  if (response.status === 204) {
    releaseIdempotencyKey(prepared.identity);
    return undefined as T;
  }

  const text = await response.text();
  const payload: unknown = text ? safeParse(text) : undefined;

  if (!response.ok) {
    throw toApiError(response.status, payload);
  }
  if (!responseValidator) {
    releaseIdempotencyKey(prepared.identity);
    return payload as T;
  }
  try {
    const validated = responseValidator.parse(payload);
    releaseIdempotencyKey(prepared.identity);
    return validated;
  } catch {
    // 服务端成功响应也属于不可信网络输入。字段缺失或非法枚举
    // 不能以 TypeScript 类型断言混入业务状态。
    throw new ApiError({
      status: response.status,
      code: 'INTERNAL_ERROR',
      message: '服务响应不符合当前版本契约，请稍后重试或更新应用。',
      retryable: true,
      reloadTarget: true,
    });
  }
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
  url: string,
  init: (RequestInit & { signal?: AbortSignal }) | undefined,
): { init: (RequestInit & { signal?: AbortSignal }) | undefined; identity?: string } {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (!WRITE_METHODS.has(method)) {
    return { init };
  }
  const headers = new Headers(init?.headers);
  if (!headers.has('Idempotency-Key')) {
    const identity = idempotencyIdentity(method, url, init?.body, headers.get('If-Match'));
    let key = pendingIdempotencyKeys.get(identity);
    if (!key) {
      key = newIdempotencyKey();
      pendingIdempotencyKeys.set(identity, key);
      trimPendingIdempotencyKeys();
    }
    headers.set('Idempotency-Key', key);
    return { init: { ...init, headers }, identity };
  }
  return { init: { ...init, headers } };
}

function idempotencyIdentity(
  method: string,
  url: string,
  body: BodyInit | null | undefined,
  ifMatch: string | null,
): string {
  return `${method}\n${url}\n${ifMatch ?? ''}\n${typeof body === 'string' ? body : String(body ?? '')}`;
}

function releaseIdempotencyKey(identity?: string): void {
  if (identity) pendingIdempotencyKeys.delete(identity);
}

function trimPendingIdempotencyKeys(): void {
  while (pendingIdempotencyKeys.size > MAX_PENDING_IDEMPOTENCY_KEYS) {
    const oldest = pendingIdempotencyKeys.keys().next().value as string | undefined;
    if (!oldest) return;
    pendingIdempotencyKeys.delete(oldest);
  }
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
