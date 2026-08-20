/**
 * 后台的 HTTP 客户端。
 *
 * 和用户端的 fetcher 有两处关键差别：
 *
 * 1. **凭证走 Cookie 而不是 Bearer**：会话令牌是 HttpOnly 的，
 *    JavaScript 读不到，因此必须靠 `credentials: 'include'` 让浏览器带上。
 *    这正是它防得住 XSS 的原因——脚本偷不走一个自己读不到的东西。
 *
 * 2. **写请求要带 CSRF Token**：Cookie 会被浏览器自动附加到跨站请求上，
 *    所以光有 Cookie 挡不住 CSRF。CSRF Token 存在内存里（不是 Cookie、
 *    也不是 localStorage），跨站脚本读不到。
 */

let csrfToken = '';

/** 登录成功后把 CSRF Token 记到内存里。 */
export function setCsrfToken(token: string) {
  csrfToken = token;
}

/** 退出或会话失效时清掉。 */
export function clearCsrfToken() {
  csrfToken = '';
}

export function getCsrfToken() {
  return csrfToken;
}

/** 后台 API 的基地址。开发时由 Umi 代理转发。 */
const BASE_URL = '';

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;

  constructor(status: number, code: string, message: string, requestId: string) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }

  /** 会话失效需要跳登录页，和其他错误的处理完全不同。 */
  get isSessionExpired() {
    return this.code === 'ADMIN_AUTH_REQUIRED' || this.code === 'ADMIN_SESSION_EXPIRED';
  }
}

/**
 * orval v8 的 mutator 契约是 `(url, init) => Promise<{data, status, headers}>`，
 * 不是裸响应体。这里按它的形状返回。
 *
 * **非 2xx 一律抛异常**，因此实际返回的永远是成功那一支——
 * 生成的联合类型里那些错误分支在运行时到不了调用方。
 * 用 unwrap() 把这件事在类型上也说清楚。
 */
export async function adminFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const isWrite = method !== 'GET' && method !== 'HEAD';

  const response = await fetch(`${BASE_URL}${url}`, {
    ...init,
    method,
    // 让浏览器带上 HttpOnly 的会话 Cookie。JavaScript 读不到它，
    // 因此一次 XSS 偷不走会话——这正是 HttpOnly 的意义。
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      // Cookie 会被浏览器自动附加到跨站请求上，所以光有 Cookie 挡不住 CSRF。
      // CSRF Token 存在内存里（不是 Cookie、也不是 localStorage），
      // 跨站脚本读不到它。
      ...(isWrite && csrfToken ? { 'X-Admin-CSRF': csrfToken } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  const payload =
    response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    const code = payload?.error?.code ?? 'ADMIN_INTERNAL_ERROR';
    const message = payload?.error?.message ?? '请求失败。';
    // request_id 一定要带出来：界面上显示它，出问题时按它就能查到整条链路。
    const requestId = payload?.meta?.request_id ?? '';
    throw new AdminApiError(response.status, code, message, requestId);
  }

  return {
    data: payload,
    status: response.status,
    headers: response.headers,
  } as T;
}

/**
 * 取出成功响应的响应体。
 *
 * 生成的类型是「成功 | 各种错误」的联合，但 adminFetch 在非 2xx 时抛异常，
 * 错误分支运行时到不了这里。unwrap 把这个事实写进类型，
 * 免得每个调用点都去做一次不可能失败的收窄。
 */
export function unwrap<T extends { status: number; data: unknown }>(
  response: T | undefined,
): Extract<T, { status: 200 }>['data'] | undefined {
  if (!response) return undefined;
  return response.data as Extract<T, { status: 200 }>['data'];
}

export default adminFetch;
